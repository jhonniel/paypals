"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useNotificationsRealtime } from "@/hooks/use-realtime";
import { cn } from "@/utils/cn";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

export function NotificationsBell({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }, [qc]);

  useNotificationsRealtime(userId, invalidate);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=15");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      return json.data as Notif[];
    },
    enabled: Boolean(userId),
  });

  const unread = (data ?? []).filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    invalidate();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
        )}
      </Button>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.button
              type="button"
              aria-label="Close notifications"
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease }}
              onClick={() => setOpen(false)}
            />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="notifications-title"
              className={cn(
                "relative z-[1] flex max-h-[min(80dvh,32rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
              )}
              initial={
                reduceMotion
                  ? false
                  : { opacity: 0, y: 16, scale: 0.96 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reduceMotion
                  ? undefined
                  : { opacity: 0, y: 10, scale: 0.97 }
              }
              transition={{ duration: 0.32, ease }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2
                  id="notifications-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Notifications
                </h2>
                <div className="flex items-center gap-2">
                  {unread > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => void markAllRead()}
                    >
                      Mark all read
                    </button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                {(data ?? []).length === 0 ? (
                  <p className="px-2 py-10 text-center text-xs text-muted-foreground">
                    You&apos;re all caught up.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {(data ?? []).map((n) => (
                      <li key={n.id}>
                        <Link
                          href={n.link || "/dashboard"}
                          onClick={() => setOpen(false)}
                          className="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/70"
                        >
                          <span
                            className={cn(
                              "text-sm",
                              n.read_at ? "" : "font-semibold"
                            )}
                          >
                            {n.title}
                          </span>
                          {n.body ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {n.body}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
