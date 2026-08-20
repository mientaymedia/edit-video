"use client";

/**
 * Danh sách phiên "Voice to video" - dựng video từ file âm thanh.
 * Bố cục giống trang Text to video: bảng danh sách phiên, mỗi phiên tải lên
 * file âm thanh → bóc lời → dựng video.
 */

import { ExternalLink, Headphones, Loader2, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createVoiceToVideo,
  deleteVoiceToVideo,
  getVoiceToVideoSessions,
  isVoiceToVideoJob,
  uploadVoiceToVideoAudio,
  type VoiceToVideoMeta,
  type VoiceToVideoStatus,
} from "@/lib/api";
import { useAgentEvents, useJobEvents } from "@/lib/useEvents";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { IconButton } from "@/components/IconButton";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { Toolbar } from "@/components/Toolbar";
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
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

function V2vStatusBadge({ status }: { status: VoiceToVideoStatus }) {
  const { t } = useT();
  const tone = STATUS_TONE[status] ?? "muted";
  const key = STATUS_LABEL[status];
  return <Badge tone={tone} label={key ? t(key) : t("common.status-unknown")} />;
}

export default function VoiceToVideoPage() {
  const { t, tf } = useT();
  const router = useRouter();

  const [sessions, setSessions] = useState<VoiceToVideoMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Create flow: upload file
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete flow
  const [target, setTarget] = useState<VoiceToVideoMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getVoiceToVideoSessions();
      setSessions(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useJobEvents((job) => {
    if (!isVoiceToVideoJob(job)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !sessions) return sessions;
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.originalFileName || "").toLowerCase().includes(q)
    );
  }, [sessions, query]);

  async function handleFileSelect(file: File) {
    setCreating(true);
    setError(null);
    try {
      // 1. Tạo phiên mới
      const session = await createVoiceToVideo();
      // 2. Upload file âm thanh
      await uploadVoiceToVideoAudio(session.id, file);
      // 3. Chuyển sang trang chi tiết
      router.push(`/voice-to-video/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = "";
  }

  async function onDelete() {
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVoiceToVideo(target.id);
      setTarget(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.voice-to-video")}
        subtitle={t("v2v.subtitle")}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.wma"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              disabled={creating}
              onClick={() => fileInputRef.current?.click()}
            >
              {creating ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin" />
              ) : (
                <Upload size={16} strokeWidth={2} />
              )}
              {t("v2v.new")}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={t("v2v.load-error")} detail={error} />}

      <Card>
        <Toolbar
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t("v2v.search"),
          }}
        />
        {shown && shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th className="hidden xl:table-cell">{t("v2v.col-audio")}</th>
                  <th className="hidden xl:table-cell">{t("v2v.col-duration")}</th>
                  <th>{t("v2v.col-project")}</th>
                  <th className="hidden xl:table-cell">{t("common.updated")}</th>
                  <th className="w-10">
                    <span className="sr-only">{t("common.delete")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s.id}
                    className="row-click"
                    onClick={() => router.push(`/voice-to-video/${s.id}`)}
                  >
                    <td>
                      <span className="font-medium">{s.name}</span>
                      {s.originalFileName && (
                        <span className="mt-1 block max-w-[360px] truncate text-meta text-[var(--text-muted)]">
                          {s.originalFileName}
                        </span>
                      )}
                    </td>
                    <td>
                      <V2vStatusBadge status={s.status} />
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {s.audioFile ? "✓" : "-"}
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {s.audioDurationSec ? clock(s.audioDurationSec) : "-"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.projectId ? (
                        <Link
                          href={`/projects/${s.projectId}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("v2v.open-project")}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {formatDateTime(s.updatedAt)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        size="sm"
                        tone="danger"
                        label={`Xóa ${s.name}`}
                        onClick={() => {
                          setDeleteError(null);
                          setTarget(s);
                        }}
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : shown ? (
          query.trim() ? (
            <EmptyState icon={Headphones} description={t("common.no-match")} />
          ) : (
            <EmptyState
              icon={Headphones}
              description={t("v2v.empty")}
              action={
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} strokeWidth={2} />
                  {t("v2v.new")}
                </Button>
              }
            />
          )
        ) : (
          !error && <TableSkeleton />
        )}
      </Card>

      <ConfirmDeleteModal
        open={target !== null}
        title={t("v2v.delete-title")}
        description={<p>{t("v2v.delete-desc")}</p>}
        items={target ? [target.name] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
