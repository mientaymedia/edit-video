import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import { normOutput, projectExists, readMeta, applyBriefPatch } from "../meta.js";
import { transcribeVideo } from "../transcribe.js";
import { probeVideo } from "../reframe.js";
import {
  defaultVideoToVideoMeta,
  listVideoToVideoSessions,
  readVideoToVideoMeta,
  uniqueVideoToVideoId,
  videoToVideoDirOf,
  videoToVideoSessionExists,
  writeVideoToVideoMeta,
  type VideoAudioMode,
  type VideoReframeMode,
  type VideoToVideoMeta,
  type VideoToVideoOutput,
} from "../videoToVideoMeta.js";
import * as db from "../db.js";
import { queue } from "../queue.js";
import { HttpError, isKebabCase, ensureDir, toRepoRel } from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) =>
      cb(null, `v2v2-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 2048 * 1024 * 1024 }, // 2GB max
});

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

function reconcile(meta: VideoToVideoMeta): VideoToVideoMeta {
  if (meta.status !== "editing" || !meta.projectId) return meta;
  try {
    if (!projectExists(meta.projectId)) {
      meta.status = "failed";
      meta.error = `Project "${meta.projectId}" đã bị xóa.`;
      writeVideoToVideoMeta(meta);
      return meta;
    }
    if (normOutput(readMeta(meta.projectId).output)) {
      meta.status = "done";
      meta.error = null;
      writeVideoToVideoMeta(meta);
      return meta;
    }
  } catch {
    // meta project con hỏng/đang ghi dở
  }
  return meta;
}

function mustRead(id: string): VideoToVideoMeta {
  if (!isKebabCase(id)) throw new HttpError(400, "INVALID_ID", "id không hợp lệ");
  if (!videoToVideoSessionExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên "${id}"`);
  }
  return reconcile(readVideoToVideoMeta(id));
}

function assertNotBusy(meta: VideoToVideoMeta): void {
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên "${meta.id}" đang có job chạy hoặc chờ trong hàng đợi.`,
    );
  }
}

// ------------------------------------------------------------------ Routes

/** GET /api/video-to-video - Danh sách phiên */
router.get("/", (_req, res) => {
  const list = listVideoToVideoSessions().map(reconcile);
  res.json(list);
});

/** POST /api/video-to-video - Tạo phiên mới */
router.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const id = uniqueVideoToVideoId(name || "video-restyle");
  const meta = defaultVideoToVideoMeta(id, name || id);
  writeVideoToVideoMeta(meta);
  res.status(201).json(meta);
});

/** GET /api/video-to-video/:id - Chi tiết phiên */
router.get("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  res.json(meta);
});

/** POST /api/video-to-video/:id/upload - Tải lên video nguồn */
router.post("/:id/upload", upload.single("file"), async (req, res, next) => {
  try {
    const meta = mustRead(req.params.id as string);
    assertNotBusy(meta);

    const file = req.file;
    if (!file) throw new HttpError(400, "NO_FILE", "Chưa chọn file video nào");

    const ext = path.extname(file.originalname).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) {
      try {
        fs.unlinkSync(file.path);
      } catch {}
      throw new HttpError(400, "INVALID_EXT", `Định dạng video không được hỗ trợ: ${ext}`);
    }

    const dir = videoToVideoDirOf(meta.id);
    ensureDir(dir);

    const destFileName = `source${ext}`;
    const destAbs = path.join(dir, destFileName);

    if (fs.existsSync(destAbs)) {
      try {
        fs.unlinkSync(destAbs);
      } catch {}
    }
    fs.renameSync(file.path, destAbs);

    meta.source.file = destFileName;
    meta.source.originalFileName = file.originalname;

    try {
      const probe = await probeVideo(destAbs);
      meta.source.width = probe.width;
      meta.source.height = probe.height;
      meta.source.fps = probe.fps;
      meta.source.durationSec = probe.durationSec;
    } catch (err) {
      console.warn("[video-to-video] Không probe được video:", err);
    }

    meta.status = "draft";
    writeVideoToVideoMeta(meta);
    res.json(meta);
  } catch (e) {
    next(e);
  }
});

/** POST /api/video-to-video/:id/transcribe - Bóc lời video */
router.post("/:id/transcribe", async (req, res, next) => {
  try {
    const meta = mustRead(req.params.id as string);
    assertNotBusy(meta);

    if (!meta.source.file) {
      throw new HttpError(400, "NO_VIDEO", "Chưa có file video nguồn để bóc lời");
    }

    const dir = videoToVideoDirOf(meta.id);
    const videoAbs = path.join(dir, meta.source.file);
    const outJsonAbs = path.join(dir, "transcript.json");

    meta.status = "transcribing";
    writeVideoToVideoMeta(meta);

    await transcribeVideo({
      videoAbs,
      outJsonAbs,
      language: "vi",
    });

    try {
      const parsed = JSON.parse(fs.readFileSync(outJsonAbs, "utf8")) as {
        text?: string;
        segments?: Array<{ text: string }>;
      };
      const text =
        parsed.text ||
        (parsed.segments ? parsed.segments.map((s) => s.text).join(" ") : "");
      meta.transcript = text.trim();
      meta.transcriptFile = toRepoRel(outJsonAbs);
    } catch {}

    meta.status = "ready";
    writeVideoToVideoMeta(meta);
    res.json(meta);
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/video-to-video/:id - Cập nhật cấu hình */
router.patch("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  if (typeof req.body?.name === "string") {
    meta.name = req.body.name.trim() || meta.name;
  }
  if (typeof req.body?.transcript === "string") {
    meta.transcript = req.body.transcript;
  }
  if (typeof req.body?.reframeMode === "string") {
    meta.reframeMode = req.body.reframeMode as VideoReframeMode;
  }
  if (typeof req.body?.audioMode === "string") {
    meta.audioMode = req.body.audioMode as VideoAudioMode;
  }

  // Brief
  if (req.body?.brief && typeof req.body.brief === "object") {
    meta.brief = applyBriefPatch(meta.brief, req.body.brief);
  }

  // Output
  if (req.body?.output && typeof req.body.output === "object") {
    const o = req.body.output as Partial<VideoToVideoOutput>;
    if (o.aspect) meta.output.aspect = o.aspect;
    if (o.fps) meta.output.fps = o.fps;
    if (o.width) meta.output.width = o.width;
    if (o.height) meta.output.height = o.height;
  }

  writeVideoToVideoMeta(meta);
  res.json(meta);
});

/** POST /api/video-to-video/:id/build - Kích hoạt dựng video */
router.post("/:id/build", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  if (!meta.source.file) {
    throw new HttpError(400, "NO_VIDEO", "Chưa có file video nguồn để dựng");
  }

  if (meta.projectId) {
    throw new HttpError(400, "ALREADY_BUILT", `Phiên đã dựng project "${meta.projectId}" rồi`);
  }

  meta.status = "building";
  meta.error = null;
  writeVideoToVideoMeta(meta);

  const jobId = `job_vtv_${nanoid()}`;
  const job = db.createJob({
    id: jobId,
    type: "video-to-video",
    projectId: meta.id,
  });
  queue.enqueue(jobId);

  res.json({ job: db.jobToApi(job), meta });
});

/** DELETE /api/video-to-video/:id - Xóa phiên */
router.delete("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  const dir = videoToVideoDirOf(meta.id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  res.json({ ok: true, deleted: meta.id });
});

export default router;
