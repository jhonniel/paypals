"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Loader2, KeyRound } from "lucide-react";
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
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["groups"],
    queryFn: fetchGroups,
  });
  const [open, setOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

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
      if (json.data?.id) {
        router.push(`/groups/${json.data.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function joinByCode(e: React.FormEvent) {
    e.preventDefault();
    const code = inviteCode.trim();
    if (code.length < 4) {
      toast.error("Enter a valid invite code");
      return;
    }
    setJoining(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Join failed");
      toast.success("Joined group");
      setInviteCode("");
      setJoinOpen(false);
      await qc.invalidateQueries({ queryKey: ["groups"] });
      const groupId = json.data?.group_id;
      if (groupId) router.push(`/groups/${groupId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Join failed");
    } finally {
      setJoining(false);
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
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setJoinOpen((v) => !v);
              setOpen(false);
            }}
          >
            <KeyRound /> Join with code
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setOpen((v) => !v);
              setJoinOpen(false);
            }}
          >
            <Plus /> New group
          </Button>
        </div>
      </div>

      {joinOpen && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <form onSubmit={(e) => void joinByCode(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="join-code">Invite code</Label>
                <Input
                  id="join-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Paste group invite code"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  minLength={4}
                />
                <p className="text-xs text-muted-foreground">
                  Ask a group member for their invite code, then join here.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={joining || inviteCode.trim().length < 4}>
                  {joining && <Loader2 className="animate-spin" />}
                  Join group
                </Button>
                <Button type="button" variant="ghost" onClick={() => setJoinOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {open && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <form onSubmit={(e) => void createGroup(e)} className="space-y-4">
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
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-2xl" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load"}
        </p>
      )}

      {data && data.length === 0 && !open && !joinOpen && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No groups yet</p>
            <p className="text-sm text-muted-foreground">
              Create one, or join with an invite code from a friend.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => setJoinOpen(true)}>
                <KeyRound /> Join with code
              </Button>
              <Button onClick={() => setOpen(true)}>
                <Plus /> New group
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {(data ?? []).map((g) => (
          <li key={g.id}>
            <Link
              href={`/groups/${g.id}`}
              className="glass flex h-full min-h-[7.5rem] flex-col justify-between gap-3 rounded-2xl p-3 transition hover:bg-muted/40 sm:min-h-[8.5rem] sm:p-4"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground">
                {g.name.trim().charAt(0).toUpperCase() || "G"}
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium leading-snug sm:text-base">
                  {g.name}
                </p>
                <p className="mt-1 truncate text-[11px] capitalize text-muted-foreground sm:text-xs">
                  {g.my_role}
                  {g.description ? ` · ${g.description}` : ""}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
