"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
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

export function NotificationsBell({ userId }: { userId: string | null }) {
  const qc = useQueryClient();

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

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    invalidate();
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={10}
          collisionPadding={{
            top: 12,
            right: 12,
            bottom: 12,
            left: 12,
          }}
          avoidCollisions
          className={cn(
            "notification-bubble z-[100] flex w-[min(calc(100vw-1.5rem),22rem)] max-h-[min(70dvh,24rem)] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.65)]"
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
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
              <Popover.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </Popover.Close>
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
                    <Popover.Close asChild>
                      <Link
                        href={n.link || "/dashboard"}
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
                    </Popover.Close>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
