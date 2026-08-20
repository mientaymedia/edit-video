"use client";

/**
 * Chi tiết một phiên "Video to video" - Tái cấu trúc & Dựng lại phong cách từ video nguồn.
 */

import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Mic,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildVideoToVideo,
  deleteVideoToVideoSession,
  getProject,
  getVideoToVideoSession,
  isVideoToVideoJob,
  mediaUrl,
  transcribeVideoToVideo,
  updateVideoToVideoSession,
  uploadVideoToVideoSource,
  type Brief,
  type ProjectDetail,
  type VideoAudioMode,
  type VideoReframeMode,
  type VideoToVideoMeta,
  type VideoToVideoOutput,
  type VideoToVideoStatus,
} from "@/lib/api";
import { useAgentEvents, useJobEvents } from "@/lib/useEvents";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { BriefFields } from "@/components/BriefFields";
import { clock } from "@/components/AutoCutCommon";
import { useT } from "@/lib/i18n";

const STATUS_TONE: Record<VideoToVideoStatus, BadgeTone> = {
  draft: "muted",
  transcribing: "running",
  ready: "success",
  building: "running",
  editing: "running",
  done: "success",
  failed: "danger",
};

const STATUS_LABEL: Record<VideoToVideoStatus, string> = {
  draft: "vtv.status.draft",
  transcribing: "vtv.status.transcribing",
  ready: "vtv.status.ready",
  building: "vtv.status.building",
  editing: "vtv.status.editing",
  done: "vtv.status.done",
  failed: "vtv.status.failed",
};

const REFRAME_MODES: Array<{ id: VideoReframeMode; labelKey: string }> = [
  { id: "blur-fit", labelKey: "vtv.reframe-blur-fit" },
  { id: "smart-crop", labelKey: "vtv.reframe-smart-crop" },
  { id: "letterbox", labelKey: "vtv.reframe-letterbox" },
  { id: "original", labelKey: "vtv.reframe-original" },
];

const AUDIO_MODES: Array<{ id: VideoAudioMode; labelKey: string }> = [
  { id: "keep-original", labelKey: "vtv.audio-keep-original" },
  { id: "replace-bgm", labelKey: "vtv.audio-replace-bgm" },
  { id: "dub-new-voice", labelKey: "vtv.audio-dub-new-voice" },
];

const ASPECTS: VideoToVideoOutput["aspect"][] = ["9:16", "16:9", "1:1", "4:5"];

const RUNNING_STATUS: VideoToVideoStatus[] = [
  "transcribing",
  "building",
  "editing",
];

