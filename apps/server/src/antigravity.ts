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

/** Quản lý các tiến trình Antigravity đang chạy theo sessionId để hỗ trợ dừng (interrupt) */
const runningAgySessions = new Map<string, import("node:child_process").ChildProcess>();

export function isAntigravityRunning(sessionId: string): boolean {
  return runningAgySessions.has(sessionId);
}

export async function interruptAntigravity(sessionId: string): Promise<boolean> {
  const child = runningAgySessions.get(sessionId);
  if (!child) return false;
  try {
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 2000);
  } catch {}
  runningAgySessions.delete(sessionId);
  return true;
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

/**
 * Chạy phiên Antigravity Agent tương đương Claude Agent SDK:
 * - Gọi Antigravity CLI với cờ `--output-format stream-json` và `--dangerously-skip-permissions`
 * - Nhận và phát các sự kiện stream (text delta, tool call, kết quả, chi phí)
 */
export async function runAntigravityAgentSession(input: {
  sessionId: string;
  prompt: string;
  model?: string | null;
  sdkSessionId?: string | null;
  onInit?: (sdkSessionId: string) => void;
  onText?: (text: string) => void;
  onTool?: (name: string, args: unknown) => void;
  onResult?: (resultText: string, usage?: { inputTokens?: number; outputTokens?: number }) => void;
  onError?: (err: string) => void;
  onDone?: (status: "done" | "error" | "interrupted") => void;
}): Promise<void> {
  const agyPath = getAgyExecutablePath();
  if (!agyPath) {
    input.onError?.(
      "Không tìm thấy Antigravity CLI (`agy`). Hãy đảm bảo Antigravity đã được cài đặt trên máy.",
    );
    input.onDone?.("error");
    return;
  }

  const args: string[] = [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
    "--print-timeout",
    "30m",
  ];

  const model = normalizeAgyModel(input.model);
  if (model) {
    args.push("--model", model);
  }

  if (input.sdkSessionId) {
    args.push("--conversation", input.sdkSessionId);
  }

  const child = spawn(agyPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningAgySessions.set(input.sessionId, child);

  let buffer = "";
  let fullResponse = "";
  let inTok = 0;
  let outTok = 0;
  let isInterrupted = false;

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as {
          event?: string;
          conversation_id?: string;
          step_update?: {
            step_type?: string;
            text_delta?: string;
            tool_name?: string;
            tool_args?: unknown;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          result?: {
            status?: string;
            response?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
        };

        if (item.event === "init" && item.conversation_id) {
          input.onInit?.(item.conversation_id);
        }

        if (item.event === "step_update" && item.step_update) {
          const u = item.step_update;
          if (u.text_delta) {
            fullResponse += u.text_delta;
            input.onText?.(u.text_delta);
          }
          if (u.tool_name) {
            input.onTool?.(u.tool_name, u.tool_args ?? {});
          }
          if (u.usage) {
            inTok += u.usage.input_tokens ?? 0;
            outTok += u.usage.output_tokens ?? 0;
          }
        }

        if (item.event === "result" && item.result) {
          const res = item.result;
          if (res.usage) {
            inTok = res.usage.input_tokens ?? inTok;
            outTok = res.usage.output_tokens ?? outTok;
          }
          const text = res.response || fullResponse;
          input.onResult?.(text, { inputTokens: inTok, outputTokens: outTok });
        }
      } catch {
        /* Bỏ qua các dòng không phải JSON */
      }
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.on("error", (err) => {
    runningAgySessions.delete(input.sessionId);
    input.onError?.(`Lỗi chạy Antigravity Agent: ${err.message}`);
    input.onDone?.("error");
  });

  child.on("close", (code, signal) => {
    runningAgySessions.delete(input.sessionId);

    if (signal === "SIGTERM" || signal === "SIGKILL" || isInterrupted) {
      input.onDone?.("interrupted");
      return;
    }

    if (code !== 0 && code !== null) {
      const errMsg = stderr.trim() || `Thoát với mã ${code}`;
      input.onError?.(`Antigravity Agent kết thúc với lỗi: ${errMsg}`);
      input.onDone?.("error");
      return;
    }

    input.onDone?.("done");
  });
}
