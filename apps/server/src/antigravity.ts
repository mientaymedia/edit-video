import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";
import { HttpError } from "./util.js";

/**
 * Tích hợp Google Antigravity (thông qua Antigravity CLI `agy`).
 * Hỗ trợ sinh kịch bản (scriptwriting), hội thoại và các tác vụ AI nhanh.
 */

export interface AntigravityModel {
  id: string;
  label: string;
}

export const ANTIGRAVITY_MODELS: AntigravityModel[] = [
  { id: "antigravity-default", label: "Antigravity Mặc định" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Nhanh & Tối ưu)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Chi tiết & Sâu sắc)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3-pro", label: "Gemini 3 Pro" },
];

export const ANTIGRAVITY_MODEL_IDS = ANTIGRAVITY_MODELS.map((m) => m.id);

let cachedAgyPath: string | null = null;

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || "";
}

/**
 * Dò tìm đường dẫn tới binary `agy` (Antigravity CLI) trên hệ thống.
 */
export function getAgyExecutablePath(): string | null {
  if (cachedAgyPath && fs.existsSync(cachedAgyPath)) {
    return cachedAgyPath;
  }

  if (process.env.AGY_EXECUTABLE_PATH && fs.existsSync(process.env.AGY_EXECUTABLE_PATH)) {
    cachedAgyPath = process.env.AGY_EXECUTABLE_PATH;
    return cachedAgyPath;
  }

  const platform = process.platform;
  const binaryName = platform === "win32" ? "agy.exe" : "agy";
  const home = homeDir();

  const candidates = [
    path.join(home, ".local", "bin", binaryName),
    path.join(home, ".antigravity", "bin", binaryName),
    "/usr/local/bin/agy",
    "/opt/homebrew/bin/agy",
    platform === "win32" ? path.join(home, "AppData", "Roaming", "npm", binaryName) : null,
    platform === "win32" ? path.join(home, "AppData", "Local", "Programs", "Antigravity", binaryName) : null,
  ].filter((p): p is string => Boolean(p));

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      cachedAgyPath = cand;
      return cand;
    }
  }

  try {
    const cmd = platform === "win32" ? "where agy" : "which agy";
    const found = execFileSync(platform === "win32" ? "cmd.exe" : "/bin/sh", platform === "win32" ? ["/c", cmd] : ["-c", cmd], {
      encoding: "utf8",
      timeout: 2000,
    }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) {
      cachedAgyPath = found;
      return found;
    }
  } catch {
    /* Không tìm thấy qua which/where */
  }

  return null;
}

/**
 * Kiểm tra xem máy chủ có kết nối với Antigravity (đã cài đặt CLI agy) không.
 */
export function hasAntigravityAuth(): boolean {
  return Boolean(getAgyExecutablePath());
}

export function isAntigravityModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const id = modelId.trim().toLowerCase();
  if (id.startsWith("agy:") || id.startsWith("antigravity:") || id === "antigravity" || id === "antigravity-default") {
    return true;
  }
  return ANTIGRAVITY_MODEL_IDS.includes(id) || id.startsWith("gemini-");
}

/**
 * Chuẩn hóa tên model khi truyền vào `agy --model <model>`
 */
export function normalizeAgyModel(modelId?: string | null): string | undefined {
  if (!modelId) return undefined;
  const id = modelId.replace(/^(agy:|antigravity:)/, "").trim();
  if (id === "antigravity-default" || id === "default" || id === "antigravity") {
    return undefined; // Dùng model mặc định của agy
  }
  return id;
}

export interface RunAgyResult {
  text: string;
  durationMs: number;
}

/**
 * Chạy một prompt đơn qua `agy -p` (print mode non-interactive).
 */
export async function runAntigravityPrompt(input: {
  prompt: string;
  model?: string | null;
  timeoutMs?: number;
}): Promise<RunAgyResult> {
  const agyPath = getAgyExecutablePath();
  if (!agyPath) {
    throw new HttpError(
      503,
      "NO_ANTIGRAVITY_CLI",
      "Không tìm thấy Antigravity CLI (`agy`) trên hệ thống. Hãy đảm bảo Antigravity đã được cài đặt và binary `agy` nằm trong PATH hoặc ~/.local/bin/agy.",
    );
  }

  const timeoutMs = input.timeoutMs ?? 3 * 60_000;
  const args: string[] = ["-p", input.prompt];

  const model = normalizeAgyModel(input.model);
  if (model) {
    args.push("--model", model);
  }
  args.push("--dangerously-skip-permissions");

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const child = spawn(agyPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill("SIGTERM");
        } catch {}
        reject(new HttpError(504, "ANTIGRAVITY_TIMEOUT", `Antigravity xử lý quá thời gian quy định (${Math.round(timeoutMs / 1000)}s).`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new HttpError(500, "ANTIGRAVITY_SPAWN_ERROR", `Không thể khởi chạy agy: ${err.message}`));
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        const errMsg = stderr.trim() || stdout.trim() || `Thoát với mã ${code}`;
        reject(new HttpError(500, "ANTIGRAVITY_FAILED", `Antigravity thực thi lỗi: ${errMsg}`));
        return;
      }

      const text = stdout.trim();
      resolve({
        text,
        durationMs: Date.now() - startTime,
      });
    });
  });
}
