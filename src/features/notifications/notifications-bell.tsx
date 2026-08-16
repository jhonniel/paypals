"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { Bell, Megaphone, Users, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useNotificationsRealtime } from "@/hooks/use-realtime";
import { AnnouncementReader } from "@/features/announcements/announcement-reader";
import { announcementIdFromLink } from "@/lib/announcements";
import { cn } from "@/utils/cn";

type Notif = {
  id: string;
  type?: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

type NotificationsPayload = {
  items: Notif[];
  unreadCount: number;
};

function isGroupNotification(n: Notif) {
  return (
    n.type === "member_joined" ||
    (n.type === "invitation" && Boolean(n.link?.startsWith("/groups/")))
  );
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

export function NotificationsBell({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const [readerId, setReaderId] = useState<string | null>(null);

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
      return {
        items: json.data as Notif[],
        unreadCount: Number(json.meta?.unread_count ?? 0),
      } satisfies NotificationsPayload;
    },
    enabled: Boolean(userId),
  });

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    invalidate();
  }

  async function markRead(ids: string[]) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    invalidate();
  }

  function openAnnouncement(n: Notif) {
    const id = announcementIdFromLink(n.link);
    if (!id) return;
    setReaderId(id);
    if (!n.read_at) void markRead([n.id]);
  }

  function openNotification(n: Notif) {
    if (!n.read_at) void markRead([n.id]);
  }

  return (
    <>
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
            {unreadCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground"
                aria-hidden
              >
                {formatUnreadCount(unreadCount)}
              </span>
            )}
            {unreadCount > 0 ? (
              <span className="sr-only">
                {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
              </span>
            ) : null}
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
              "notification-bubble z-[100] flex w-[min(calc(100vw-1.5rem),22rem)] max-h-[min(70dvh,24rem)] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_16px_40px_-12px_rgba(0,0,0,0.65)] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.65)]"
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  Notifications
                </h2>
                {unreadCount > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {unreadCount} unread
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
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
              {items.length === 0 ? (
                <p className="px-2 py-10 text-center text-xs text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {items.map((n) => {
                    const isAnnouncement =
                      n.type === "announcement" ||
                      Boolean(announcementIdFromLink(n.link));
                    const isGroup = isGroupNotification(n);

                    if (isAnnouncement) {
                      return (
                        <li key={n.id}>
                          <Popover.Close asChild>
                            <button
                              type="button"
                              className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
                              onClick={() => openAnnouncement(n)}
                            >
                              <span className="flex items-center gap-1.5 text-sm">
                                <Megaphone className="h-3.5 w-3.5 shrink-0 text-primary" />
                                <span className={cn(n.read_at ? "" : "font-semibold")}>
                                  {n.title}
                                </span>
                              </span>
                              {n.body ? (
                                <span className="line-clamp-2 pl-5 text-xs text-muted-foreground">
                                  {n.body}
                                </span>
                              ) : null}
                              <span className="pl-5 text-[10px] text-muted-foreground">
                                {formatDistanceToNow(new Date(n.created_at), {
                                  addSuffix: true,
                                })}
                              </span>
                            </button>
                          </Popover.Close>
                        </li>
                      );
                    }

                    return (
                      <li key={n.id}>
                        <Popover.Close asChild>
                          <Link
                            href={n.link || "/dashboard"}
                            className="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/70"
                            onClick={() => openNotification(n)}
                          >
                            <span
                              className={cn(
                                "flex items-center gap-1.5 text-sm",
                                n.read_at ? "" : "font-semibold"
                              )}
                            >
                              {isGroup ? (
                                <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : null}
                              {n.title}
                            </span>
                            {n.body ? (
                              <span
                                className={cn(
                                  "line-clamp-2 text-xs text-muted-foreground",
                                  isGroup && "pl-5"
                                )}
                              >
                                {n.body}
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "text-[10px] text-muted-foreground",
                                isGroup && "pl-5"
                              )}
                            >
                              {formatDistanceToNow(new Date(n.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </Link>
                        </Popover.Close>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {readerId ? (
        <AnnouncementReader
          announcementId={readerId}
          onClose={() => setReaderId(null)}
        />
      ) : null}
    </>
  );
}
