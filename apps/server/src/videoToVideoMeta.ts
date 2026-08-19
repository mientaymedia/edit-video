import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { defaultBrief, type Brief } from "./meta.js";
import { HttpError, ensureDir, isKebabCase, nowIso, toKebabAscii } from "./util.js";

export type VideoToVideoStatus =
  | "draft"
  | "transcribing"
  | "ready"
  | "building"
  | "editing"
  | "done"
  | "failed";

export const VIDEO_REFRAME_MODES = [
  "smart-crop",
  "blur-fit",
  "letterbox",
  "original",
] as const;

export type VideoReframeMode = (typeof VIDEO_REFRAME_MODES)[number];

export const VIDEO_AUDIO_MODES = [
  "keep-original",
  "replace-bgm",
  "dub-new-voice",
] as const;

export type VideoAudioMode = (typeof VIDEO_AUDIO_MODES)[number];

export interface VideoToVideoSource {
  file: string | null;
  originalFileName: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSec: number | null;
}

export interface VideoToVideoOutput {
  aspect: "9:16" | "16:9" | "1:1" | "4:5";
  fps: number;
  width: number;
  height: number;
}

export interface VideoToVideoMeta {
  id: string;
  name: string;
  status: VideoToVideoStatus;
  source: VideoToVideoSource;
  transcript: string;
  transcriptFile: string | null;
  reframeMode: VideoReframeMode;
  audioMode: VideoAudioMode;
  brief: Brief;
  output: VideoToVideoOutput;
  projectId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function videoToVideoDirOf(id: string): string {
  return path.join(paths.videoToVideoDir, id);
}

export function videoToVideoMetaPathOf(id: string): string {
  return path.join(videoToVideoDirOf(id), "meta.json");
}

export function videoToVideoSessionExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(videoToVideoMetaPathOf(id));
}

export function aspectToDimensions(aspect: VideoToVideoOutput["aspect"]): { width: number; height: number } {
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

export function defaultVideoToVideoMeta(id: string, name?: string): VideoToVideoMeta {
  const dims = aspectToDimensions("9:16");
  return {
    id,
    name: name || id,
    status: "draft",
    source: {
      file: null,
      originalFileName: null,
      width: null,
      height: null,
      fps: null,
      durationSec: null,
    },
    transcript: "",
    transcriptFile: null,
    reframeMode: "blur-fit",
    audioMode: "keep-original",
    brief: defaultBrief(),
    output: {
      aspect: "9:16",
      fps: 30,
      width: dims.width,
      height: dims.height,
    },
    projectId: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function readVideoToVideoMeta(id: string): VideoToVideoMeta {
  if (!videoToVideoSessionExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Phiên Video to Video "${id}" không tồn tại`);
  }
  const raw = fs.readFileSync(videoToVideoMetaPathOf(id), "utf8");
  return JSON.parse(raw) as VideoToVideoMeta;
}

export function writeVideoToVideoMeta(meta: VideoToVideoMeta): void {
  const dir = videoToVideoDirOf(meta.id);
  ensureDir(dir);
  meta.updatedAt = nowIso();
  fs.writeFileSync(videoToVideoMetaPathOf(meta.id), JSON.stringify(meta, null, 2), "utf8");
}

export function listVideoToVideoSessions(): VideoToVideoMeta[] {
  ensureDir(paths.videoToVideoDir);
  const entries = fs.readdirSync(paths.videoToVideoDir, { withFileTypes: true });
  const results: VideoToVideoMeta[] = [];
  for (const ent of entries) {
    if (ent.isDirectory() && videoToVideoSessionExists(ent.name)) {
      try {
        results.push(readVideoToVideoMeta(ent.name));
      } catch {
        // bỏ qua thư mục hỏng
      }
    }
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function uniqueVideoToVideoId(base: string): string {
  const root = toKebabAscii(base) || "video-restyle";
  let id = root;
  for (let n = 2; videoToVideoSessionExists(id); n++) {
    id = `${root}-${n}`;
  }
  return id;
}
