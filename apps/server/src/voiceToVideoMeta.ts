import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { defaultBrief, briefOf, type Brief, type ProjectMeta } from "./meta.js";
import { isKebabCase } from "./util.js";

/**
 * Voice to video - phiên dựng video từ file âm thanh / giọng đọc có sẵn.
 *
 * Người dùng tải lên file âm thanh (Audio / Voice / Podcast / Voiceover),
 * hệ thống bóc lời tự động (faster-whisper/STT) tạo transcript có timestamp,
 * phân cảnh, vẽ ảnh minh họa đồng bộ Style Design & Phong cách dựng,
 * ghép track audio gốc làm âm thanh chính và dựng thành video hoàn chỉnh.
 */

export type VoiceToVideoStatus =
  | "draft"
  | "transcribing"
  | "ready"
  | "building"
  | "editing"
  | "done"
  | "failed";

export interface VoiceToVideoOutput {
  aspect: "9:16" | "16:9" | "1:1" | "4:5";
  fps: number;
  quality: "draft" | "high";
}

export function defaultOutput(): VoiceToVideoOutput {
  return { aspect: "9:16", fps: 30, quality: "high" };
}

export interface VoiceToVideoMeta {
  id: string;
  name: string;
  autoNamed: boolean;
  /** File âm thanh tải lên (đường dẫn tương đối repo, vd "voice-to-video/xxx/audio.mp3") */
  audioFile: string | null;
  /** Tên gốc của file khi người dùng upload */
  originalFileName: string | null;
  /** Thời lượng ĐO ĐƯỢC bằng ffprobe của file âm thanh (giây) */
  audioDurationSec: number | null;
  /** Engine bóc lời: "local" (faster-whisper trên máy) hoặc provider khác */
  sttEngine: string;
  /** Toàn bộ lời thoại bóc được hoặc do người dùng sửa */
  transcript: string;
  /** File transcript có word timestamp (đường dẫn tương đối repo) */
  transcriptFile: string | null;
  /** File phụ đề SRT (đường dẫn tương đối repo) */
  subtitlesFile: string | null;
  /** Model AI đạo diễn dựng video / phân cảnh */
  scriptModel: string | null;
  output: VoiceToVideoOutput;
  /** Brief cho Videos Project sinh ra */
  brief: Brief;
  /** id của Videos Project đã sinh ra - null = chưa dựng */
  projectId: string | null;
  status: VoiceToVideoStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function voiceToVideoDirOf(id: string): string {
  return path.join(paths.voiceToVideoDir, id);
}

export function voiceToVideoMetaPathOf(id: string): string {
  return path.join(voiceToVideoDirOf(id), "meta.json");
}

export function voiceToVideoExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(voiceToVideoMetaPathOf(id));
}

export function defaultVoiceToVideoMeta(id: string, name: string): VoiceToVideoMeta {
  const now = new Date().toISOString();
  const brief = defaultBrief();
  // Giữ âm thanh gốc không cắt xén tự động trừ khi người dùng bật
  brief.autoCut = false;
  return {
    id,
    name,
    autoNamed: false,
    audioFile: null,
    originalFileName: null,
    audioDurationSec: null,
    sttEngine: "local",
    transcript: "",
    transcriptFile: null,
    subtitlesFile: null,
    scriptModel: null,
    output: defaultOutput(),
    brief,
    projectId: null,
    status: "draft",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Đọc meta từ đĩa, vá field thiếu bằng mặc định */
export function readVoiceToVideo(id: string): VoiceToVideoMeta {
  const raw = JSON.parse(fs.readFileSync(voiceToVideoMetaPathOf(id), "utf8")) as Record<
    string,
    unknown
  >;
  const base = defaultVoiceToVideoMeta(id, typeof raw.name === "string" ? raw.name : id);
  const out = (raw.output ?? {}) as Record<string, unknown>;
  return {
    ...base,
    autoNamed: raw.autoNamed === true,
    audioFile: typeof raw.audioFile === "string" ? raw.audioFile : null,
    originalFileName: typeof raw.originalFileName === "string" ? raw.originalFileName : null,
    audioDurationSec:
      typeof raw.audioDurationSec === "number" && Number.isFinite(raw.audioDurationSec)
        ? raw.audioDurationSec
        : null,
    sttEngine: typeof raw.sttEngine === "string" ? raw.sttEngine : "local",
    transcript: typeof raw.transcript === "string" ? raw.transcript : "",
    transcriptFile: typeof raw.transcriptFile === "string" ? raw.transcriptFile : null,
    subtitlesFile: typeof raw.subtitlesFile === "string" ? raw.subtitlesFile : null,
    scriptModel: typeof raw.scriptModel === "string" && raw.scriptModel ? raw.scriptModel : null,
    output: {
      aspect:
        out.aspect === "16:9" || out.aspect === "1:1" || out.aspect === "4:5"
          ? out.aspect
          : "9:16",
      fps: typeof out.fps === "number" && Number.isFinite(out.fps) ? out.fps : 30,
      quality: out.quality === "draft" ? "draft" : "high",
    },
    brief: briefOf({ brief: raw.brief } as ProjectMeta),
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    status:
      raw.status === "transcribing" ||
      raw.status === "ready" ||
      raw.status === "building" ||
      raw.status === "editing" ||
      raw.status === "done" ||
      raw.status === "failed"
        ? raw.status
        : "draft",
    error: typeof raw.error === "string" ? raw.error : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeVoiceToVideo(id: string, meta: VoiceToVideoMeta): void {
  const dir = voiceToVideoDirOf(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(voiceToVideoMetaPathOf(id), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

export function patchVoiceToVideo(id: string, patch: Partial<VoiceToVideoMeta>): VoiceToVideoMeta {
  const current = readVoiceToVideo(id);
  const updated: VoiceToVideoMeta = {
    ...current,
    ...patch,
    id: current.id, // không bao giờ đổi id qua patch
    updatedAt: new Date().toISOString(),
  };
  writeVoiceToVideo(id, updated);
  return updated;
}
