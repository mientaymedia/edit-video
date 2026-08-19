import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { transcribeVideo } from "../transcribe.js";
import { probeVideo } from "../reframe.js";
import {
  changeVoiceVideoDirOf,
  readChangeVoiceVideoMeta,
  writeChangeVoiceVideoMeta,
  type ChangeVoiceCue,
  type ChangeVoiceVideoMeta,
} from "../changeVoiceVideoMeta.js";
import { synthDubCue, DUB_TEMPO_MAX, DUB_TEMPO_MIN, DUB_TEMPO_DEADBAND } from "../dub.js";
import { ensureDir, execFileCaptureAll, ffprobeDurationMs } from "../util.js";
import type { JobCtx } from "../queue.js";

async function probeSeconds(absFile: string): Promise<number> {
  const ms = await ffprobeDurationMs(absFile);
  if (ms === null || ms <= 0) {
    throw new Error(`Không đo được thời lượng ${path.basename(absFile)} bằng ffprobe.`);
  }
  return ms / 1000;
}

async function runFfmpeg(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; isCanceled?: () => boolean } = {}
): Promise<void> {
  const r = await execFileCaptureAll(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-y", ...args],
    {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 300_000,
      isCanceled: opts.isCanceled,
    }
  );
  if (r.canceled) throw new Error("Job đã bị hủy");
  if (r.timedOut) throw new Error("ffmpeg chạy quá thời gian cho phép");
  if (r.code !== 0) {
    const tail = r.stderr.split(/\r?\n/).slice(-12).join("\n");
    throw new Error(`ffmpeg thất bại (mã ${r.code}):\n${tail}`);
  }
}

export async function runChangeVoiceVideo(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const meta = readChangeVoiceVideoMeta(id);

  try {
    await processChangeVoice(ctx, meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.isCanceled()) {
      meta.status = "ready";
      meta.error = null;
      writeChangeVoiceVideoMeta(meta);
    } else {
      meta.status = "failed";
      meta.error = message;
      writeChangeVoiceVideoMeta(meta);
    }
    throw err;
  }
}