export default function VideoToVideoDetailPage() {
  const { t } = useT();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [meta, setMeta] = useState<VideoToVideoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Transcribe
  const [transcribing, setTranscribing] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState("");

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
      const data = await getVideoToVideoSession(id);
      setMeta(data);
      setEditedTranscript(data.transcript || "");
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
  }, [load]);

  useJobEvents((job) => {
    if (!isVideoToVideoJob(job, id)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  // ---- Handlers ----

  async function handleUpload(file: File) {
    if (!meta) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadVideoToVideoSource(id, file);
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleTranscribe() {
    if (!meta) return;
    setTranscribing(true);
    setError(null);
    try {
      const updated = await transcribeVideoToVideo(id);
      setMeta(updated);
      setEditedTranscript(updated.transcript || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleSaveTranscript() {
    if (!meta) return;
    try {
      const updated = await updateVideoToVideoSession(id, {
        transcript: editedTranscript,
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePatchBrief(patch: Partial<Brief>) {
    if (!meta) return;
    try {
      const updated = await updateVideoToVideoSession(id, { brief: patch });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePatchOutput(aspect: VideoToVideoOutput["aspect"]) {
    if (!meta) return;
    try {
      const updated = await updateVideoToVideoSession(id, {
        output: { aspect },
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleBuild() {
    if (!meta) return;
    setBuilding(true);
    setError(null);
    try {
      if (editedTranscript !== meta.transcript) {
        await updateVideoToVideoSession(id, { transcript: editedTranscript });
      }
      await buildVideoToVideo(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVideoToVideoSession(id);
      router.push("/video-to-video");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
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
        <Button variant="secondary" onClick={() => router.push("/video-to-video")}>
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
              href="/video-to-video"
              className="inline-flex items-center text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft size={18} />
            </Link>
            <span>{meta.name}</span>
          </div>
        }
        subtitle={`${meta.output.aspect} · ${meta.output.fps}fps`}
        actions={
          <div className="flex items-center gap-2">
            {statusBadge}
            {meta.projectId && (
              <Link
                href={`/projects/${meta.projectId}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)]"
              >
                <ExternalLink size={14} /> {t("vtv.open-project")}
              </Link>
            )}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== CỘT TRÁI: Video nguồn & Bóc lời ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 1: Video nguồn --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Video size={16} /> {t("vtv.section.source")}
              </h3>

              {meta.source.file ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg bg-[var(--bg-subtle)] p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">
                          {meta.source.originalFileName || "source"}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {meta.source.width && meta.source.height
                            ? `${meta.source.width}x${meta.source.height}`
                            : ""}{" "}
                          {meta.source.fps ? `· ${meta.source.fps}fps` : ""}{" "}
                          {meta.source.durationSec
                            ? `· ${clock(meta.source.durationSec)}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        small
                        disabled={busy || uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <RefreshCw size={14} /> {t("vtv.replace-video")}
                      </Button>
                    </div>

                    {/* Video player */}
                    <video
                      controls
                      className="mt-3 max-h-72 w-full rounded-lg bg-black"
                      src={mediaUrl(`video-to-video/${meta.id}/${meta.source.file}`)}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] p-8 transition-colors hover:border-[var(--primary)] hover:bg-[var(--bg-subtle)]"
                  onClick={() => !uploading && fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
                  ) : (
                    <Upload size={32} className="text-[var(--text-muted)]" />
                  )}
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    {t("vtv.upload-hint")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("vtv.max-size")}
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.webm,.mkv,.avi,.m4v"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          </Card>

          {/* --- Khối 2: Bóc lời & Phân cảnh --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Mic size={16} /> {t("vtv.section.transcript")}
              </h3>

              {/* Nút bóc lời */}
              <div className="mb-3 flex items-center gap-2">
                <Button
                  variant="secondary"
                  small
                  disabled={!meta.source.file || busy || transcribing}
                  onClick={handleTranscribe}
                >
                  {transcribing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Wand2 size={14} />
                  )}
                  {meta.transcript
                    ? t("vtv.retranscribe")
                    : t("vtv.transcribe")}
                </Button>
                {meta.transcript && editedTranscript !== meta.transcript && (
                  <Button small onClick={handleSaveTranscript}>
                    {t("common.save")}
                  </Button>
                )}
              </div>

              {/* Textarea transcript */}
              <textarea
                className="min-h-[180px] w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-sm leading-relaxed focus:border-[var(--primary)] focus:outline-none"
                placeholder={t("vtv.transcript-placeholder")}
                value={editedTranscript}
                onChange={(e) => setEditedTranscript(e.target.value)}
                disabled={busy}
              />
              {meta.transcript && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {editedTranscript.length.toLocaleString()} {t("vtv.chars")}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ===== CỘT PHẢI: Cấu hình & Dựng video ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 3: Cấu hình tái chế & Phong cách --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Settings2 size={16} /> {t("vtv.section.config")}
              </h3>

              {/* Tỷ lệ khung hình xuất */}
              <Field label={t("vtv.aspect-ratio")}>
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

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {/* Chế độ Reframe */}
                <Field label={t("vtv.reframe-mode")}>
                  <select
                    className="input"
                    value={meta.reframeMode}
                    disabled={busy}
                    onChange={(e) =>
                      updateVideoToVideoSession(id, {
                        reframeMode: e.target.value as VideoReframeMode,
                      }).then(setMeta)
                    }
                  >
                    {REFRAME_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {t(m.labelKey)}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Chế độ âm thanh */}
                <Field label={t("vtv.audio-mode")}>
                  <select
                    className="input"
                    value={meta.audioMode}
                    disabled={busy}
                    onChange={(e) =>
                      updateVideoToVideoSession(id, {
                        audioMode: e.target.value as VideoAudioMode,
                      }).then(setMeta)
                    }
                  >
                    {AUDIO_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {t(m.labelKey)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Brief Fields - Style Design, 20 Visual Styles, SFX, Music */}
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
                <Sparkles size={16} /> {t("vtv.section.build")}
              </h3>

              {meta.status === "done" && meta.projectId && childProject?.output ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-green-500">
                    ✅ {t("vtv.build-done")}
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
                    <ExternalLink size={14} /> {t("vtv.open-project")}
                  </Link>
                </div>
              ) : meta.status === "failed" && meta.error ? (
                <div className="flex flex-col gap-3">
                  <ErrorBanner message={meta.error} />
                  <Button
                    disabled={!meta.source.file || building}
                    onClick={handleBuild}
                  >
                    <RefreshCw size={16} /> {t("vtv.retry-build")}
                  </Button>
                </div>
              ) : busy ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    {meta.status === "transcribing"
                      ? t("vtv.status.transcribing")
                      : meta.status === "building"
                        ? t("vtv.status.building")
                        : t("vtv.status.editing")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("vtv.build-hint")}
                  </p>
                  <Button
                    disabled={
                      !meta.source.file ||
                      building ||
                      !!meta.projectId
                    }
                    onClick={handleBuild}
                  >
                    {building ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {t("vtv.build")}
                  </Button>
                  {!meta.source.file && (
                    <p className="text-xs text-amber-500">
                      {t("vtv.need-video")}
                    </p>
                  )}
                  {meta.projectId && (
                    <p className="text-xs text-amber-500">
                      {t("vtv.already-built")}
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
              <Trash2 size={14} /> {t("vtv.delete")}
            </Button>
          </div>
        </div>
      </div>

      {/* Modal xóa */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("vtv.delete-title")}
        description={<p>{t("vtv.delete-desc")}</p>}
        items={[meta.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
