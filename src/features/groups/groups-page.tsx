"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  my_role: string;
  created_at: string;
};

async function fetchGroups(): Promise<GroupRow[]> {
  const res = await fetch("/api/groups");
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load groups");
  return json.data ?? [];
}

export function GroupsPageView() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["groups"],
    queryFn: fetchGroups,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      toast.success("Group created");
      setOpen(false);
      setName("");
      setDescription("");
      await qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Family, friends, office — share receipts and splits.
          </p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setOpen((v) => !v)}>
          <Plus /> New group
        </Button>
      </div>

      {open && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <form onSubmit={createGroup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gname">Name</Label>
                <Input
                  id="gname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friday Dinner"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gdesc">Description</Label>
                <Textarea
                  id="gdesc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating && <Loader2 className="animate-spin" />}
                  Create
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load"}
        </p>
      )}

      {data && data.length === 0 && !open && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No groups yet</p>
            <p className="text-sm text-muted-foreground">
              Create one to invite friends and split bills.
            </p>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {(data ?? []).map((g) => (
          <li key={g.id}>
            <Link
              href={`/groups/${g.id}`}
              className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-4 transition hover:bg-muted/40"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{g.name}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {g.my_role}
                  {g.description ? ` · ${g.description}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">Open</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
