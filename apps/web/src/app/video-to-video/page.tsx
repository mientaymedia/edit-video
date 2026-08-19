"use client";

/**
 * Trang danh sách phiên "Video to video" - Tái cấu trúc & Dựng lại phong cách từ video nguồn.
 */

import {
  ExternalLink,
  Loader2,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVideoToVideoSession,
  deleteVideoToVideoSession,
  getVideoToVideoSessions,
  isVideoToVideoJob,
  uploadVideoToVideoSource,
  type VideoToVideoMeta,
  type VideoToVideoStatus,
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

function VtvStatusBadge({ status }: { status: VideoToVideoStatus }) {
  const { t } = useT();
  const tone = STATUS_TONE[status] ?? "muted";
  const key = STATUS_LABEL[status];
  return <Badge tone={tone} label={key ? t(key) : status} />;
}

export default function VideoToVideoListPage() {
  const { t } = useT();
  const router = useRouter();

  const [sessions, setSessions] = useState<VideoToVideoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);

  const [target, setTarget] = useState<VideoToVideoMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getVideoToVideoSessions();
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
    if (!isVideoToVideoJob(job)) return;
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
      const session = await createVideoToVideoSession({
        name: file.name.replace(/\.[^/.]+$/, ""),
      });
      await uploadVideoToVideoSource(session.id, file);
      router.push(`/video-to-video/${session.id}`);
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
      await deleteVideoToVideoSession(target.id);
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
        title={t("nav.video-to-video")}
        subtitle={t("vtv.subtitle")}
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
              {t("vtv.new")}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={t("vtv.load-error")} detail={error} />}

      <Card>
        <Toolbar
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t("vtv.search"),
          }}
        />
        {shown && shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("vtv.col-video")}</th>
                  <th className="hidden xl:table-cell">{t("vtv.col-reframe")}</th>
                  <th>{t("vtv.col-project")}</th>
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
                    onClick={() => router.push(`/video-to-video/${s.id}`)}
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
                      <VtvStatusBadge status={s.status} />
                    </td>
                    <td>
                      {s.source.file ? (
                        <span className="text-sm">
                          {s.source.width && s.source.height
                            ? `${s.source.width}x${s.source.height}`
                            : "✓"}
                          {s.source.durationSec && (
                            <span className="ml-1 text-[var(--text-muted)]">
                              ({clock(s.source.durationSec)})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                    <td className="hidden text-sm text-[var(--text-muted)] xl:table-cell">
                      {s.reframeMode}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.projectId ? (
                        <Link
                          href={`/projects/${s.projectId}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("vtv.open-project")}
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
            <EmptyState icon={Video} description={t("common.no-match")} />
          ) : (
            <EmptyState
              icon={Video}
              description={t("vtv.empty")}
              action={
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} strokeWidth={2} />
                  {t("vtv.new")}
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
        title={t("vtv.delete-title")}
        description={<p>{t("vtv.delete-desc")}</p>}
        items={target ? [target.name] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
