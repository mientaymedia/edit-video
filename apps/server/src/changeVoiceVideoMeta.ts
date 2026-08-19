import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import type { TtsEngine } from "./ttsTypes.js";
import { HttpError, ensureDir, isKebabCase, nowIso, toKebabAscii } from "./util.js";

export type ChangeVoiceVideoStatus =
  | "draft"
  | "transcribing"
  | "ready"
  | "rendering"
  | "done"
  | "failed";

export type ChangeVoiceAudioMode =
  | "mute-original"
  | "mute-dialogue-ranges"
  | "keep-bgm-ducking";

export interface ChangeVoiceCue {
  id: string;
  start: number; // Giây
  end: number;   // Giây
  text: string;
  originalText: string;
  voice?: string;
  speed?: number;
}

export interface ChangeVoiceVideoSource {
  file: string | null;
  originalFileName: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSec: number | null;
}

export interface ChangeVoiceSettings {
  engine: TtsEngine;
  voice: string;
  speed: number;
}

export interface ChangeVoiceAudioMix {
  mode: ChangeVoiceAudioMode;
  bgmVolume: number; // 0.0 - 1.0 (ví dụ 0.2 khi ducking)
  voiceVolume: number; // 0.0 - 2.0 (mặc định 1.0)
}

export interface ChangeVoiceVideoOutput {
  file: string | null;
  durationSec: number | null;
}

export interface ChangeVoiceVideoMeta {
  id: string;
  name: string;
  status: ChangeVoiceVideoStatus;
  source: ChangeVoiceVideoSource;
  cues: ChangeVoiceCue[];
  voiceSettings: ChangeVoiceSettings;
  audioMix: ChangeVoiceAudioMix;
  burnSubtitles: boolean;
  output: ChangeVoiceVideoOutput;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function changeVoiceVideoDirOf(id: string): string {
  return path.join(paths.changeVoiceVideoDir, id);
}

export function changeVoiceVideoMetaPathOf(id: string): string {
  return path.join(changeVoiceVideoDirOf(id), "meta.json");
}

export function changeVoiceVideoSessionExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(changeVoiceVideoMetaPathOf(id));
}

export function defaultChangeVoiceVideoMeta(
  id: string,
  name?: string
): ChangeVoiceVideoMeta {
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
    cues: [],
    voiceSettings: {
      engine: "gemini",
      voice: "Puck",
      speed: 1.0,
    },
    audioMix: {
      mode: "mute-original",
      bgmVolume: 0.15,
      voiceVolume: 1.0,
    },
    burnSubtitles: false,
    output: {
      file: null,
      durationSec: null,
    },
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function readChangeVoiceVideoMeta(id: string): ChangeVoiceVideoMeta {
  if (!changeVoiceVideoSessionExists(id)) {
    throw new HttpError(
      404,
      "NOT_FOUND",
      `Phiên Đổi giọng video "${id}" không tồn tại`
    );
  }
  const raw = fs.readFileSync(changeVoiceVideoMetaPathOf(id), "utf8");
  return JSON.parse(raw) as ChangeVoiceVideoMeta;
}

export function writeChangeVoiceVideoMeta(meta: ChangeVoiceVideoMeta): void {
  const dir = changeVoiceVideoDirOf(meta.id);
  ensureDir(dir);
  meta.updatedAt = nowIso();
  fs.writeFileSync(
    changeVoiceVideoMetaPathOf(meta.id),
    JSON.stringify(meta, null, 2),
    "utf8"
  );
}

export function listChangeVoiceVideoSessions(): ChangeVoiceVideoMeta[] {
  ensureDir(paths.changeVoiceVideoDir);
  const entries = fs.readdirSync(paths.changeVoiceVideoDir, {
    withFileTypes: true,
  });
  const results: ChangeVoiceVideoMeta[] = [];
  for (const ent of entries) {
    if (ent.isDirectory() && changeVoiceVideoSessionExists(ent.name)) {
      try {
        results.push(readChangeVoiceVideoMeta(ent.name));
      } catch {
        // bỏ qua thư mục hỏng
      }
    }
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function uniqueChangeVoiceVideoId(base: string): string {
  const root = toKebabAscii(base) || "change-voice";
  let id = root;
  for (let n = 2; changeVoiceVideoSessionExists(id); n++) {
    id = `${root}-${n}`;
  }
  return id;
}
