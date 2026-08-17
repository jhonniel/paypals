"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/** Shows undismissed admin announcements as a global modal with the full article. */
export function AnnouncementGate({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
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

  if (!userId || !current) return null;

  return (
    <AnnouncementReader
      announcementId={current.id}
      article={{
        id: current.id,
        title: current.title,
        summary: current.summary,
        body: current.body,
        published_at: current.published_at,
        created_at: current.created_at,
      }}
      busy={busy}
      onClose={() => void closeModal()}
      onOpened={() => {
        void fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ link: `/announcements/${current.id}` }),
        });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      }}
    />
  );
}
