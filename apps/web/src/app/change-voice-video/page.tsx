"use client";

/**
 * Trang danh sách phiên "Change voice video" - Thay đổi giọng đọc của video.
 */

import {
  ExternalLink,
  Loader2,
  Mic2,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChangeVoiceVideoSession,
  deleteChangeVoiceVideoSession,
  getChangeVoiceVideoSessions,
  isChangeVoiceVideoJob,
  mediaUrl,
  uploadChangeVoiceVideoSource,
  type ChangeVoiceVideoMeta,
  type ChangeVoiceVideoStatus,
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

function CvvStatusBadge({ status }: { status: ChangeVoiceVideoStatus }) {
  const { t } = useT();
  const tone = STATUS_TONE[status] ?? "muted";
  const key = STATUS_LABEL[status];
  return <Badge tone={tone} label={key ? t(key) : status} />;
}

export default function ChangeVoiceVideoListPage() {
  const { t } = useT();
  const router = useRouter();

  const [sessions, setSessions] = useState<ChangeVoiceVideoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);

  const [target, setTarget] = useState<ChangeVoiceVideoMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getChangeVoiceVideoSessions();
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
    if (!isChangeVoiceVideoJob(job)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCreating(true);
    setError(null);
    try {
      const session = await createChangeVoiceVideoSession({
        name: file.name.replace(/\.[^/.]+$/, ""),
      });
      await uploadChangeVoiceVideoSource(session.id, file);
      router.push(`/change-voice-video/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onDelete() {
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteChangeVoiceVideoSession(target.id);
      setTarget(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const shown = sessions?.filter((s) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.source.originalFileName &&
        s.source.originalFileName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.change-voice-video")}
        subtitle={t("cvv.subtitle")}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,.mov,.webm,.mkv,.avi,.m4v"
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
              {t("cvv.new")}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={t("cvv.load-error")} detail={error} />}

      <Card>
        <Toolbar
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t("cvv.search"),
          }}
        />
        {shown && shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("cvv.col-cues")}</th>
                  <th>{t("cvv.col-voice")}</th>
                  <th>{t("cvv.col-output")}</th>
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
                    onClick={() => router.push(`/change-voice-video/${s.id}`)}
                  >
                    <td>
                      <span className="font-medium">{s.name}</span>
                      {s.source.originalFileName && (
                        <span className="mt-1 block max-w-[360px] truncate text-meta text-[var(--text-muted)]">
                          {s.source.originalFileName}
                        </span>
                      )}
                    </td>
                    <td>
                      <CvvStatusBadge status={s.status} />
                    </td>
                    <td>
                      <span className="text-sm">
                        {s.cues.length > 0 ? `${s.cues.length} câu` : "-"}
                      </span>
                    </td>
                    <td>
                      <span className="text-sm font-medium">
                        {s.voiceSettings.voice}
                      </span>
                      <span className="ml-1 text-xs text-[var(--text-muted)]">
                        ({s.voiceSettings.engine})
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.status === "done" && s.output.file ? (
                        <a
                          href={mediaUrl(`change-voice-video/${s.id}/${s.output.file}`)}
                          download={`${(s.name || s.source.originalFileName || "video").replace(/\.[^/.]+$/, "")}-change-voice.mp4`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-green-500 hover:underline"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("cvv.open-output")}
                        </a>
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
            <EmptyState icon={Volume2} description={t("common.no-match")} />
          ) : (
            <EmptyState
              icon={Volume2}
              description={t("cvv.empty")}
              action={
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} strokeWidth={2} />
                  {t("cvv.new")}
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
        title={t("cvv.delete-title")}
        description={<p>{t("cvv.delete-desc")}</p>}
        items={target ? [target.name] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
