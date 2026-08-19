"use client";

/**
 * Chi tiết một phiên "Voice to video" - dựng video từ file âm thanh giọng đọc.
 *
 * Luồng:
 * 1. Upload file âm thanh (.mp3, .wav, .m4a, …)
 * 2. Bóc lời tự động (faster-whisper) → duyệt & sửa transcript
 * 3. Cấu hình: Style Design, Phong cách dựng, Tỷ lệ khung hình
 * 4. Bấm "Dựng video" → AI dựng video với track audio gốc
 */

import {
  ArrowLeft,
  ExternalLink,
  Headphones,
  Loader2,
  Mic,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildVoiceToVideo,
  deleteVoiceToVideo,
  getProject,
  getVoiceToVideoSession,
  isVoiceToVideoJob,
  mediaUrl,
  transcribeVoiceToVideo,
  updateVoiceToVideo,
  uploadVoiceToVideoAudio,
  type Brief,
  type Job,
  type ProjectDetail,
  type VoiceToVideoMeta,
  type VoiceToVideoOutput,
  type VoiceToVideoStatus,
} from "@/lib/api";
import {
  useAgentEvents,
  useJobEvents,
} from "@/lib/useEvents";
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

const STATUS_TONE: Record<VoiceToVideoStatus, BadgeTone> = {
  draft: "muted",
  transcribing: "running",
  ready: "success",
  building: "running",
  editing: "running",
  done: "success",
  failed: "danger",
};

const STATUS_LABEL: Record<VoiceToVideoStatus, string> = {
  draft: "v2v.status.draft",
  transcribing: "v2v.status.transcribing",
  ready: "v2v.status.ready",
  building: "v2v.status.building",
  editing: "v2v.status.editing",
  done: "v2v.status.done",
  failed: "v2v.status.failed",
};

const ASPECTS: VoiceToVideoOutput["aspect"][] = ["9:16", "16:9", "1:1", "4:5"];

/** Trạng thái "đang có việc chạy" → khóa ô nhập */
const RUNNING_STATUS: VoiceToVideoStatus[] = ["transcribing", "building", "editing"];

