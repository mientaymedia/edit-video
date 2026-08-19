import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import { normOutput, projectExists, readMeta, applyBriefPatch } from "../meta.js";
import { transcribeVideo } from "../transcribe.js";
import {
  defaultVoiceToVideoMeta,
  patchVoiceToVideo,
  readVoiceToVideo,
  voiceToVideoDirOf,
  voiceToVideoExists,
  writeVoiceToVideo,
  type VoiceToVideoMeta,
} from "../voiceToVideoMeta.js";
import * as db from "../db.js";
import { queue } from "../queue.js";
import { HttpError, isKebabCase, toKebabAscii, ensureDir, toRepoRel } from "../util.js";
import { probeDurationSec } from "../transcribe.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) =>
      cb(null, `v2v-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm", ".wma"]);

function reconcile(meta: VoiceToVideoMeta): VoiceToVideoMeta {
  if (meta.status !== "editing" || !meta.projectId) return meta;
  try {
    if (!projectExists(meta.projectId)) {
      return patchVoiceToVideo(meta.id, {
        status: "failed",
        error: `Project "${meta.projectId}" đã bị xóa - không còn gì để dựng.`,
      });
    }
    if (normOutput(readMeta(meta.projectId).output)) {
      return patchVoiceToVideo(meta.id, { status: "done", error: null });
    }
  } catch {
    // meta project con hỏng/đang ghi dở - giữ nguyên
  }
  return meta;
}

function readAll(): VoiceToVideoMeta[] {
  if (!fs.existsSync(paths.voiceToVideoDir)) return [];
  const out: VoiceToVideoMeta[] = [];
  for (const name of fs.readdirSync(paths.voiceToVideoDir)) {
    if (!voiceToVideoExists(name)) continue;
    try {
      out.push(reconcile(readVoiceToVideo(name)));
    } catch {
      // meta.json hỏng - bỏ qua
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mustRead(id: string): VoiceToVideoMeta {
  if (!isKebabCase(id)) throw new HttpError(400, "INVALID_ID", "id không hợp lệ");
  if (!voiceToVideoExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên "${id}"`);
  }
  return reconcile(readVoiceToVideo(id));
}

function uniqueId(name: string): string {
  const base = toKebabAscii(name) || "voice-to-video";
  let id = base;
  let n = 2;
  while (fs.existsSync(voiceToVideoDirOf(id))) id = `${base}-${n++}`;
  return id;
}

function assertNotBusy(meta: VoiceToVideoMeta): void {
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên "${meta.id}" đang có job chạy hoặc chờ trong hàng đợi.`,
    );
  }
}

// ------------------------------------------------------------------ Routes

/** GET /api/voice-to-video - Danh sách phiên */
router.get("/", (_req, res) => {
  res.json({ ok: true, data: readAll() });
});

/** POST /api/voice-to-video - Tạo phiên mới */
router.post("/", (req, res) => {
  const body = (req.body ?? {}) as { name?: string };
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const autoNamed = !rawName;
  const name = rawName || "Phiên Voice to Video mới";
  const id = uniqueId(name);

  const meta = defaultVoiceToVideoMeta(id, name);
  meta.autoNamed = autoNamed;
  writeVoiceToVideo(id, meta);

  res.status(201).json({ ok: true, data: meta });
});

/** GET /api/voice-to-video/:id - Chi tiết một phiên */
router.get("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  res.json({ ok: true, data: meta });
});

/** POST /api/voice-to-video/:id/upload - Upload file âm thanh */
router.post("/:id/upload", upload.single("file"), async (req, res) => {
  const id = req.params.id as string;
  const meta = mustRead(id);
  assertNotBusy(meta);

  if (!req.file) {
    throw new HttpError(400, "NO_FILE", "Vui lòng chọn file âm thanh để tải lên.");
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) {
    try { fs.rmSync(req.file.path, { force: true }); } catch { /* ignore */ }
    throw new HttpError(400, "INVALID_FORMAT", `Định dạng "${ext}" không được hỗ trợ (hỗ trợ .mp3, .wav, .m4a, .aac, .ogg, .flac, .webm).`);
  }

  const dir = voiceToVideoDirOf(id);
  ensureDir(dir);
  const destAudioName = `audio${ext}`;
  const destAudioAbs = path.join(dir, destAudioName);

  try {
    fs.copyFileSync(req.file.path, destAudioAbs);
    fs.rmSync(req.file.path, { force: true });
  } catch (err) {
    throw new HttpError(500, "STORAGE_ERROR", `Không thể lưu file âm thanh: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Đo thời lượng thực
  let durationSec: number | null = null;
  try {
    durationSec = await probeDurationSec(destAudioAbs);
  } catch {
    // ffprobe lỗi nhẹ - bỏ qua
  }

  const patch: Partial<VoiceToVideoMeta> = {
    audioFile: toRepoRel(destAudioAbs),
    originalFileName: req.file.originalname,
    audioDurationSec: durationSec,
    status: "draft",
    error: null,
  };

  // Tự động đặt tên phiên theo tên file nếu autoNamed
  if (meta.autoNamed) {
    const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname)).trim();
    if (baseName) {
      patch.name = baseName;
      patch.autoNamed = false;
    }
  }

  const updated = patchVoiceToVideo(id, patch);
  res.json({ ok: true, data: updated });
});

