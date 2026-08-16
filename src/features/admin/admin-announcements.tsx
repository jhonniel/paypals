"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Announcement = {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export function AdminAnnouncementsPanel() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [busy, setBusy] = useState(false);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async () => {
      const res = await fetch("/api/admin/announcements");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      return json.data as Announcement[];
    },
  });

  async function createAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim() || null,
          body: body.trim(),
          publish: publishNow,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      toast.success(
        publishNow
          ? `Published — notified ${json.data?.notified ?? 0} users`
          : "Draft saved"
      );
      setTitle("");
      setSummary("");
      setBody("");
      void qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(announcement: Announcement, publish: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/announcements/${announcement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publish ? { publish: true } : { unpublish: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      toast.success(
        publish
          ? `Published — notified ${json.data?.notified ?? 0} users`
          : "Unpublished"
      );
      void qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAnnouncement(announcement: Announcement) {
    if (!confirm(`Delete “${announcement.title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/announcements/${announcement.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Delete failed");
      toast.success("Announcement deleted");
      void qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" />
            New announcement
          </CardTitle>
          <CardDescription>
            Published announcements pop up for all users until they close the modal.
            They can read the full article anytime from the notification bell.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void createAnnouncement(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's new in Paypals"
                maxLength={200}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ann-summary">Short preview (optional)</Label>
              <Input
                id="ann-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Shown in the modal and notification preview"
                maxLength={500}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ann-body">Full article</Label>
              <Textarea
                id="ann-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write the full announcement here…"
                rows={8}
                maxLength={20000}
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Publish immediately</p>
                <p className="text-xs text-muted-foreground">
                  Sends a notification to every user and shows the modal
                </p>
              </div>
              <Switch
                checked={publishNow}
                onCheckedChange={setPublishNow}
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : publishNow ? (
                "Publish announcement"
              ) : (
                "Save draft"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All announcements</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : announcements.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No announcements yet.
            </p>
          ) : (
            announcements.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{a.title}</p>
                    <span
                      className={
                        a.is_published
                          ? "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                          : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      }
                    >
                      {a.is_published ? "Published" : "Draft"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {a.summary ?? a.body}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {a.is_published && a.published_at
                      ? `Published ${formatDistanceToNow(new Date(a.published_at), { addSuffix: true })}`
                      : `Created ${formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Live</span>
                    <Switch
                      checked={a.is_published}
                      onCheckedChange={(checked) => void togglePublish(a, checked)}
                      disabled={busy}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${a.title}`}
                    disabled={busy}
                    onClick={() => void deleteAnnouncement(a)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
