import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../config.js";
import { createChildProject, prepareEditSession } from "../childProject.js";
import { normOutput, readMeta, writeMeta } from "../meta.js";
import { runAgent } from "../agent.js";
import { transcribeVideo } from "../transcribe.js";
import {
  patchVoiceToVideo,
  readVoiceToVideo,
  voiceToVideoDirOf,
  type VoiceToVideoMeta,
} from "../voiceToVideoMeta.js";
import { ensureDir, toRepoRel } from "../util.js";
import type { JobCtx } from "../queue.js";
import * as db from "../db.js";

/**
 * Job "voice-to-video": File âm thanh giọng đọc → Bóc lời / Timestamps → Videos Project.
 *
 * Tận dụng toàn bộ pipeline Videos Project chuẩn:
 * createChildProject → prepareEditSession → runAgent (Antigravity hoặc Claude).
 */

function aspectToDimensions(aspect: "9:16" | "16:9" | "1:1" | "4:5"): { width: number; height: number } {
  switch (aspect) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "9:16":
    default:
      return { width: 1080, height: 1920 };
  }
}

export async function runVoiceToVideo(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const meta = readVoiceToVideo(id);

  try {
    await build(ctx, meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.isCanceled()) {
      patchVoiceToVideo(id, { status: "ready", error: null });
    } else {
      patchVoiceToVideo(id, { status: "failed", error: message });
    }
    throw err;
  }
}

async function build(ctx: JobCtx, meta: VoiceToVideoMeta): Promise<void> {
  const id = meta.id;
  const dir = voiceToVideoDirOf(id);

  if (!meta.audioFile) {
    throw new Error("Chưa có file âm thanh - tải file âm thanh lên trước khi dựng video.");
  }
  const audioAbs = path.isAbsolute(meta.audioFile)
    ? meta.audioFile
    : path.join(repoRoot, meta.audioFile);

  if (!fs.existsSync(audioAbs)) {
    throw new Error(`Không tìm thấy file âm thanh tại: ${meta.audioFile}`);
  }

  if (meta.projectId) {
    throw new Error(
      `Phiên này đã tạo project "${meta.projectId}" rồi - xóa project đó hoặc tạo phiên mới.`,
    );
  }

  // ---- 1. Bóc lời có word timestamp (nếu chưa bóc) -------------------------
  let transcriptAbs = path.join(dir, "transcript.json");
  if (!fs.existsSync(transcriptAbs) || !meta.transcript.trim()) {
    patchVoiceToVideo(id, { status: "transcribing", error: null });
    ctx.progress(10, "Đang bóc lời và lấy mốc thời gian từng từ");

    await transcribeVideo({
      videoAbs: audioAbs,
      outJsonAbs: transcriptAbs,
      language: "vi",
      onLog: (line) => ctx.log(line),
      isCanceled: () => ctx.isCanceled(),
    });
    if (ctx.isCanceled()) throw new Error("Job đã bị hủy");

    try {
      const parsed = JSON.parse(fs.readFileSync(transcriptAbs, "utf8")) as {
        text?: string;
        segments?: Array<{ text: string }>;
      };
      const text =
        parsed.text ||
        (parsed.segments ? parsed.segments.map((s) => s.text).join(" ") : "");
      patchVoiceToVideo(id, {
        transcript: text.trim(),
        transcriptFile: toRepoRel(transcriptAbs),
      });
    } catch {
      // bỏ qua nếu lỗi parse
    }
  }

  // ---- 2. Bàn giao cho pipeline Videos Project ------------------------------
  ctx.progress(40, "Tạo Videos Project");
  patchVoiceToVideo(id, { status: "building" });

  const fresh = readVoiceToVideo(id);
  const dims = aspectToDimensions(fresh.output.aspect);
  const ext = path.extname(audioAbs).toLowerCase() || ".mp3";
  const voiceDestName = `voice${ext}`;

  const summary = createChildProject({
    parentId: null,
    name: fresh.name,
    width: dims.width,
    height: dims.height,
    fps: fresh.output.fps,
    brief: {
      ...fresh.brief,
      sourceDescription: `Dựng video từ file âm thanh giọng đọc "${fresh.originalFileName || fresh.name}". Sử dụng âm thanh gốc làm track thuyết minh chính. Lời thoại đã bóc: ${fresh.transcript.slice(0, 300)}...`,
      notes: [
        "Sử dụng đúng file âm thanh giọng đọc gốc trong assets làm track voice chính từ frame 0.",
        fresh.brief.notes.trim(),
      ].filter(Boolean).join("\n\n"),
    },
    copyFiles: [
      { srcAbs: audioAbs, destRel: voiceDestName },
      { srcAbs: transcriptAbs, destRel: "transcript.json" },
    ],
  });

  // Gắn sẵn file âm thanh gốc vào khối audio
  const projectMeta = readMeta(summary.id);
  projectMeta.audio = {
    ...(projectMeta.audio ?? { voice: null, sfx: [] }),
    voice: `video-projects/${summary.id}/assets/${voiceDestName}`,
  };
  (projectMeta as unknown as Record<string, unknown>).voiceToVideoId = id;
  writeMeta(summary.id, projectMeta);

  patchVoiceToVideo(id, { projectId: summary.id, status: "editing", error: null });
  ctx.log(`[voice-to-video] đã tạo project "${summary.id}"`);

  // ---- 3. Khởi động phiên edit AI ------------------------------------------
  ctx.progress(70, "Bắt đầu AI dựng video");
  const session = prepareEditSession({
    id: summary.id,
    meta: readMeta(summary.id),
    model: fresh.scriptModel,
  });

  if (fresh.scriptModel) {
    db.setChatSessionModelEffort(session.sessionId, fresh.scriptModel);
  }

  void runAgent(session.sessionId, session.prompt)
    .then(() => {
      const child = readMeta(summary.id);
      if (normOutput(child.output)) {
        patchVoiceToVideo(id, { status: "done", error: null });
      } else {
        patchVoiceToVideo(id, {
          status: "failed",
          error: "Phiên edit kết thúc nhưng chưa tạo ra file video output.",
        });
      }
    })
    .catch((err) => {
      patchVoiceToVideo(id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });

  ctx.progress(100, "Đã bàn giao cho AI dựng video");
}
