"use client";

/**
 * Chi tiết phiên "Image to video" - Dựng video chuyển động từ bộ sưu tập hình ảnh.
 */

import {
  ArrowLeft,
  ExternalLink,
  Film,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeImageToVideoVision,
  buildImageToVideo,
  deleteImageToVideoImage,
  deleteImageToVideoSession,
  getImageToVideoSession,
  getProject,
  getTtsVoices,
  isImageToVideoJob,
  mediaUrl,
  updateImageToVideoSession,
  uploadImageToVideoImages,
  type Brief,
  type ImageCameraMotion,
  type ImageToVideoItem,
  type ImageToVideoMeta,
  type ImageToVideoOutput,
  type ImageToVideoStatus,
  type ProjectDetail,
  type TtsVoice,
} from "@/lib/api";
import { useAgentEvents, useJobEvents } from "@/lib/useEvents";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field, SwitchField } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { PageHeader } from "@/components/PageHeader";
import { BriefFields } from "@/components/BriefFields";
import { useT } from "@/lib/i18n";

const STATUS_TONE: Record<ImageToVideoStatus, BadgeTone> = {
  draft: "muted",
  analyzing: "running",
  building: "running",
  editing: "running",
  done: "success",
  failed: "danger",
};

const STATUS_LABEL: Record<ImageToVideoStatus, string> = {
  draft: "i2v.status.draft",
  analyzing: "i2v.status.analyzing",
  building: "i2v.status.building",
  editing: "i2v.status.editing",
  done: "i2v.status.done",
  failed: "i2v.status.failed",
};

const MOTIONS: Array<{ id: ImageCameraMotion; labelKey: string }> = [
  { id: "ken-burns", labelKey: "i2v.motion-ken-burns" },
  { id: "zoom-in", labelKey: "i2v.motion-zoom-in" },
  { id: "zoom-out", labelKey: "i2v.motion-zoom-out" },
  { id: "pan-left", labelKey: "i2v.motion-pan-left" },
  { id: "pan-right", labelKey: "i2v.motion-pan-right" },
  { id: "parallax-3d", labelKey: "i2v.motion-parallax-3d" },
  { id: "dynamic", labelKey: "i2v.motion-dynamic" },
];

const ASPECTS: ImageToVideoOutput["aspect"][] = ["9:16", "16:9", "1:1", "4:5"];

const RUNNING_STATUS: ImageToVideoStatus[] = [
  "analyzing",
  "building",
  "editing",
];

