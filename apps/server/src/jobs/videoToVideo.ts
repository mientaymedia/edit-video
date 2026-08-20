import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../config.js";
import { createChildProject, prepareEditSession } from "../childProject.js";
import { normOutput, readMeta, writeMeta } from "../meta.js";
import { runAgent } from "../agent.js";
import { transcribeVideo } from "../transcribe.js";
import { probeVideo } from "../reframe.js";
import {
  aspectToDimensions,
  readVideoToVideoMeta,
  videoToVideoDirOf,
  writeVideoToVideoMeta,
  type VideoToVideoMeta,
} from "../videoToVideoMeta.js";
import { ensureDir, toRepoRel } from "../util.js";
import type { JobCtx } from "../queue.js";

export async function runVideoToVideo(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const meta = readVideoToVideoMeta(id);

  try {
    await build(ctx, meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.isCanceled()) {
      meta.status = "ready";
      meta.error = null;
      writeVideoToVideoMeta(meta);
    } else {
      meta.status = "failed";
      meta.error = message;
      writeVideoToVideoMeta(meta);
    }
    throw err;
  }
}

async function build(ctx: JobCtx, meta: VideoToVideoMeta): Promise<void> {
  const id = meta.id;
  const dir = videoToVideoDirOf(id);

  if (!meta.source.file) {
    throw new Error("Chưa có video nguồn - hãy tải video lên trước khi dựng.");
  }

  const videoAbs = path.join(dir, meta.source.file);
  if (!fs.existsSync(videoAbs)) {
    throw new Error(`Không tìm thấy file video nguồn tại: ${meta.source.file}`);
  }

  if (meta.projectId) {
    throw new Error(`Phiên này đã tạo project "${meta.projectId}" rồi.`);
  }

  // 1. Probe video nếu chưa có thông số
  ctx.progress(5, "Đọc thông số kỹ thuật video nguồn...");
  const probe = await probeVideo(videoAbs);
  meta.source.width = probe.width;
  meta.source.height = probe.height;
  meta.source.fps = probe.fps;
  meta.source.durationSec = probe.durationSec;
  writeVideoToVideoMeta(meta);

  // 2. Bóc lời có word timestamps (nếu chưa bóc)
  let transcriptAbs = path.join(dir, "transcript.json");
  if (!fs.existsSync(transcriptAbs) || !meta.transcript.trim()) {
    ctx.progress(15, "Đang bóc lời thoại và lấy mốc thời gian từng từ...");
    meta.status = "transcribing";
    writeVideoToVideoMeta(meta);

    await transcribeVideo({
      videoAbs,
      outJsonAbs: transcriptAbs,
      language: "vi",
      onLog: (line) => ctx.log(line),
      isCanceled: () => ctx.isCanceled(),
    });

    try {
      const parsed = JSON.parse(fs.readFileSync(transcriptAbs, "utf8")) as {
        text?: string;
        segments?: Array<{ text: string }>;
      };
      const text =
        parsed.text ||
        (parsed.segments ? parsed.segments.map((s) => s.text).join(" ") : "");
      meta.transcript = text.trim();
      meta.transcriptFile = toRepoRel(transcriptAbs);
      writeVideoToVideoMeta(meta);
    } catch {
      // bỏ qua lỗi parse
    }
  }

  // 3. Tạo project con
  ctx.progress(35, "Tạo cấu trúc video project...");
  meta.status = "building";
  writeVideoToVideoMeta(meta);

  const dims = aspectToDimensions(meta.output.aspect);
  const ext = path.extname(videoAbs).toLowerCase() || ".mp4";
  const sourceDestName = `source${ext}`;

  const copyFiles: Array<{ srcAbs: string; destRel: string }> = [
    { srcAbs: videoAbs, destRel: sourceDestName },
  ];

  if (fs.existsSync(transcriptAbs)) {
    copyFiles.push({ srcAbs: transcriptAbs, destRel: "transcript.json" });
  }

  const summary = createChildProject({
    parentId: null,
    name: meta.name,
    width: dims.width,
    height: dims.height,
    fps: meta.output.fps,
    brief: {
      ...meta.brief,
      sourceDescription: `Tái cấu trúc & Dựng lại từ video nguồn "${meta.source.originalFileName || meta.name}" (${probe.width}x${probe.height}, ${probe.durationSec.toFixed(1)}s). Chế độ reframe: ${meta.reframeMode}. Chế độ audio: ${meta.audioMode}. Lời thoại: ${meta.transcript.slice(0, 300)}...`,
      notes: [
        `TÁI CẤU TRÚC & BIẾN ĐỔI VIDEO NGUỒN (Video to Video).`,
        `Video nguồn đặt trong assets/${sourceDestName} (${probe.width}x${probe.height}, ${probe.durationSec.toFixed(1)}s).`,
        `Tỷ lệ khung hình xuất: ${meta.output.aspect} (${dims.width}x${dims.height}).`,
        `Chế độ chuyển đổi khung hình (Reframe): ${meta.reframeMode}. (Nếu từ 16:9 sang 9:16: áp dụng mờ nền blur-fit hoặc smart-crop).`,
        meta.audioMode === "keep-original"
          ? `Giữ nguyên âm thanh của video nguồn.`
          : meta.audioMode === "replace-bgm"
            ? `Thay thế/phối thêm nhạc nền BGM từ thư viện assets/music.`
            : `Lồng tiếng mới.`,
        meta.brief.notes.trim(),
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    copyFiles,
  });

  const projectMeta = readMeta(summary.id);
  (projectMeta as unknown as Record<string, unknown>).videoToVideoId = id;
  writeMeta(summary.id, projectMeta);

  meta.status = "editing";
  meta.projectId = summary.id;
  writeVideoToVideoMeta(meta);

  ctx.log(`[video-to-video] Đã tạo project "${summary.id}"`);

  // 4. Khởi động AI đạo diễn
  ctx.progress(65, "AI đạo diễn bắt đầu biên tập và dựng video...");
  const session = prepareEditSession({
    id: summary.id,
    meta: readMeta(summary.id),
  });

  void runAgent(session.sessionId, session.prompt)
    .then(() => {
      const child = readMeta(summary.id);
      if (normOutput(child.output)) {
        meta.status = "done";
        meta.error = null;
        writeVideoToVideoMeta(meta);
      } else {
        meta.status = "failed";
        meta.error = "Phiên edit kết thúc nhưng chưa tạo ra file video output.";
        writeVideoToVideoMeta(meta);
      }
    })
    .catch((err) => {
      meta.status = "failed";
      meta.error = err instanceof Error ? err.message : String(err);
      writeVideoToVideoMeta(meta);
    });
}
