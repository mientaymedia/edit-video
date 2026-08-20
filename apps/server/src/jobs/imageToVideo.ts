import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../config.js";
import { createChildProject, prepareEditSession } from "../childProject.js";
import { normOutput, readMeta, writeMeta } from "../meta.js";
import { runAgent } from "../agent.js";
import { transcribeVideo } from "../transcribe.js";
import { synthScript } from "../tts.js";
import {
  aspectToDimensions,
  imageToVideoDirOf,
  readImageToVideoMeta,
  writeImageToVideoMeta,
  type ImageToVideoMeta,
} from "../imageToVideoMeta.js";
import { geminiApiKey } from "../gemini.js";
import { ensureDir, toRepoRel } from "../util.js";
import type { JobCtx } from "../queue.js";
import * as db from "../db.js";

/**
 * Phân tích hình ảnh bằng Gemini Multimodal Vision và sinh lời thuyết minh kịch bản.
 */
export async function analyzeImagesVision(id: string): Promise<string> {
  const meta = readImageToVideoMeta(id);
  const dir = imageToVideoDirOf(id);

  if (meta.images.length === 0) {
    throw new Error("Chưa có ảnh nào để phân tích");
  }

  const apiKey = geminiApiKey();
  if (!apiKey) {
    throw new Error("Chưa cấu hình Google API Key (GEMINI_API_KEY hoặc GOOGLE_API_KEY) để phân tích ảnh");
  }

  const parts: any[] = [];

  for (const img of meta.images.slice(0, 5)) {
    const imgAbs = path.join(dir, img.file);
    if (fs.existsSync(imgAbs)) {
      const ext = path.extname(img.file).toLowerCase().replace(".", "");
      const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const base64Data = fs.readFileSync(imgAbs).toString("base64");
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      });
    }
  }

  parts.push({
    text: `Bạn là một chuyên gia biên kịch video ngắn (TikTok, Reels, Shorts). Hãy phân tích kỹ các hình ảnh trên và viết một đoạn lời thuyết minh (voiceover) hoặc thông điệp ngắn gọn, cuốn hút, giàu cảm xúc, tự nhiên bằng tiếng Việt (khoảng 2-4 câu, 30-60 từ) để lồng vào video tạo từ những bức ảnh này. Chỉ trả về nội dung lời đọc thuần túy, không thêm tiêu đề, chú thích hay dấu ngoặc kép.`,
  });

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini Vision API lỗi (${resp.status}): ${errText}`);
  }

  const data = (await resp.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return text;
}

export async function runImageToVideo(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const meta = readImageToVideoMeta(id);

  try {
    await build(ctx, meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.isCanceled()) {
      meta.status = "draft";
      meta.error = null;
      writeImageToVideoMeta(meta);
    } else {
      meta.status = "failed";
      meta.error = message;
      writeImageToVideoMeta(meta);
    }
    throw err;
  }
}

async function build(ctx: JobCtx, meta: ImageToVideoMeta): Promise<void> {
  const id = meta.id;
  const dir = imageToVideoDirOf(id);

  if (meta.images.length === 0) {
    throw new Error("Chưa có ảnh nào. Vui lòng tải ít nhất 1 ảnh lên trước khi dựng video.");
  }

  if (meta.projectId) {
    throw new Error(`Phiên này đã tạo project "${meta.projectId}" rồi.`);
  }

  ctx.progress(5, "Chuẩn bị tài nguyên hình ảnh...");
  meta.status = "building";
  meta.error = null;
  writeImageToVideoMeta(meta);

  // 1. Voiceover (nếu có kịch bản và bật voiceover)
  let voiceAudioAbs: string | null = null;
  let transcriptAbs: string | null = null;
  let totalDurationSec = meta.durationSec || 10;

  if (meta.voiceover?.enabled && meta.script.trim()) {
    ctx.progress(15, "Đang tạo giọng đọc AI (TTS)...");
    const outWavAbs = path.join(dir, "voiceover.wav");

    try {
      const ttsResult = await synthScript({
        chunks: [meta.script.trim()],
        voice: meta.voiceover.voiceId || "Puck",
        engine: (meta.voiceover.provider as any) || "gemini",
        speed: meta.voiceover.speed || 1.0,
        workDir: path.join(dir, "tts-work"),
        outWavAbs,
        onLog: (line) => ctx.log(line),
        isCanceled: () => ctx.isCanceled(),
      });

      voiceAudioAbs = ttsResult.wavAbs;
      meta.voiceover.audioFile = toRepoRel(voiceAudioAbs);

      ctx.progress(25, "Bóc lời giọng đọc để đồng bộ phụ đề...");
      transcriptAbs = path.join(dir, "transcript.json");
      await transcribeVideo({
        videoAbs: voiceAudioAbs,
        outJsonAbs: transcriptAbs,
        language: "vi",
        onLog: (line) => ctx.log(line),
        isCanceled: () => ctx.isCanceled(),
      });

      if (ttsResult.durationSec && ttsResult.durationSec > 0) {
        totalDurationSec = Math.max(5, Math.ceil(ttsResult.durationSec + 1.5));
      }
    } catch (e) {
      ctx.log(`[image-to-video] Không tạo được TTS: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Tạo project con
  ctx.progress(35, "Tạo cấu trúc video project...");
  const dims = aspectToDimensions(meta.output.aspect);

  const copyFiles: Array<{ srcAbs: string; destRel: string }> = [];

  // Copy các ảnh vào project assets
  for (let i = 0; i < meta.images.length; i++) {
    const imgItem = meta.images[i];
    const srcImgAbs = path.join(dir, imgItem.file);
    if (fs.existsSync(srcImgAbs)) {
      copyFiles.push({
        srcAbs: srcImgAbs,
        destRel: `image_${i + 1}_${imgItem.file}`,
      });
    }
  }

  // Copy voiceover & transcript nếu có
  if (voiceAudioAbs && fs.existsSync(voiceAudioAbs)) {
    copyFiles.push({ srcAbs: voiceAudioAbs, destRel: "voiceover.wav" });
  }
  if (transcriptAbs && fs.existsSync(transcriptAbs)) {
    copyFiles.push({ srcAbs: transcriptAbs, destRel: "transcript.json" });
  }

  const numImages = meta.images.length;
  const secPerImage = (totalDurationSec / numImages).toFixed(1);

  const summary = createChildProject({
    parentId: null,
    name: meta.name,
    width: dims.width,
    height: dims.height,
    fps: meta.output.fps,
    brief: {
      ...meta.brief,
      sourceDescription: `Dựng video từ bộ sưu tập ${numImages} ảnh (Image to Video). Tổng thời lượng video: ${totalDurationSec}s (~${secPerImage}s/ảnh). Hiệu ứng chuyển động camera chủ đạo: ${meta.motionDefault}. ${meta.script ? `Lời bình: ${meta.script}` : ""}`,
      notes: [
        `DỰNG VIDEO CHUYỂN ĐỘNG TỪ ẢNH (Image to Video).`,
        `Sử dụng các file ảnh trong assets/ (image_1_*, image_2_...) làm các cảnh video chính.`,
        `Áp dụng hiệu ứng camera chuyển động mượt mà (Ken Burns, Pan, Zoom, Parallax) cho từng ảnh.`,
        voiceAudioAbs ? `Gắn file voiceover.wav trong assets làm track thuyết minh chính từ frame 0.` : ``,
        meta.brief.notes.trim(),
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    copyFiles,
  });

  const projectMeta = readMeta(summary.id);
  if (voiceAudioAbs) {
    projectMeta.audio = {
      ...(projectMeta.audio ?? { voice: null, sfx: [] }),
      voice: `video-projects/${summary.id}/assets/voiceover.wav`,
    };
  }
  (projectMeta as unknown as Record<string, unknown>).imageToVideoId = id;
  writeMeta(summary.id, projectMeta);

  meta.status = "editing";
  meta.projectId = summary.id;
  writeImageToVideoMeta(meta);

  ctx.log(`[image-to-video] Đã tạo project "${summary.id}"`);

  // 3. Khởi động phiên AI đạo diễn
  ctx.progress(65, "AI đạo diễn bắt đầu dựng video...");
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
        writeImageToVideoMeta(meta);
      } else {
        meta.status = "failed";
        meta.error = "Phiên edit kết thúc nhưng chưa tạo ra file video output.";
        writeImageToVideoMeta(meta);
      }
    })
    .catch((err) => {
      meta.status = "failed";
      meta.error = err instanceof Error ? err.message : String(err);
      writeImageToVideoMeta(meta);
    });
}
