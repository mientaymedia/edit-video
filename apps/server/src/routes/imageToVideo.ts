import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import { normOutput, projectExists, readMeta, applyBriefPatch } from "../meta.js";
import {
  defaultImageToVideoMeta,
  imageToVideoDirOf,
  imageToVideoSessionExists,
  listImageToVideoSessions,
  readImageToVideoMeta,
  uniqueImageToVideoId,
  writeImageToVideoMeta,
  type ImageCameraMotion,
  type ImageToVideoItem,
  type ImageToVideoMeta,
  type ImageToVideoOutput,
} from "../imageToVideoMeta.js";
import { analyzeImagesVision } from "../jobs/imageToVideo.js";
import * as db from "../db.js";
import { queue } from "../queue.js";
import { HttpError, isKebabCase, toKebabAscii, ensureDir, toRepoRel } from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) =>
      cb(null, `i2v-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per image
});

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function reconcile(meta: ImageToVideoMeta): ImageToVideoMeta {
  if (meta.status !== "editing" || !meta.projectId) return meta;
  try {
    if (!projectExists(meta.projectId)) {
      meta.status = "failed";
      meta.error = `Project "${meta.projectId}" đã bị xóa.`;
      writeImageToVideoMeta(meta);
      return meta;
    }
    if (normOutput(readMeta(meta.projectId).output)) {
      meta.status = "done";
      meta.error = null;
      writeImageToVideoMeta(meta);
      return meta;
    }
  } catch {
    // meta project con hỏng/đang ghi dở
  }
  return meta;
}

function mustRead(id: string): ImageToVideoMeta {
  if (!isKebabCase(id)) throw new HttpError(400, "INVALID_ID", "id không hợp lệ");
  if (!imageToVideoSessionExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên "${id}"`);
  }
  return reconcile(readImageToVideoMeta(id));
}

function assertNotBusy(meta: ImageToVideoMeta): void {
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên "${meta.id}" đang có job chạy hoặc chờ trong hàng đợi.`,
    );
  }
}

// ------------------------------------------------------------------ Routes

/** GET /api/image-to-video - Danh sách phiên */
router.get("/", (_req, res) => {
  const list = listImageToVideoSessions().map(reconcile);
  res.json(list);
});

/** POST /api/image-to-video - Tạo phiên mới */
router.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const id = uniqueImageToVideoId(name || "image-video");
  const meta = defaultImageToVideoMeta(id, name || id);
  writeImageToVideoMeta(meta);
  res.status(201).json(meta);
});

/** GET /api/image-to-video/:id - Chi tiết phiên */
router.get("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  res.json(meta);
});

/** PATCH /api/image-to-video/:id - Cập nhật cấu hình */
router.patch("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  if (typeof req.body?.name === "string") {
    meta.name = req.body.name.trim() || meta.name;
  }
  if (typeof req.body?.script === "string") {
    meta.script = req.body.script;
  }
  if (typeof req.body?.durationSec === "number") {
    meta.durationSec = Math.max(3, Math.min(300, req.body.durationSec));
  }
  if (typeof req.body?.motionDefault === "string") {
    meta.motionDefault = req.body.motionDefault as ImageCameraMotion;
  }

  // Voiceover
  if (req.body?.voiceover && typeof req.body.voiceover === "object") {
    meta.voiceover = {
      ...meta.voiceover,
      ...req.body.voiceover,
    };
  }

  // Brief
  if (req.body?.brief && typeof req.body.brief === "object") {
    meta.brief = applyBriefPatch(meta.brief, req.body.brief);
  }

  // Output
  if (req.body?.output && typeof req.body.output === "object") {
    const o = req.body.output as Partial<ImageToVideoOutput>;
    if (o.aspect) meta.output.aspect = o.aspect;
    if (o.fps) meta.output.fps = o.fps;
    if (o.width) meta.output.width = o.width;
    if (o.height) meta.output.height = o.height;
  }

  // Reorder / update images array
  if (Array.isArray(req.body?.images)) {
    meta.images = req.body.images;
  }

  writeImageToVideoMeta(meta);
  res.json(meta);
});

/** POST /api/image-to-video/:id/images - Tải lên 1 hoặc nhiều ảnh */
router.post("/:id/images", upload.array("files", 20), (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    throw new HttpError(400, "NO_FILE", "Chưa chọn file ảnh nào");
  }

  const dir = imageToVideoDirOf(meta.id);
  ensureDir(dir);

  const addedItems: ImageToVideoItem[] = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      try {
        fs.unlinkSync(file.path);
      } catch {}
      continue;
    }

    const imgId = nanoid(8);
    const destName = `img-${imgId}${ext}`;
    const destAbs = path.join(dir, destName);
    fs.renameSync(file.path, destAbs);

    const item: ImageToVideoItem = {
      id: imgId,
      file: destName,
      originalFileName: file.originalname,
      motion: meta.motionDefault || "ken-burns",
    };
    meta.images.push(item);
    addedItems.push(item);
  }

  writeImageToVideoMeta(meta);
  res.status(201).json({ meta, added: addedItems });
});

/** DELETE /api/image-to-video/:id/images/:imageId - Xóa 1 ảnh */
router.delete("/:id/images/:imageId", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  const imageId = req.params.imageId as string;
  const idx = meta.images.findIndex((img) => img.id === imageId);
  if (idx === -1) {
    throw new HttpError(404, "NOT_FOUND", "Không tìm thấy ảnh");
  }

  const [removed] = meta.images.splice(idx, 1);
  const dir = imageToVideoDirOf(meta.id);
  const imgPath = path.join(dir, removed.file);
  if (fs.existsSync(imgPath)) {
    try {
      fs.unlinkSync(imgPath);
    } catch {}
  }

  writeImageToVideoMeta(meta);
  res.json(meta);
});

/** POST /api/image-to-video/:id/analyze-vision - Dùng AI Vision phân tích ảnh và tạo kịch bản */
router.post("/:id/analyze-vision", async (req, res, next) => {
  try {
    const meta = mustRead(req.params.id as string);
    assertNotBusy(meta);

    const script = await analyzeImagesVision(meta.id);
    meta.script = script;
    if (!meta.voiceover.enabled) {
      meta.voiceover.enabled = true; // Tự động bật voiceover khi AI đã sinh thoại
    }
    writeImageToVideoMeta(meta);
    res.json({ script, meta });
  } catch (e) {
    next(e);
  }
});

/** POST /api/image-to-video/:id/build - Kích hoạt dựng video */
router.post("/:id/build", async (req, res, next) => {
  try {
    const meta = mustRead(req.params.id as string);
    assertNotBusy(meta);

    if (meta.images.length === 0) {
      throw new HttpError(400, "NO_IMAGES", "Vui lòng tải lên ít nhất 1 ảnh để dựng video");
    }

    if (meta.projectId) {
      throw new HttpError(400, "ALREADY_BUILT", `Phiên đã dựng project "${meta.projectId}" rồi`);
    }

    meta.status = "building";
    meta.error = null;
    writeImageToVideoMeta(meta);

    const jobId = `job_i2v_${nanoid()}`;
    const job = db.createJob({
      id: jobId,
      type: "image-to-video",
      projectId: meta.id,
    });
    queue.enqueue(jobId);

    res.json({ job: db.jobToApi(job), meta });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/image-to-video/:id - Xóa phiên */
router.delete("/:id", (req, res) => {
  const meta = mustRead(req.params.id as string);
  assertNotBusy(meta);

  const dir = imageToVideoDirOf(meta.id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  res.json({ ok: true, deleted: meta.id });
});

export default router;