async function processChangeVoice(
  ctx: JobCtx,
  meta: ChangeVoiceVideoMeta
): Promise<void> {
  const id = meta.id;
  const dir = changeVoiceVideoDirOf(id);

  if (!meta.source.file) {
    throw new Error("Chưa có file video nguồn để xử lý.");
  }

  const videoAbs = path.join(dir, meta.source.file);
  if (!fs.existsSync(videoAbs)) {
    throw new Error(`Không tìm thấy file video nguồn tại: ${meta.source.file}`);
  }

  // 1. Probe video
  ctx.progress(5, "Đọc thông số video nguồn...");
  const probe = await probeVideo(videoAbs);
  meta.source.width = probe.width;
  meta.source.height = probe.height;
  meta.source.fps = probe.fps;
  meta.source.durationSec = probe.durationSec;
  writeChangeVoiceVideoMeta(meta);

  // 2. Bóc lời nếu chưa có cues
  if (!meta.cues || meta.cues.length === 0) {
    ctx.progress(15, "Đang bóc tách lời thoại và phân đoạn câu...");
    meta.status = "transcribing";
    writeChangeVoiceVideoMeta(meta);

    const outJsonAbs = path.join(dir, "transcript.json");
    await transcribeVideo({
      videoAbs,
      outJsonAbs,
      language: "vi",
      onLog: (line) => ctx.log(line),
      isCanceled: () => ctx.isCanceled(),
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
      writeChangeVoiceVideoMeta(meta);
    } catch {
      // bỏ qua parse error
    }
  }

  // 3. Tổng hợp TTS cho từng câu thoại
  meta.status = "rendering";
  writeChangeVoiceVideoMeta(meta);

  const workDir = path.join(dir, "tts-work");
  ensureDir(workDir);

  const activeCues = meta.cues.filter((c) => c.text.trim().length > 0);
  if (activeCues.length === 0) {
    throw new Error("Không có câu thoại nào để đọc");
  }

  ctx.progress(30, `Đang tạo giọng đọc mới cho ${activeCues.length} câu thoại...`);

  const cueWavs: Array<{ cue: ChangeVoiceCue; wavAbs: string }> = [];

  for (let i = 0; i < activeCues.length; i++) {
    if (ctx.isCanceled()) throw new Error("Job đã bị hủy");
    const cue = activeCues[i];
    const cueWorkDir = path.join(workDir, `cue-${i}`);
    ensureDir(cueWorkDir);
    const rawWavAbs = path.join(cueWorkDir, "raw.wav");
    const fitWavAbs = path.join(cueWorkDir, "fit.wav");

    const voice = cue.voice || meta.voiceSettings.voice;
    const engine = meta.voiceSettings.engine;
    const speed = cue.speed || meta.voiceSettings.speed || 1.0;

    // Sinh TTS câu thô
    await synthDubCue({
      text: cue.text,
      voice,
      engine,
      language: "vi-VN",
      workDir: cueWorkDir,
      outWavAbs: rawWavAbs,
    });

    // Đo thời lượng câu vừa sinh
    const rawDuration = await probeSeconds(rawWavAbs);
    const targetDuration = Math.max(0.2, cue.end - cue.start);

    // Tính ratio co giãn (Isochrony alignment)
    let tempo = speed;
    if (rawDuration > targetDuration) {
      const needed = rawDuration / targetDuration;
      tempo = Math.min(DUB_TEMPO_MAX, Math.max(DUB_TEMPO_MIN, needed * speed));
    }

    if (Math.abs(tempo - 1.0) > DUB_TEMPO_DEADBAND) {
      await runFfmpeg(
        ["-i", rawWavAbs, "-af", `atempo=${tempo.toFixed(4)}`, fitWavAbs],
        { isCanceled: () => ctx.isCanceled() }
      );
      cueWavs.push({ cue, wavAbs: fitWavAbs });
    } else {
      cueWavs.push({ cue, wavAbs: rawWavAbs });
    }

    const pct = Math.round(30 + ((i + 1) / activeCues.length) * 35);
    ctx.progress(pct, `Đã tạo giọng đọc ${i + 1}/${activeCues.length} câu...`);
  }

  // 4. Lắp ráp track âm thanh giọng đọc mới
  ctx.progress(70, "Ghép các câu thoại theo đúng mốc thời gian...");
  const voiceTrackAbs = path.join(dir, "new_voice_track.wav");

  // Dùng adelay + amix của ffmpeg để đặt từng câu ở mốc tuyệt đối
  const ffmpegInputs: string[] = [];
  const filterParts: string[] = [];

  for (let i = 0; i < cueWavs.length; i++) {
    const { cue, wavAbs } = cueWavs[i];
    ffmpegInputs.push("-i", wavAbs);
    const delayMs = Math.max(0, Math.round(cue.start * 1000));
    filterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
  }

  const mixInputs = cueWavs.map((_, i) => `[a${i}]`).join("");
  const voiceVol = meta.audioMix.voiceVolume ?? 1.0;
  const fullFilter = `${filterParts.join(";")};${mixInputs}amix=inputs=${cueWavs.length}:dropout_transition=0:normalize=0,volume=${voiceVol.toFixed(2)}[outa]`;

  await runFfmpeg(
    [
      ...ffmpegInputs,
      "-filter_complex",
      fullFilter,
      "-map",
      "[outa]",
      "-t",
      String(probe.durationSec.toFixed(3)),
      voiceTrackAbs,
    ],
    { isCanceled: () => ctx.isCanceled() }
  );

  // 5. Phối âm với Video gốc & Render (Triệt tiêu giọng cũ)
  ctx.progress(85, "Phối âm thanh và xuất video chất lượng cao...");
  const outputFileName = "output.mp4";
  const outputAbs = path.join(dir, outputFileName);

  const bgmVol = meta.audioMix.bgmVolume ?? 0.15;

  if (meta.audioMix.mode === "mute-dialogue-ranges" && cueWavs.length > 0) {
    // Tắt tiếng gốc tại các mốc thời gian có thoại để triệt tiêu giọng cũ, giữ âm thanh ở khoảng nghỉ
    const volumeFilters = cueWavs
      .map(
        ({ cue }) =>
          `volume=enable='between(t,${Math.max(0, cue.start - 0.1).toFixed(2)},${(cue.end + 0.1).toFixed(2)})':volume=0`
      )
      .join(",");

    const mixArgs: string[] = [
      "-i",
      videoAbs,
      "-i",
      voiceTrackAbs,
      "-filter_complex",
      `[0:a]${volumeFilters}[cleaned];[cleaned][1:a]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputAbs,
    ];
    await runFfmpeg(mixArgs, { isCanceled: () => ctx.isCanceled() });
  } else if (meta.audioMix.mode === "keep-bgm-ducking") {
    // Giữ nhạc nền video gốc nhưng giảm âm lượng xuống bgmVol khi mix cùng giọng mới
    const mixArgs: string[] = [
      "-i",
      videoAbs,
      "-i",
      voiceTrackAbs,
      "-filter_complex",
      `[0:a]volume=${bgmVol.toFixed(2)}[bgm];[bgm][1:a]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputAbs,
    ];
    await runFfmpeg(mixArgs, { isCanceled: () => ctx.isCanceled() });
  } else {
    // Mute hoàn toàn audio gốc, chỉ dùng giọng mới (Triệt tiêu 100% giọng cũ)
    const mixArgs: string[] = [
      "-i",
      videoAbs,
      "-i",
      voiceTrackAbs,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputAbs,
    ];
    await runFfmpeg(mixArgs, { isCanceled: () => ctx.isCanceled() });
  }

  // 6. Hoàn tất
  meta.status = "done";
  meta.output.file = outputFileName;
  meta.output.durationSec = probe.durationSec;
  meta.error = null;
  writeChangeVoiceVideoMeta(meta);

  ctx.progress(100, "Đổi giọng đọc video thành công!");
}
