import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { updateJob } from "../db.js";
import type { JobCtx } from "../queue.js";
import { projectDirOf, readMeta, type SceneMeta } from "../meta.js";
import { ensureDir, hyperframesCli } from "../util.js";
import { hyperframesSpeedArgs } from "../renderSettings.js";
import { parseProgressLine } from "./progress.js";

interface SceneCacheEntry {
  hash: string;
  renderedAt: number;
  outputRel: string;
  sizeBytes: number;
}

type SceneCacheMap = Record<string, SceneCacheEntry>;

function readSceneCache(projectDir: string): SceneCacheMap {
  const cacheFile = path.join(projectDir, "renders", ".scene-cache.json");
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as SceneCacheMap;
  } catch {
    return {};
  }
}

function writeSceneCache(projectDir: string, cache: SceneCacheMap): void {
  const cacheFile = path.join(projectDir, "renders", ".scene-cache.json");
  try {
    ensureDir(path.dirname(cacheFile));
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* bỏ qua nếu không ghi được cache */
  }
}

/**
 * Tính hash nội dung scene HyperFrames: bao gồm source file, props, duration, fps và speed args
 */
function computeSceneHash(
  projectDir: string,
  scene: SceneMeta,
  quality: string,
  speedArgs: string[],
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`quality:${quality}`);
  hash.update(`speedArgs:${speedArgs.join(",")}`);
  hash.update(`props:${JSON.stringify(scene.props ?? {})}`);
  hash.update(`fps:${scene.fps ?? ""}`);
  hash.update(`duration:${scene.durationSec ?? ""}`);

  if (scene.src) {
    const srcAbs = path.join(projectDir, scene.src);
    if (fs.existsSync(srcAbs)) {
      try {
        const content = fs.readFileSync(srcAbs);
        hash.update(content);
      } catch {
        const stat = fs.statSync(srcAbs);
        hash.update(`mtime:${stat.mtimeMs}`);
      }
    } else {
      hash.update(`missing-src:${scene.src}`);
    }
  }
  return hash.digest("hex");
}

/**
 * Job scene-draft | scene-final - render scene HyperFrames với Scene Dirty Cache.
 * cwd = video-projects/<projectId>.
 *   draft : npx hyperframes render <src> --quality draft    --output renders/<sceneId>.draft.mp4
 *   final : npx hyperframes render <src> --quality standard --output renders/<sceneId>.mp4
 * Chạy cho mọi scene có `src` trong meta.json, hoặc riêng scene nếu job có sceneId.
 */
export async function runSceneRender(ctx: JobCtx): Promise<void> {
  const { projectId, type, sceneId } = ctx.job;
  const draft = type === "scene-draft";
  const projectDir = projectDirOf(projectId);
  const meta = readMeta(projectId);

  let scenes: SceneMeta[] = (meta.scenes ?? []).filter(
    (s): s is SceneMeta => typeof s.src === "string" && s.src.length > 0,
  );
  if (sceneId) {
    scenes = scenes.filter((s) => s.id === sceneId);
    if (!scenes.length) {
      throw new Error(`Không tìm thấy scene "${sceneId}" có \`src\` trong meta.json`);
    }
  }
  if (!scenes.length) {
    throw new Error("meta.json không có scene nào có `src` để render");
  }

  ensureDir(path.join(projectDir, "renders"));
  const sceneCache = readSceneCache(projectDir);

  const total = scenes.length;
  let lastOutputRel = "";
  const speedArgs = hyperframesSpeedArgs(draft);

  for (let i = 0; i < total; i++) {
    const scene = scenes[i];
    if (ctx.isCanceled()) return;

    // Đích ghi tôn trọng scene.render nếu meta khai - khớp logic assemble.ts đọc ưu tiên scene.render
    const finalRel =
      typeof scene.render === "string" && scene.render ? scene.render : `renders/${scene.id}.mp4`;
    const outRel = draft ? finalRel.replace(/\.mp4$/i, ".draft.mp4") : finalRel;
    const outAbs = path.join(projectDir, outRel);
    ensureDir(path.dirname(outAbs));
    const quality = draft ? "draft" : "standard";
    const label = `Scene ${scene.id} (${i + 1}/${total})`;

    // ---- Dirty Cache Check: Kiểm tra xem scene có thay đổi hay không ----
    const cacheKey = `${scene.id}:${quality}:${outRel}`;
    const currentHash = computeSceneHash(projectDir, scene, quality, speedArgs);
    const cached = sceneCache[cacheKey];

    if (cached && cached.hash === currentHash && fs.existsSync(outAbs)) {
      try {
        const stat = fs.statSync(outAbs);
        if (stat.size > 1024) {
          ctx.log(`[scene] ⚡ [Cache hit] ${label} không đổi -> Bỏ qua render lại`);
          ctx.progress(Math.floor(((i + 1) / total) * 100), label);
          lastOutputRel = `video-projects/${projectId}/${outRel}`;
          continue;
        }
      } catch {
        /* file lỗi -> render lại */
      }
    }

    ctx.progress(Math.floor((i / total) * 100), label);
    ctx.log(`[scene] ${label} - quality ${quality}`);

    // CLI thật (v0.7.x): render 1 composition bằng cờ -c, không phải positional.
    // Flags tăng tốc lấy từ tab "Tăng tốc" (data/render-settings.json) - đọc mỗi lần chạy.
    // Chạy CLI bằng node + file bin (không npx, không shell) - xem util.cliJsPath.
    const args = [
      hyperframesCli(),
      "render",
      "-c",
      String(scene.src),
      "--quality",
      quality,
      ...speedArgs,
      "--output",
      outRel,
    ];
    await ctx.exec(process.execPath, args, projectDir, (line) => {
      const pct = parseProgressLine(line);
      if (pct !== null) {
        // Tiến độ tổng = scene đã xong + phần trăm scene hiện tại
        ctx.progress(Math.floor(((i + pct / 100) / total) * 100), label);
      }
    });

    if (!fs.existsSync(outAbs)) {
      throw new Error(`Render xong nhưng không thấy file ${outRel} - kiểm tra log hyperframes`);
    }

    // Cập nhật dirty cache sau khi render thành công
    try {
      sceneCache[cacheKey] = {
        hash: currentHash,
        renderedAt: Date.now(),
        outputRel: outRel,
        sizeBytes: fs.statSync(outAbs).size,
      };
      writeSceneCache(projectDir, sceneCache);
    } catch {
      /* bỏ qua lỗi cache */
    }

    lastOutputRel = `video-projects/${projectId}/${outRel}`;
  }

  // outputPath: file cuối (job 1 scene = chính file đó), đường dẫn tương đối repo root
  updateJob(ctx.job.id, { outputPath: lastOutputRel });
}
