"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/utils/cn";

type OpenSeat = { member_id: string; guest_name: string };

function normalizeSeats(raw: unknown): OpenSeat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      const member_id = String(r.member_id ?? r.memberId ?? r.id ?? "");
      const guest_name = String(r.guest_name ?? r.guestName ?? "").trim();
      if (!member_id || !guest_name) return null;
      return { member_id, guest_name };
    })
    .filter((s): s is OpenSeat => Boolean(s));
}

export function InviteJoinView({ code }: { code: string }) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [forcedSeats, setForcedSeats] = useState<OpenSeat[] | null>(null);

  const { data, isLoading, error, isError, refetch } = useQuery({
    queryKey: ["invite", code],
    queryFn: async () => {
      const res = await fetch(`/api/groups/join?code=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (res.status === 401) {
        const err = new Error("AUTH") as Error & { code?: string };
        err.code = "AUTH";
        throw err;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Invalid invite");
      const payload = json.data as {
        id: string;
        name: string;
        description: string | null;
        member_count: number;
        open_seats?: unknown;
        must_pick_name?: boolean;
      };
      return {
        ...payload,
        open_seats: normalizeSeats(payload.open_seats),
        must_pick_name: Boolean(payload.must_pick_name),
      };
    },
    retry: false,
  });

  const openSeats = forcedSeats ?? data?.open_seats ?? [];
  const mustPickName = openSeats.length > 0 || Boolean(data?.must_pick_name);
  const afterSignup = `/signup?next=${encodeURIComponent(`/invite/${code}`)}`;

  useEffect(() => {
    setForcedSeats(null);
    setSelectedSeatId(null);
  }, [code]);

  async function join(memberId?: string) {
    setJoining(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          member_id: memberId,
        }),
      });
      const json = await res.json();
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/invite/${code}`)}`);
        return;
      }
      if (!res.ok) {
        if (json?.error?.code === "PICK_SEAT") {
          const seats = normalizeSeats(json?.error?.details?.open_seats);
          if (seats.length > 0) {
            setForcedSeats(seats);
            toast.error("Pick your name on the list first");
            return;
          }
          toast.error("Pick your name on the bill to join");
          await refetch();
          return;
        }
        throw new Error(json?.error?.message ?? "Join failed");
      }
      const groupId = json.data?.group_id as string | undefined;
      if (!groupId) throw new Error("Join succeeded but group was missing");
      toast.success(
        memberId ? "Seat claimed — pick what you got next" : "Joined group"
      );
      router.push(`/groups/${groupId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Join failed");
    } finally {
      setJoining(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError && (error as Error & { code?: string })?.code === "AUTH") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Sign in to join</CardTitle>
          <CardDescription>
            Create an account with an admin signup invite, then come back to pick your
            name on this group.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}>
              Sign in
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={afterSignup}>Create account</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Invite not found</CardTitle>
          <CardDescription>
            {error instanceof Error && (error as Error & { code?: string }).code !== "AUTH"
              ? error.message
              : "This link may be invalid."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Users className="h-5 w-5" />
        </div>
        <CardTitle>{data.name}</CardTitle>
        <CardDescription>
          {mustPickName
            ? "Pick your name on the bill, then you’ll choose what you ordered."
            : data.description || "You've been invited to split bills on Paypals."}
          {data.member_count != null ? ` · ${data.member_count} members` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mustPickName ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium">Who are you?</p>
              {openSeats.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Loading names… If nothing appears, ask the owner to add your name,
                  then refresh.
                </p>
              ) : (
                <ul className="space-y-2">
                  {openSeats.map((seat) => {
                    const selected = selectedSeatId === seat.member_id;
                    return (
                      <li key={seat.member_id}>
                        <button
                          type="button"
                          onClick={() => setSelectedSeatId(seat.member_id)}
                          className={cn(
                            "flex w-full items-center rounded-xl border px-3 py-3 text-left text-sm font-medium transition",
                            selected
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-muted/40"
                          )}
                        >
                          {seat.guest_name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Button
              className="w-full"
              onClick={() => {
                if (!selectedSeatId) {
                  toast.error("Pick your name first");
                  return;
                }
                void join(selectedSeatId);
              }}
              disabled={joining || !selectedSeatId}
            >
              {joining && <Loader2 className="animate-spin" />}
              That’s me — join
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Ask the owner to add your name if it isn’t listed.
            </p>
          </>
        ) : (
          <Button className="w-full" onClick={() => void join()} disabled={joining}>
            {joining && <Loader2 className="animate-spin" />}
            Join group
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