/** POST /api/voice-to-video/:id/transcribe - Bóc lời file âm thanh */
router.post("/:id/transcribe", async (req, res) => {
  const id = req.params.id as string;
  const meta = mustRead(id);
  assertNotBusy(meta);

  if (!meta.audioFile) {
    throw new HttpError(400, "NO_AUDIO", "Chưa có file âm thanh để bóc lời.");
  }
  const audioAbs = path.isAbsolute(meta.audioFile) ? meta.audioFile : path.join(repoRoot, meta.audioFile);
  if (!fs.existsSync(audioAbs)) {
    throw new HttpError(404, "AUDIO_NOT_FOUND", "Không tìm thấy file âm thanh trên đĩa.");
  }

  patchVoiceToVideo(id, { status: "transcribing", error: null });

  try {
    const dir = voiceToVideoDirOf(id);
    const transcriptAbs = path.join(dir, "transcript.json");

    await transcribeVideo({
      videoAbs: audioAbs,
      outJsonAbs: transcriptAbs,
      language: "vi",
    });

    const parsed = JSON.parse(fs.readFileSync(transcriptAbs, "utf8")) as {
      text?: string;
      segments?: Array<{ text: string }>;
    };
    const text =
      parsed.text ||
      (parsed.segments ? parsed.segments.map((s) => s.text).join(" ") : "");

    const updated = patchVoiceToVideo(id, {
      status: "ready",
      transcript: text.trim(),
      transcriptFile: toRepoRel(transcriptAbs),
      error: null,
    });

    res.json({ ok: true, data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    patchVoiceToVideo(id, { status: "failed", error: msg });
    throw new HttpError(500, "TRANSCRIBE_FAILED", `Bóc lời thất bại: ${msg}`);
  }
});

/** PATCH /api/voice-to-video/:id - Cập nhật thông tin phiên */
router.patch("/:id", (req, res) => {
  const id = req.params.id as string;
  const meta = mustRead(id);
  assertNotBusy(meta);

  const body = (req.body ?? {}) as {
    name?: string;
    transcript?: string;
    brief?: unknown;
    output?: Partial<VoiceToVideoMeta["output"]>;
    scriptModel?: string | null;
  };

  const patch: Partial<VoiceToVideoMeta> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
    patch.autoNamed = false;
  }
  if (typeof body.transcript === "string") {
    patch.transcript = body.transcript.trim();
  }
  if (body.brief && typeof body.brief === "object") {
    patch.brief = applyBriefPatch(meta.brief, body.brief as Record<string, unknown>);
  }
  if (body.output && typeof body.output === "object") {
    patch.output = {
      ...meta.output,
      ...body.output,
    };
  }
  if (body.scriptModel !== undefined) {
    patch.scriptModel = body.scriptModel;
  }

  const updated = patchVoiceToVideo(id, patch);
  res.json({ ok: true, data: updated });
});

/** POST /api/voice-to-video/:id/build - Đưa job dựng video vào queue */
router.post("/:id/build", (req, res) => {
  const id = req.params.id as string;
  const meta = mustRead(id);
  assertNotBusy(meta);

  if (!meta.audioFile) {
    throw new HttpError(400, "NO_AUDIO", "Chưa có file âm thanh để dựng video.");
  }
  if (meta.projectId && projectExists(meta.projectId)) {
    throw new HttpError(400, "PROJECT_EXISTS", `Phiên này đã tạo project "${meta.projectId}" rồi.`);
  }

  const jobId = `job_v2v_${nanoid()}`;
  db.createJob({
    id: jobId,
    type: "voice-to-video",
    projectId: id,
  });

  patchVoiceToVideo(id, { status: "building", error: null });
  queue.enqueue(jobId);

  res.status(202).json({ ok: true, data: { jobId, status: "building" } });
});

/** DELETE /api/voice-to-video/:id - Xóa phiên */
router.delete("/:id", (req, res) => {
  const id = req.params.id as string;
  const meta = mustRead(id);
  assertNotBusy(meta);

  const dir = voiceToVideoDirOf(id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // bỏ qua lỗi xóa thư mục
  }

  res.json({ ok: true, data: { id } });
});

export default router;
