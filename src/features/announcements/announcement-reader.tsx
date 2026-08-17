"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Megaphone, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

export type AnnouncementArticle = {
  id: string;
  title: string;
  summary?: string | null;
  body: string;
  published_at?: string | null;
  created_at?: string;
};

type AnnouncementReaderProps = {
  announcementId: string;
  /** Skip fetch when article data is already available (e.g. pending popup). */
  article?: AnnouncementArticle | null;
  onClose: () => void;
  /** Called after the article is shown (e.g. mark notification read). */
  onOpened?: () => void;
  busy?: boolean;
};

export function AnnouncementReader({
  announcementId,
  article: preloaded,
  onClose,
  onOpened,
  busy = false,
}: AnnouncementReaderProps) {
  const [mounted, setMounted] = useState(false);

  const { data: fetched, isLoading, error } = useQuery({
    queryKey: ["announcement", announcementId],
    queryFn: async () => {
      const res = await fetch(`/api/announcements/${announcementId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      return json.data as AnnouncementArticle;
    },
    enabled: !preloaded,
  });

  const data = preloaded ?? fetched;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (data) onOpened?.();
  }, [data, onOpened]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, busy]);

  if (!mounted) return null;

  const summary =
    data?.summary?.trim() &&
    data.summary.trim().toLowerCase() !== data.body.trim().toLowerCase()
      ? data.summary.trim()
      : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-reader-title"
      className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close announcement"
        disabled={busy}
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-[1] flex max-h-[min(92dvh,40rem)] w-full flex-col overflow-hidden",
          "rounded-t-2xl border border-border bg-background shadow-2xl sm:max-w-xl sm:rounded-2xl"
        )}
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
            <Megaphone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            {!preloaded && isLoading ? (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading…</span>
              </div>
            ) : error && !data ? (
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : "Could not load announcement"}
              </p>
            ) : (
              <>
                <h2 id="announcement-reader-title" className="text-base font-semibold">
                  {data?.title}
                </h2>
                {data?.published_at ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(data.published_at), { addSuffix: true })}
                  </p>
                ) : null}
              </>
            )}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {data ? (
            <div className="space-y-3">
              {summary ? (
                <p className="text-sm font-medium leading-relaxed text-foreground">
                  {summary}
                </p>
              ) : null}
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {data.body}
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-border px-4 py-3">
          <Button type="button" className="w-full" disabled={busy} onClick={onClose}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Got it"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
