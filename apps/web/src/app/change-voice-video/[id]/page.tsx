"use client";

/**
 * Chi tiết phiên "Change voice video" - Thay đổi giọng đọc của video.
 */

import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  Mic,
  Play,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteChangeVoiceVideoSession,
  getChangeVoiceVideoSession,
  getTtsVoices,
  isChangeVoiceVideoJob,
  mediaUrl,
  previewClonedVoice,
  previewTtsVoice,
  renderChangeVoiceVideo,
  transcribeChangeVoiceVideo,
  updateChangeVoiceVideoSession,
  uploadChangeVoiceVideoSource,
  type ChangeVoiceAudioMix,
  type ChangeVoiceCue,
  type ChangeVoiceSettings,
  type ChangeVoiceVideoMeta,
  type ChangeVoiceVideoStatus,
  type TtsEngine,
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
import { clock } from "@/components/AutoCutCommon";
import { useT } from "@/lib/i18n";

const STATUS_TONE: Record<ChangeVoiceVideoStatus, BadgeTone> = {
  draft: "muted",
  transcribing: "running",
  ready: "success",
  rendering: "running",
  done: "success",
  failed: "danger",
};

const STATUS_LABEL: Record<ChangeVoiceVideoStatus, string> = {
  draft: "cvv.status.draft",
  transcribing: "cvv.status.transcribing",
  ready: "cvv.status.ready",
  rendering: "cvv.status.rendering",
  done: "cvv.status.done",
  failed: "cvv.status.failed",
};

const RUNNING_STATUS: ChangeVoiceVideoStatus[] = [
  "transcribing",
  "rendering",
];

