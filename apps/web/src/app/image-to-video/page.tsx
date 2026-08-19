"use client";

/**
 * Trang danh sách phiên "Image to video" - dựng video chuyển động từ hình ảnh.
 */

import {
  ExternalLink,
  Film,
  Images,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createImageToVideoSession,
  deleteImageToVideoSession,
  getImageToVideoSessions,
  isImageToVideoJob,
  uploadImageToVideoImages,
  type ImageToVideoMeta,
  type ImageToVideoStatus,
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
import { formatDateTime } from "@/lib/format";
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

function I2vStatusBadge({ status }: { status: ImageToVideoStatus }) {
  const { t } = useT();
  const tone = STATUS_TONE[status] ?? "muted";
  const key = STATUS_LABEL[status];
  return <Badge tone={tone} label={key ? t(key) : status} />;
}

export default function ImageToVideoListPage() {
  const { t } = useT();
  const router = useRouter();

  const [sessions, setSessions] = useState<ImageToVideoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);

  const [target, setTarget] = useState<ImageToVideoMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getImageToVideoSessions();
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
    if (!isImageToVideoJob(job)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const fileList = Array.from(files);
      const session = await createImageToVideoSession({
        name: fileList[0].name.replace(/\.[^/.]+$/, ""),
      });
      await uploadImageToVideoImages(session.id, fileList);
      router.push(`/image-to-video/${session.id}`);
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
      await deleteImageToVideoSession(target.id);
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
      s.images.some((img) => img.originalFileName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.image-to-video")}
        subtitle={t("i2v.subtitle")}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp"
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
              {t("i2v.new")}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={t("i2v.load-error")} detail={error} />}

      <Card>
        <Toolbar
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t("i2v.search"),
          }}
        />
        {shown && shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("i2v.col-images")}</th>
                  <th className="hidden xl:table-cell">{t("i2v.col-motion")}</th>
                  <th>{t("i2v.col-project")}</th>
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
                    onClick={() => router.push(`/image-to-video/${s.id}`)}
                  >
                    <td>
                      <span className="font-medium">{s.name}</span>
                      {s.images.length > 0 && (
                        <span className="mt-1 block max-w-[360px] truncate text-meta text-[var(--text-muted)]">
                          {s.images.map((img) => img.originalFileName).join(", ")}
                        </span>
                      )}
                    </td>
                    <td>
                      <I2vStatusBadge status={s.status} />
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                        <Images size={15} className="text-[var(--text-muted)]" />
                        {s.images.length}
                      </span>
                    </td>
                    <td className="hidden text-sm text-[var(--text-muted)] xl:table-cell">
                      {s.motionDefault}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.projectId ? (
                        <Link
                          href={`/projects/${s.projectId}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("i2v.open-project")}
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
            <EmptyState icon={Film} description={t("common.no-match")} />
          ) : (
            <EmptyState
              icon={Film}
              description={t("i2v.empty")}
              action={
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} strokeWidth={2} />
                  {t("i2v.new")}
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
        title={t("i2v.delete-title")}
        description={<p>{t("i2v.delete-desc")}</p>}
        items={target ? [target.name] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
