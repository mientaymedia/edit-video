import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths } from "../config.js";
import { transcribeVideo } from "../transcribe.js";
import { probeVideo } from "../reframe.js";
import {
  changeVoiceVideoDirOf,
  changeVoiceVideoSessionExists,
  defaultChangeVoiceVideoMeta,
  listChangeVoiceVideoSessions,
  readChangeVoiceVideoMeta,
  uniqueChangeVoiceVideoId,
  writeChangeVoiceVideoMeta,
  type ChangeVoiceAudioMix,
  type ChangeVoiceCue,
  type ChangeVoiceSettings,
  type ChangeVoiceVideoMeta,
} from "../changeVoiceVideoMeta.js";
import * as db from "../db.js";
import { queue } from "../queue.js";
import { HttpError, isKebabCase, ensureDir } from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) =>
      cb(null, `cvv-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 2048 * 1024 * 1024 }, // 2GB max
});

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

function mustRead(id: string): ChangeVoiceVideoMeta {
  if (!isKebabCase(id)) throw new HttpError(400, "INVALID_ID", "id không hợp lệ");
  if (!changeVoiceVideoSessionExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên "${id}"`);
  }
  return readChangeVoiceVideoMeta(id);
}

function assertNotBusy(meta: ChangeVoiceVideoMeta): void {
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên "${meta.id}" đang có job chạy hoặc chờ trong hàng đợi.`
    );
  }
}

// ------------------------------------------------------------------ Routes

/** GET /api/change-voice-video - Danh sách phiên */
router.get("/", (_req, res) => {
  const list = listChangeVoiceVideoSessions();
  res.json(list);
});

/** POST /api/change-voice-video - Tạo phiên mới */
router.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const id = uniqueChangeVoiceVideoId(name || "change-voice");
  const meta = defaultChangeVoiceVideoMeta(id, name || id);
  writeChangeVoiceVideoMeta(meta);
  res.status(201).json(meta);
});

/** GET /api/change-voice-video/:id - Chi tiết phiên */
router.get("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  res.json(meta);
});

/** POST /api/change-voice-video/:id/upload - Tải lên video nguồn */
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
      throw new HttpError(
        400,
        "INVALID_EXT",
        `Định dạng video không được hỗ trợ: ${ext}`
      );
    }

    const dir = changeVoiceVideoDirOf(meta.id);
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
      console.warn("[change-voice-video] Không probe được video:", err);
    }

    meta.status = "draft";
    writeChangeVoiceVideoMeta(meta);
    res.json(meta);
  } catch (e) {
    next(e);
  }
});

/** POST /api/change-voice-video/:id/transcribe - Bóc lời video */
router.post("/:id/transcribe", async (req, res, next) => {
  try {
    const meta = mustRead(req.params.id as string);
    assertNotBusy(meta);

    if (!meta.source.file) {
      throw new HttpError(400, "NO_VIDEO", "Chưa có file video nguồn để bóc lời");
    }

    const dir = changeVoiceVideoDirOf(meta.id);
    const videoAbs = path.join(dir, meta.source.file);
    const outJsonAbs = path.join(dir, "transcript.json");

    meta.status = "transcribing";
    writeChangeVoiceVideoMeta(meta);

    await transcribeVideo({
      videoAbs,
      outJsonAbs,
      language: "vi",
    });

    try {
      const parsed = JSON.parse(fs.readFileSync(outJsonAbs, "utf8")) as {
        segments?: Array<{ start: number; end: number; text: string }>;
      };
      const cues: ChangeVoiceCue[] = (parsed.segments ?? []).map((s) => ({
        id: `cue_${nanoid(8)}`,
        start: s.start,
        end: s.end,
        text: s.text.trim(),
        originalText: s.text.trim(),
      }));
      meta.cues = cues;
    } catch {}

    meta.status = "ready";
    writeChangeVoiceVideoMeta(meta);
    res.json(meta);
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/change-voice-video/:id - Cập nhật cấu hình & Cues */
router.patch("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  if (typeof req.body?.name === "string") {
    meta.name = req.body.name.trim() || meta.name;
  }
  if (Array.isArray(req.body?.cues)) {
    meta.cues = req.body.cues as ChangeVoiceCue[];
  }
  if (req.body?.voiceSettings && typeof req.body.voiceSettings === "object") {
    meta.voiceSettings = {
      ...meta.voiceSettings,
      ...(req.body.voiceSettings as Partial<ChangeVoiceSettings>),
    };
  }
  if (req.body?.audioMix && typeof req.body.audioMix === "object") {
    meta.audioMix = {
      ...meta.audioMix,
      ...(req.body.audioMix as Partial<ChangeVoiceAudioMix>),
    };
  }
  if (typeof req.body?.burnSubtitles === "boolean") {
    meta.burnSubtitles = req.body.burnSubtitles;
  }

  writeChangeVoiceVideoMeta(meta);
  res.json(meta);
});

/** POST /api/change-voice-video/:id/render - Bắt đầu render đổi giọng */
router.post("/:id/render", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  if (!meta.source.file) {
    throw new HttpError(400, "NO_VIDEO", "Chưa có file video nguồn để xử lý");
  }

  meta.status = "rendering";
  meta.error = null;
  writeChangeVoiceVideoMeta(meta);

  const jobId = `job_cvv_${nanoid()}`;
  const job = db.createJob({
    id: jobId,
    type: "change-voice-video",
    projectId: meta.id,
  });
  queue.enqueue(jobId);

  res.json({ job: db.jobToApi(job), meta });
});

/** DELETE /api/change-voice-video/:id - Xóa phiên */
router.delete("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  const dir = changeVoiceVideoDirOf(meta.id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  res.json({ ok: true, deleted: meta.id });
});

export default router;