export default function ChangeVoiceVideoDetailPage() {
  const { t } = useT();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [meta, setMeta] = useState<ChangeVoiceVideoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Transcribe
  const [transcribing, setTranscribing] = useState(false);

  // Voices
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Render
  const [rendering, setRendering] = useState(false);

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const busy = meta ? RUNNING_STATUS.includes(meta.status) : false;

  const load = useCallback(async () => {
    try {
      const data = await getChangeVoiceVideoSession(id);
      setMeta(data);
      setError(null);
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
    if (!isChangeVoiceVideoJob(job, id)) return;
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
      const updated = await uploadChangeVoiceVideoSource(id, file);
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
      const updated = await transcribeChangeVoiceVideo(id);
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleCueChange(cueId: string, text: string) {
    if (!meta) return;
    const updatedCues = meta.cues.map((c) =>
      c.id === cueId ? { ...c, text } : c
    );
    setMeta({ ...meta, cues: updatedCues });
  }

  async function handleSaveCues() {
    if (!meta) return;
    try {
      const updated = await updateChangeVoiceVideoSession(id, {
        cues: meta.cues,
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteCue(cueId: string) {
    if (!meta) return;
    const updatedCues = meta.cues.filter((c) => c.id !== cueId);
    try {
      const updated = await updateChangeVoiceVideoSession(id, {
        cues: updatedCues,
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAddCue() {
    if (!meta) return;
    const lastCue = meta.cues[meta.cues.length - 1];
    const newStart = lastCue ? lastCue.end : 0;
    const newEnd = newStart + 3;
    const newCue: ChangeVoiceCue = {
      id: `cue_${Date.now()}`,
      start: newStart,
      end: newEnd,
      text: "",
      originalText: "",
    };
    const updatedCues = [...meta.cues, newCue];
    try {
      const updated = await updateChangeVoiceVideoSession(id, {
        cues: updatedCues,
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePatchVoice(patch: Partial<ChangeVoiceSettings>) {
    if (!meta) return;
    try {
      const updated = await updateChangeVoiceVideoSession(id, {
        voiceSettings: patch,
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePatchAudioMix(patch: Partial<ChangeVoiceAudioMix>) {
    if (!meta) return;
    try {
      const updated = await updateChangeVoiceVideoSession(id, {
        audioMix: patch,
      });
      setMeta(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePreviewVoice() {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.currentTime = 0;
      setPreviewAudio(null);
      setPreviewing(false);
      return;
    }

    if (!meta?.voiceSettings.voice) return;
    setPreviewing(true);
    setPreviewError(null);

    try {
      const selectedVoice = voices.find(
        (v) => v.name === meta.voiceSettings.voice
      );
      const engine = selectedVoice?.engine || meta.voiceSettings.engine;

      const blob = await previewTtsVoice({
        voice: meta.voiceSettings.voice,
        engine,
        speed: meta.voiceSettings.speed ?? 1.0,
        uiLang: "vi",
      });

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        setPreviewing(false);
        setPreviewAudio(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPreviewing(false);
        setPreviewAudio(null);
        setPreviewError("Không phát được âm thanh nghe thử");
        URL.revokeObjectURL(url);
      };
      setPreviewAudio(audio);
      await audio.play();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewing(false);
      setPreviewAudio(null);
    }
  }

  async function handleRender() {
    if (!meta) return;
    setRendering(true);
    setError(null);
    try {
      await updateChangeVoiceVideoSession(id, { cues: meta.cues });
      await renderChangeVoiceVideo(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteChangeVoiceVideoSession(id);
      router.push("/change-voice-video");
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
        <Button
          variant="secondary"
          onClick={() => router.push("/change-voice-video")}
        >
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
              href="/change-voice-video"
              className="inline-flex items-center text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft size={18} />
            </Link>
            <span>{meta.name}</span>
          </div>
        }
        subtitle={`${meta.cues.length} ${t("cvv.cue-count")} · ${meta.voiceSettings.voice} (${meta.voiceSettings.engine})`}
        actions={
          <div className="flex items-center gap-2">
            {statusBadge}
            {meta.status === "done" && meta.output.file && (
              <a
                href={mediaUrl(`change-voice-video/${meta.id}/${meta.output.file}`)}
                download={`${(meta.name || meta.source.originalFileName || "video").replace(/\.[^/.]+$/, "")}-change-voice.mp4`}
                className="inline-flex items-center gap-1 text-sm font-medium text-green-500 hover:underline"
              >
                <Download size={14} /> {t("cvv.open-output")}
              </a>
            )}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== CỘT TRÁI: Video nguồn & Danh sách Cues ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 1: Video nguồn --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Volume2 size={16} /> {t("cvv.section.source")}
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
                        <RefreshCw size={14} /> {t("cvv.replace-video")}
                      </Button>
                    </div>

                    {/* Video player: nếu done phát output, nếu chưa phát source */}
                    <video
                      controls
                      className="mt-3 max-h-72 w-full rounded-lg bg-black"
                      src={
                        meta.status === "done" && meta.output.file
                          ? mediaUrl(`change-voice-video/${meta.id}/${meta.output.file}`)
                          : mediaUrl(`change-voice-video/${meta.id}/${meta.source.file}`)
                      }
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
                    {t("cvv.upload-hint")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("cvv.max-size")}
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

          {/* --- Khối 2: Danh sách câu thoại (Cues) --- */}
          <Card>
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <Mic size={16} /> {t("cvv.section.cues")} ({meta.cues.length})
                </h3>
                <div className="flex items-center gap-2">
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
                    {meta.cues.length > 0
                      ? t("cvv.retranscribe")
                      : t("cvv.transcribe")}
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={handleAddCue}
                  >
                    <Plus size={14} /> {t("cvv.add-cue")}
                  </Button>
                </div>
              </div>

              {meta.cues.length > 0 ? (
                <div className="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto pr-1">
                  {meta.cues.map((cue, idx) => (
                    <div
                      key={cue.id}
                      className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5"
                    >
                      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span className="font-semibold">
                          #{idx + 1} · {clock(cue.start)} ➔ {clock(cue.end)} (
                          {(cue.end - cue.start).toFixed(1)}s)
                        </span>
                        <IconButton
                          size="sm"
                          tone="danger"
                          label="Xóa câu"
                          disabled={busy}
                          onClick={() => handleDeleteCue(cue.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>

                      <textarea
                        className="w-full rounded border border-[var(--border)] bg-transparent p-1.5 text-sm leading-snug focus:border-[var(--primary)] focus:outline-none"
                        rows={2}
                        value={cue.text}
                        disabled={busy}
                        onChange={(e) => handleCueChange(cue.id, e.target.value)}
                        onBlur={handleSaveCues}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-[var(--text-muted)]">
                  {t("cvv.need-cues")}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ===== CỘT PHẢI: Chọn Giọng & Phối Âm & Render ===== */}
        <div className="flex flex-col gap-6">
          {/* --- Khối 3: Chọn giọng đọc mới --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Sparkles size={16} /> {t("cvv.section.voice")}
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Giọng đọc */}
                <Field label={t("cvv.voice-select")}>
                  <div className="flex items-center gap-2">
                    <select
                      className="input flex-1"
                      value={meta.voiceSettings.voice}
                      disabled={busy}
                      onChange={(e) => {
                        if (previewAudio) {
                          previewAudio.pause();
                          setPreviewAudio(null);
                          setPreviewing(false);
                        }
                        const selectedVoice = voices.find(
                          (v) => v.name === e.target.value
                        );
                        handlePatchVoice({
                          voice: e.target.value,
                          engine: selectedVoice?.engine || meta.voiceSettings.engine,
                        });
                      }}
                    >
                      {voices.map((v) => (
                        <option
                          key={`${v.engine}-${v.name}`}
                          value={v.name}
                        >
                          {v.title || v.label} ({v.engine})
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      variant={previewAudio ? "destructive" : "secondary"}
                      small
                      disabled={busy || previewing}
                      onClick={handlePreviewVoice}
                      title={previewAudio ? t("cvv.stop-preview") : t("cvv.play-preview")}
                    >
                      {previewing ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : previewAudio ? (
                        <>
                          <Square size={14} className="fill-current" />
                          <span>{t("cvv.stop")}</span>
                        </>
                      ) : (
                        <>
                          <Play size={14} className="fill-current" />
                          <span>{t("cvv.preview")}</span>
                        </>
                      )}
                    </Button>
                  </div>
                  {previewError && (
                    <p className="mt-1 text-xs text-rose-500">{previewError}</p>
                  )}
                </Field>

                {/* Tốc độ đọc */}
                <Field
                  label={t("cvv.voice-speed")}
                  hint={t("cvv.voice-speed-hint")}
                >
                  <select
                    className="input"
                    value={meta.voiceSettings.speed ?? 1.0}
                    disabled={busy}
                    onChange={(e) =>
                      handlePatchVoice({ speed: Number(e.target.value) })
                    }
                  >
                    <option value="0.9">0.9x (Chậm)</option>
                    <option value="1.0">1.0x (Chuẩn)</option>
                    <option value="1.1">1.1x (Hơi nhanh)</option>
                    <option value="1.2">1.2x (Nhanh lôi cuốn)</option>
                  </select>
                </Field>
              </div>
            </div>
          </Card>

          {/* --- Khối 4: Phối âm thanh & Phụ đề --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Sliders size={16} /> {t("cvv.section.audio")}
              </h3>

              {/* Chế độ âm thanh */}
              <Field label={t("cvv.audio-mode")}>
                <div className="flex flex-col gap-2.5">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="cvv-audio-mode"
                      value="mute-original"
                      checked={meta.audioMix.mode === "mute-original"}
                      disabled={busy}
                      className="mt-0.5"
                      onChange={() =>
                        handlePatchAudioMix({ mode: "mute-original" })
                      }
                    />
                    <div>
                      <p className="font-medium text-[var(--text)]">{t("cvv.audio-mute-orig")}</p>
                      <p className="text-xs text-[var(--text-muted)]">{t("cvv.audio-mute-orig-desc")}</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="cvv-audio-mode"
                      value="mute-dialogue-ranges"
                      checked={meta.audioMix.mode === "mute-dialogue-ranges"}
                      disabled={busy}
                      className="mt-0.5"
                      onChange={() =>
                        handlePatchAudioMix({ mode: "mute-dialogue-ranges" })
                      }
                    />
                    <div>
                      <p className="font-medium text-[var(--text)]">{t("cvv.audio-mute-dialogue")}</p>
                      <p className="text-xs text-[var(--text-muted)]">{t("cvv.audio-mute-dialogue-desc")}</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="cvv-audio-mode"
                      value="keep-bgm-ducking"
                      checked={meta.audioMix.mode === "keep-bgm-ducking"}
                      disabled={busy}
                      className="mt-0.5"
                      onChange={() =>
                        handlePatchAudioMix({ mode: "keep-bgm-ducking" })
                      }
                    />
                    <div>
                      <p className="font-medium text-[var(--text)]">{t("cvv.audio-ducking")}</p>
                      <p className="text-xs text-[var(--text-muted)]">{t("cvv.audio-ducking-desc")}</p>
                    </div>
                  </label>
                </div>
              </Field>

              {/* Âm lượng nhạc nền khi ducking */}
              {meta.audioMix.mode === "keep-bgm-ducking" && (
                <div className="mt-4">
                  <Field label={`${t("cvv.bgm-vol")}: ${Math.round((meta.audioMix.bgmVolume ?? 0.15) * 100)}%`}>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full"
                      value={meta.audioMix.bgmVolume ?? 0.15}
                      disabled={busy}
                      onChange={(e) =>
                        handlePatchAudioMix({ bgmVolume: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          {/* --- Khối 5: Bắt đầu Render --- */}
          <Card>
            <div className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <Wand2 size={16} /> {t("cvv.section.render")}
              </h3>

              {meta.status === "done" && meta.output.file ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-green-500">
                    ✅ {t("cvv.render-done")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={mediaUrl(`change-voice-video/${meta.id}/${meta.output.file}`)}
                      download={`${(meta.name || meta.source.originalFileName || "video").replace(/\.[^/.]+$/, "")}-change-voice.mp4`}
                      className="btn btn-primary flex-1 inline-flex items-center justify-center gap-2 py-2.5 font-medium"
                    >
                      <Download size={16} />
                      <span>{t("cvv.download-video")}</span>
                    </a>
                    <Button
                      variant="secondary"
                      disabled={!meta.source.file || meta.cues.length === 0 || rendering}
                      onClick={handleRender}
                    >
                      <RefreshCw size={16} /> {t("cvv.retry-render")}
                    </Button>
                  </div>
                </div>
              ) : meta.status === "failed" && meta.error ? (
                <div className="flex flex-col gap-3">
                  <ErrorBanner message={meta.error} />
                  <Button
                    disabled={!meta.source.file || meta.cues.length === 0 || rendering}
                    onClick={handleRender}
                  >
                    <RefreshCw size={16} /> {t("cvv.retry-render")}
                  </Button>
                </div>
              ) : busy ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    {meta.status === "transcribing"
                      ? t("cvv.status.transcribing")
                      : t("cvv.status.rendering")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("cvv.render-hint")}
                  </p>
                  <Button
                    disabled={
                      !meta.source.file ||
                      meta.cues.length === 0 ||
                      rendering
                    }
                    onClick={handleRender}
                  >
                    {rendering ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Volume2 size={16} />
                    )}
                    {t("cvv.render-btn")}
                  </Button>
                  {!meta.source.file && (
                    <p className="text-xs text-amber-500">
                      {t("cvv.need-video")}
                    </p>
                  )}
                  {meta.source.file && meta.cues.length === 0 && (
                    <p className="text-xs text-amber-500">
                      {t("cvv.need-cues")}
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
              <Trash2 size={14} /> {t("cvv.delete")}
            </Button>
          </div>
        </div>
      </div>

      {/* Modal xóa */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("cvv.delete-title")}
        description={<p>{t("cvv.delete-desc")}</p>}
        items={[meta.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