export default function VoiceToVideoDetailPage() {
  const { t } = useT();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [meta, setMeta] = useState<VoiceToVideoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Transcribe
  const [transcribing, setTranscribing] = useState(false);

  // Build
  const [building, setBuilding] = useState(false);

  // Edited transcript
  const [editedTranscript, setEditedTranscript] = useState("");

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Child project
  const [childProject, setChildProject] = useState<ProjectDetail | null>(null);

  const busy = meta ? RUNNING_STATUS.includes(meta.status) : false;

  const load = useCallback(async () => {
    try {
      const data = await getVoiceToVideoSession(id);
      setMeta(data);
      setEditedTranscript(data.transcript || "");
      setError(null);
      // Load child project if exists
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
    if (!isVoiceToVideoJob(job, id)) return;
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
      const updated = await uploadVoiceToVideoAudio(id, file);
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
      const updated = await transcribeVoiceToVideo(id);
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
      const updated = await updateVoiceToVideo(id, { transcript: editedTranscript });
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
      // Save transcript first if changed
      if (editedTranscript !== meta.transcript) {
        await updateVoiceToVideo(id, { transcript: editedTranscript });
      }
      await buildVoiceToVideo(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function handlePatchBrief(patch: Partial<Brief>) {
    if (!meta) return;
    try {
      const updated = await updateVoiceToVideo(id, { brief: patch });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePatchOutput(aspect: VoiceToVideoOutput["aspect"]) {
    if (!meta) return;
    try {
      const updated = await updateVoiceToVideo(id, { output: { aspect } });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVoiceToVideo(id);
      router.push("/voice-to-video");
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
        <Button variant="secondary" onClick={() => router.push("/voice-to-video")}>
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
              href="/voice-to-video"
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
                <ExternalLink size={14} /> {t("v2v.open-project")}
              </Link>
            )}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== CỘT TRÁI: File âm thanh & Bóc lời ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 1: File âm thanh --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Headphones size={16} /> {t("v2v.section.audio")}
              </h3>

              {meta.audioFile ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg bg-[var(--bg-subtle)] p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{meta.originalFileName || "audio"}</p>
                        {meta.audioDurationSec && (
                          <p className="text-sm text-[var(--text-muted)]">
                            {t("v2v.duration")}: {clock(meta.audioDurationSec)}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        small
                        disabled={busy || uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <RefreshCw size={14} /> {t("v2v.replace-audio")}
                      </Button>
                    </div>
                    {/* Audio player */}
                    <audio
                      controls
                      className="mt-3 w-full"
                      src={mediaUrl(meta.audioFile)}
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
                    {t("v2v.upload-hint")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    MP3, WAV, M4A, AAC, OGG, FLAC · {t("v2v.max-size")}
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.wma"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          </Card>

          {/* --- Khối 2: Bóc lời & Transcript --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Mic size={16} /> {t("v2v.section.transcript")}
              </h3>

              {/* Nút bóc lời */}
              <div className="mb-3 flex items-center gap-2">
                <Button
                  variant="secondary"
                  small
                  disabled={!meta.audioFile || busy || transcribing}
                  onClick={handleTranscribe}
                >
                  {transcribing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Wand2 size={14} />
                  )}
                  {meta.transcript
                    ? t("v2v.retranscribe")
                    : t("v2v.transcribe")}
                </Button>
                {meta.transcript && editedTranscript !== meta.transcript && (
                  <Button small onClick={handleSaveTranscript}>
                    {t("common.save")}
                  </Button>
                )}
              </div>

              {/* Textarea transcript */}
              <textarea
                className="min-h-[200px] w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-sm leading-relaxed focus:border-[var(--primary)] focus:outline-none"
                placeholder={t("v2v.transcript-placeholder")}
                value={editedTranscript}
                onChange={(e) => setEditedTranscript(e.target.value)}
                disabled={busy}
              />
              {meta.transcript && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {editedTranscript.length.toLocaleString()} {t("v2v.chars")}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ===== CỘT PHẢI: Cấu hình & Dựng video ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 3: Cấu hình video --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Settings2 size={16} /> {t("v2v.section.config")}
              </h3>

              {/* Tỷ lệ khung hình */}
              <Field label={t("v2v.aspect-ratio")}>
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

              {/* Brief Fields - Style Design, Video Style, etc */}
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
                <Sparkles size={16} /> {t("v2v.section.build")}
              </h3>

              {meta.status === "done" && meta.projectId && childProject?.output ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-green-500">
                    ✅ {t("v2v.build-done")}
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
                    <ExternalLink size={14} /> {t("v2v.open-project")}
                  </Link>
                </div>
              ) : meta.status === "failed" && meta.error ? (
                <div className="flex flex-col gap-3">
                  <ErrorBanner message={meta.error} />
                  <Button
                    disabled={!meta.audioFile || building}
                    onClick={handleBuild}
                  >
                    <RefreshCw size={16} /> {t("v2v.retry-build")}
                  </Button>
                </div>
              ) : busy ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    {meta.status === "transcribing"
                      ? t("v2v.progress.transcribing")
                      : meta.status === "building"
                        ? t("v2v.progress.building")
                        : t("v2v.progress.editing")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("v2v.build-hint")}
                  </p>
                  <Button
                    disabled={
                      !meta.audioFile ||
                      !meta.transcript.trim() ||
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
                    {t("v2v.build")}
                  </Button>
                  {!meta.audioFile && (
                    <p className="text-xs text-amber-500">
                      {t("v2v.need-audio")}
                    </p>
                  )}
                  {meta.audioFile && !meta.transcript.trim() && (
                    <p className="text-xs text-amber-500">
                      {t("v2v.need-transcript")}
                    </p>
                  )}
                  {meta.projectId && (
                    <p className="text-xs text-amber-500">
                      {t("v2v.already-built")}
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
              <Trash2 size={14} /> {t("v2v.delete")}
            </Button>
          </div>
        </div>
      </div>

      {/* Modal xóa */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("v2v.delete-title")}
        description={<p>{t("v2v.delete-desc")}</p>}
        items={[meta.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