export default function ImageToVideoDetailPage() {
  const { t } = useT();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [meta, setMeta] = useState<ImageToVideoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Gallery
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Vision
  const [analyzingVision, setAnalyzingVision] = useState(false);
  const [scriptText, setScriptText] = useState("");

  // Voices
  const [voices, setVoices] = useState<TtsVoice[]>([]);

  // Build
  const [building, setBuilding] = useState(false);

  // Child project
  const [childProject, setChildProject] = useState<ProjectDetail | null>(null);

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const busy = meta ? RUNNING_STATUS.includes(meta.status) : false;

  const load = useCallback(async () => {
    try {
      const data = await getImageToVideoSession(id);
      setMeta(data);
      setScriptText(data.script || "");
      setError(null);
      if (data.projectId) {
        try {
          const p = await getProject(data.projectId);
          setChildProject(p);
        } catch {
          // child project may not exist yet
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    getTtsVoices()
      .then(setVoices)
      .catch(() => setVoices([]));
  }, [load]);

  useJobEvents((job) => {
    if (!isImageToVideoJob(job, id)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  // ---- Handlers ----

  async function handleUploadImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !meta) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadImageToVideoImages(id, Array.from(files));
      setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteImage(imgId: string) {
    if (!meta) return;
    try {
      const updated = await deleteImageToVideoImage(id, imgId);
      setMeta(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleChangeImageMotion(imgId: string, motion: ImageCameraMotion) {
    if (!meta) return;
    const updatedImages = meta.images.map((img) =>
      img.id === imgId ? { ...img, motion } : img
    );
    try {
      const updated = await updateImageToVideoSession(id, { images: updatedImages });
      setMeta(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAnalyzeVision() {
    if (!meta) return;
    setAnalyzingVision(true);
    setError(null);
    try {
      const res = await analyzeImageToVideoVision(id);
      setMeta(res.meta);
      setScriptText(res.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingVision(false);
    }
  }

  async function handleSaveScript() {
    if (!meta) return;
    try {
      const updated = await updateImageToVideoSession(id, { script: scriptText });
      setMeta(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePatchBrief(patch: Partial<Brief>) {
    if (!meta) return;
    try {
      const updated = await updateImageToVideoSession(id, { brief: patch });
      setMeta(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePatchOutput(aspect: ImageToVideoOutput["aspect"]) {
    if (!meta) return;
    try {
      const updated = await updateImageToVideoSession(id, { output: { aspect } });
      setMeta(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBuild() {
    if (!meta) return;
    setBuilding(true);
    setError(null);
    try {
      if (scriptText !== meta.script) {
        await updateImageToVideoSession(id, { script: scriptText });
      }
      await buildImageToVideo(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteImageToVideoSession(id);
      router.push("/image-to-video");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  // ---- Render ----

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error || `Không tìm thấy phiên "${id}"`} />
        <Button variant="secondary" onClick={() => router.push("/image-to-video")}>
          <ArrowLeft size={16} /> {t("common.back")}
        </Button>
      </div>
    );
  }

  const statusBadge = (
    <Badge
      tone={STATUS_TONE[meta.status] ?? "muted"}
      label={STATUS_LABEL[meta.status] ? t(STATUS_LABEL[meta.status]) : meta.status}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Link
              href="/image-to-video"
              className="inline-flex items-center text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft size={18} />
            </Link>
            <span>{meta.name}</span>
          </div>
        }
        subtitle={`${meta.images.length} ảnh · ${meta.output.aspect} · ${meta.output.fps}fps`}
        actions={
          <div className="flex items-center gap-2">
            {statusBadge}
            {meta.projectId && (
              <Link
                href={`/projects/${meta.projectId}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)]"
              >
                <ExternalLink size={14} /> {t("i2v.open-project")}
              </Link>
            )}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== CỘT TRÁI: Gallery ảnh & AI Vision ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 1: Bộ sưu tập ảnh --- */}
          <Card>
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <Images size={16} /> {t("i2v.section.images")} ({meta.images.length})
                </h3>
                <Button
                  variant="secondary"
                  small
                  disabled={busy || uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  {t("i2v.upload-more")}
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={handleUploadImages}
              />

              {meta.images.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {meta.images.map((img, idx) => (
                    <div
                      key={img.id}
                      className="flex items-center gap-3 rounded-lg bg-[var(--bg-subtle)] p-2.5"
                    >
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-black/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mediaUrl(`image-to-video/${meta.id}/${img.file}`)}
                          alt={img.originalFileName}
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-bold text-white">
                          #{idx + 1}
                        </span>
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="truncate text-sm font-medium">
                          {img.originalFileName}
                        </p>
                        <div className="flex items-center gap-2">
                          <select
                            className="input h-7 py-0.5 text-xs"
                            value={img.motion}
                            disabled={busy}
                            onChange={(e) =>
                              handleChangeImageMotion(
                                img.id,
                                e.target.value as ImageCameraMotion
                              )
                            }
                          >
                            {MOTIONS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {t(m.labelKey)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <IconButton
                        size="sm"
                        tone="danger"
                        label={t("i2v.remove-image")}
                        disabled={busy}
                        onClick={() => handleDeleteImage(img.id)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] p-8 transition-colors hover:border-[var(--primary)] hover:bg-[var(--bg-subtle)]"
                  onClick={() => !uploading && fileInputRef.current?.click()}
                >
                  <Upload size={32} className="text-[var(--text-muted)]" />
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    {t("i2v.upload-hint")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("i2v.max-size")}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* --- Khối 2: AI Vision & Kịch bản thoại --- */}
          <Card>
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <Wand2 size={16} /> {t("i2v.section.vision")}
                </h3>
                <Button
                  variant="secondary"
                  small
                  disabled={meta.images.length === 0 || busy || analyzingVision}
                  onClick={handleAnalyzeVision}
                >
                  {analyzingVision ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {t("i2v.ai-vision-btn")}
                </Button>
              </div>

              <p className="mb-3 text-xs text-[var(--text-muted)]">
                {t("i2v.ai-vision-hint")}
              </p>

              <Field label={t("i2v.script-label")}>
                <textarea
                  className="min-h-[120px] w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-sm leading-relaxed focus:border-[var(--primary)] focus:outline-none"
                  placeholder={t("i2v.script-placeholder")}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  onBlur={handleSaveScript}
                  disabled={busy}
                />
              </Field>

              {/* Voiceover options */}
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
                <SwitchField
                  id="i2v-voiceover-toggle"
                  checked={meta.voiceover?.enabled ?? false}
                  label={t("i2v.enable-voiceover")}
                  disabled={busy}
                  onChange={(val) =>
                    updateImageToVideoSession(id, {
                      voiceover: { ...meta.voiceover, enabled: val },
                    }).then(setMeta)
                  }
                />

                {meta.voiceover?.enabled && (
                  <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    <Field label="Giọng đọc AI">
                      <select
                        className="input"
                        value={meta.voiceover.voiceId}
                        disabled={busy}
                        onChange={(e) =>
                          updateImageToVideoSession(id, {
                            voiceover: { ...meta.voiceover, voiceId: e.target.value },
                          }).then(setMeta)
                        }
                      >
                        {voices.map((v) => (
                          <option key={`${v.engine}-${v.name}`} value={v.name}>
                            {v.title || v.label} ({v.engine})
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Tốc độ đọc">
                      <select
                        className="input"
                        value={meta.voiceover.speed ?? 1.0}
                        disabled={busy}
                        onChange={(e) =>
                          updateImageToVideoSession(id, {
                            voiceover: {
                              ...meta.voiceover,
                              speed: Number(e.target.value),
                            },
                          }).then(setMeta)
                        }
                      >
                        <option value="0.9">0.9x (Chậm)</option>
                        <option value="1.0">1.0x (Bình thường)</option>
                        <option value="1.1">1.1x (Hơi nhanh)</option>
                        <option value="1.2">1.2x (Nhanh - cuốn hút)</option>
                      </select>
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* ===== CỘT PHẢI: Cấu hình & Dựng video ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 3: Cấu hình video & Chuyển động --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Settings2 size={16} /> {t("i2v.section.config")}
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Tỷ lệ khung hình */}
                <Field label={t("i2v.aspect-ratio")}>
                  <div className="flex gap-2">
                    {ASPECTS.map((a) => (
                      <button
                        key={a}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          meta.output.aspect === a
                            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                            : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]"
                        }`}
                        disabled={busy}
                        onClick={() => handlePatchOutput(a)}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Hiệu ứng chuyển động mặc định */}
                <Field label={t("i2v.motion-mode")}>
                  <select
                    className="input"
                    value={meta.motionDefault}
                    disabled={busy}
                    onChange={(e) =>
                      updateImageToVideoSession(id, {
                        motionDefault: e.target.value as ImageCameraMotion,
                      }).then(setMeta)
                    }
                  >
                    {MOTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {t(m.labelKey)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Thời lượng video */}
              <div className="mt-4">
                <Field
                  label={t("i2v.duration-label")}
                  hint={t("i2v.duration-hint")}
                >
                  <input
                    type="number"
                    min={3}
                    max={180}
                    step={1}
                    className="input w-32"
                    value={meta.durationSec}
                    disabled={busy}
                    onChange={(e) =>
                      updateImageToVideoSession(id, {
                        durationSec: Number(e.target.value) || 10,
                      }).then(setMeta)
                    }
                  />
                </Field>
              </div>

              {/* Brief Fields - Style Design, Video Style, Sound effect, Music */}
              <div className="mt-4">
                <BriefFields
                  value={meta.brief}
                  disabled={busy}
                  onChange={(patch) => handlePatchBrief(patch)}
                />
              </div>
            </div>
          </Card>

          {/* --- Khối 4: Dựng video --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Film size={16} /> {t("i2v.section.build")}
              </h3>

              {meta.status === "done" && meta.projectId && childProject?.output ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-green-500">
                    ✅ {t("i2v.build-done")}
                  </p>
                  <video
                    controls
                    className="w-full rounded-lg"
                    src={mediaUrl(childProject.output)}
                  />
                  <Link
                    href={`/projects/${meta.projectId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)]"
                  >
                    <ExternalLink size={14} /> {t("i2v.open-project")}
                  </Link>
                </div>
              ) : meta.status === "failed" && meta.error ? (
                <div className="flex flex-col gap-3">
                  <ErrorBanner message={meta.error} />
                  <Button
                    disabled={meta.images.length === 0 || building}
                    onClick={handleBuild}
                  >
                    <RefreshCw size={16} /> {t("i2v.retry-build")}
                  </Button>
                </div>
              ) : busy ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    {meta.status === "analyzing"
                      ? t("i2v.status.analyzing")
                      : meta.status === "building"
                        ? t("i2v.status.building")
                        : t("i2v.status.editing")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("i2v.build-hint")}
                  </p>
                  <Button
                    disabled={
                      meta.images.length === 0 || building || !!meta.projectId
                    }
                    onClick={handleBuild}
                  >
                    {building ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {t("i2v.build")}
                  </Button>
                  {meta.images.length === 0 && (
                    <p className="text-xs text-amber-500">
                      {t("i2v.need-images")}
                    </p>
                  )}
                  {meta.projectId && (
                    <p className="text-xs text-amber-500">
                      {t("i2v.already-built")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* --- Nút Xóa phiên --- */}
          <div className="flex justify-end">
            <Button
              variant="secondary"
              className="text-[var(--danger)] hover:border-[var(--danger)]"
              small
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} /> {t("i2v.delete")}
            </Button>
          </div>
        </div>
      </div>

      {/* Modal xóa */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("i2v.delete-title")}
        description={<p>{t("i2v.delete-desc")}</p>}
        items={[meta.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
