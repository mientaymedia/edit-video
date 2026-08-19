import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { defaultBrief, type Brief } from "./meta.js";
import { HttpError, ensureDir, isKebabCase, nowIso, toKebabAscii } from "./util.js";

export type ImageToVideoStatus =
  | "draft"
  | "analyzing"
  | "building"
  | "editing"
  | "done"
  | "failed";

export const IMAGE_CAMERA_MOTIONS = [
  "ken-burns",
  "zoom-in",
  "zoom-out",
  "pan-left",
  "pan-right",
  "parallax-3d",
  "dynamic",
] as const;

export type ImageCameraMotion = (typeof IMAGE_CAMERA_MOTIONS)[number];

export interface ImageToVideoItem {
  id: string;
  file: string; // Tên file trong thư mục phiên
  originalFileName: string;
  motion: ImageCameraMotion;
  durationSec?: number;
  caption?: string;
}

export interface ImageToVideoVoiceover {
  enabled: boolean;
  provider: string;
  voiceId: string;
  speed: number;
  audioFile?: string | null;
}

export interface ImageToVideoOutput {
  aspect: "9:16" | "16:9" | "1:1" | "4:5";
  fps: number;
  width: number;
  height: number;
}

export interface ImageToVideoMeta {
  id: string;
  name: string;
  status: ImageToVideoStatus;
  images: ImageToVideoItem[];
  script: string;
  voiceover: ImageToVideoVoiceover;
  motionDefault: ImageCameraMotion;
  durationSec: number;
  brief: Brief;
  output: ImageToVideoOutput;
  projectId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function imageToVideoDirOf(id: string): string {
  return path.join(paths.imageToVideoDir, id);
}

export function imageToVideoMetaPathOf(id: string): string {
  return path.join(imageToVideoDirOf(id), "meta.json");
}

export function imageToVideoSessionExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(imageToVideoMetaPathOf(id));
}

export function aspectToDimensions(aspect: ImageToVideoOutput["aspect"]): { width: number; height: number } {
  switch (aspect) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "16:9":
    default:
      return { width: 1920, height: 1080 };
  }
}

export function defaultImageToVideoMeta(id: string, name?: string): ImageToVideoMeta {
  const dims = aspectToDimensions("9:16");
  return {
    id,
    name: name || id,
    status: "draft",
    images: [],
    script: "",
    voiceover: {
      enabled: false,
      provider: "edge-tts",
      voiceId: "vi-VN-HoaiMyNeural",
      speed: 1.0,
      audioFile: null,
    },
    motionDefault: "ken-burns",
    durationSec: 10,
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

export function readImageToVideoMeta(id: string): ImageToVideoMeta {
  if (!imageToVideoSessionExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Phiên Image to Video "${id}" không tồn tại`);
  }
  const raw = fs.readFileSync(imageToVideoMetaPathOf(id), "utf8");
  return JSON.parse(raw) as ImageToVideoMeta;
}

export function writeImageToVideoMeta(meta: ImageToVideoMeta): void {
  const dir = imageToVideoDirOf(meta.id);
  ensureDir(dir);
  meta.updatedAt = nowIso();
  fs.writeFileSync(imageToVideoMetaPathOf(meta.id), JSON.stringify(meta, null, 2), "utf8");
}

export function listImageToVideoSessions(): ImageToVideoMeta[] {
  ensureDir(paths.imageToVideoDir);
  const entries = fs.readdirSync(paths.imageToVideoDir, { withFileTypes: true });
  const results: ImageToVideoMeta[] = [];
  for (const ent of entries) {
    if (ent.isDirectory() && imageToVideoSessionExists(ent.name)) {
      try {
        results.push(readImageToVideoMeta(ent.name));
      } catch {
        // bỏ qua thư mục hỏng
      }
    }
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function uniqueImageToVideoId(base: string): string {
  const root = toKebabAscii(base) || "image-video";
  let id = root;
  for (let n = 2; imageToVideoSessionExists(id); n++) {
    id = `${root}-${n}`;
  }
  return id;
}
