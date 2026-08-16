"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ConfirmModal } from "@/components/confirm-modal";
import { AnnouncementReader } from "@/features/announcements/announcement-reader";
import { useDeferredReady } from "@/hooks/use-deferred-ready";

type PendingAnnouncement = {
  id: string;
  title: string;
  summary: string;
  body: string;
  published_at: string | null;
  created_at: string;
};

/** Shows undismissed admin announcements as a global modal. */
export function AnnouncementGate({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const [readerId, setReaderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deferredReady = useDeferredReady(800);

  const { data: pending = [] } = useQuery({
    queryKey: ["announcements-pending"],
    queryFn: async () => {
      const res = await fetch("/api/announcements/pending");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      return json.data as PendingAnnouncement[];
    },
    enabled: Boolean(userId) && deferredReady,
    refetchOnWindowFocus: false,
    staleTime: 120_000,
  });

  const current = pending[0] ?? null;

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["announcements-pending"] });
  }, [qc]);

  async function dismiss(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/announcements/${id}/dismiss`, { method: "POST" });
      invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function closeModal() {
    if (!current || busy) return;
    await dismiss(current.id);
  }

  async function readFullArticle() {
    if (!current) return;
    const id = current.id;
    await dismiss(id);
    setReaderId(id);
  }

  if (!userId || !current) {
    return readerId ? (
      <AnnouncementReader
        announcementId={readerId}
        onClose={() => setReaderId(null)}
      />
    ) : null;
  }

  return (
    <>
      <ConfirmModal
        title={current.title}
        description={
          current.published_at
            ? `Posted ${formatDistanceToNow(new Date(current.published_at), { addSuffix: true })}`
            : "Announcement from Paypals"
        }
        highlight={
          <div className="space-y-3 text-left">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Megaphone className="h-5 w-5" />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {current.summary}
            </p>
          </div>
        }
        cancelLabel="Close"
        confirmLabel="Read full article"
        onClose={() => void closeModal()}
        onConfirm={() => void readFullArticle()}
        busy={busy}
      />

      {readerId ? (
        <AnnouncementReader
          announcementId={readerId}
          onClose={() => setReaderId(null)}
          onOpened={() => {
            void fetch("/api/notifications", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ link: `/announcements/${readerId}` }),
            });
            void qc.invalidateQueries({ queryKey: ["notifications"] });
          }}
        />
      ) : null}
    </>
  );
}
