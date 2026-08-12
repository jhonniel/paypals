"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Loader2, KeyRound, ArrowRight, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemBreakdownList } from "@/components/item-breakdown-list";
import type { ReceiptSubItem } from "@/lib/receipt-sub-items";

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  my_role: string;
  created_at: string;
  my_owes?: number;
  my_share?: number;
  my_currency?: string;
  my_paid?: boolean;
  my_is_bill_payer?: boolean;
  my_receipts?: Array<{
    receipt_id: string;
    merchant: string | null;
    currency: string;
    items: Array<{
      name: string;
      quantity: number;
      amount: number;
      sub_items?: ReceiptSubItem[];
    }>;
  }>;
};

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

async function fetchGroups(): Promise<GroupRow[]> {
  const res = await fetch("/api/groups");
  const text = await res.text();
  let json: { data?: GroupRow[]; error?: { message?: string } } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      /^internal server error$/i.test(text.trim())
        ? "Server error — restart the dev server (clear .next cache)."
        : `Invalid server response: ${text.slice(0, 80)}`
    );
  }
  if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load groups");
  return json?.data ?? [];
}

/** Stable pseudo-random 0..1 derived from a string, so each tile floats differently. */
function seededRandom(seed: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const faceStyle: CSSProperties = {
  backfaceVisibility: "hidden",
  WebkitBackfaceVisibility: "hidden",
  transformStyle: "preserve-3d",
};

function GroupFlipTile({ group }: { group: GroupRow }) {
  const [flipped, setFlipped] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flareKey, setFlareKey] = useState(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startRotation: number;
    width: number;
    moved: boolean;
  } | null>(null);
  const suppressTapRef = useRef(false);
  const lastBackTapRef = useRef(0);
  const handledDoubleTapRef = useRef(false);

  const owes = group.my_owes ?? 0;
  const currency = group.my_currency ?? "PHP";
  const receipts = group.my_receipts ?? [];
  const billPaid =
    Boolean(group.my_paid) ||
    (Boolean(group.my_is_bill_payer) && owes <= 0);
  const itemCount = receipts.reduce(
    (total, receipt) => total + receipt.items.length,
    0
  );

  function snapTo(nextRotation: number) {
    const turn = Math.round(nextRotation / 180);
    const nextFlipped = Math.abs(turn) % 2 === 1;
    if (nextFlipped !== flipped) setFlareKey((k) => k + 1);
    setFlipped(nextFlipped);
    setRotation(turn * 180);
    if (!nextFlipped) lastBackTapRef.current = 0;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Let links / footer Open control work normally.
    if (target.closest("a, button")) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startRotation: rotation,
      width: Math.max(event.currentTarget.getBoundingClientRect().width, 1),
      moved: false,
    };
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const delta = drag.startX - event.clientX;
    if (Math.abs(delta) > 6) drag.moved = true;

    const next = Math.max(
      drag.startRotation - 180,
      Math.min(
        drag.startRotation + 180,
        drag.startRotation + (delta / drag.width) * 180
      )
    );
    setRotation(next);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const delta = drag.startX - event.clientX;
    const current = Math.max(
      drag.startRotation - 180,
      Math.min(
        drag.startRotation + 180,
        drag.startRotation + (delta / drag.width) * 180
      )
    );
    const snappedRotation = Math.round(current / 180) * 180;

    if (drag.moved) {
      suppressTapRef.current = true;
      window.setTimeout(() => {
        suppressTapRef.current = false;
      }, 50);
      snapTo(snappedRotation);
    } else if (!suppressTapRef.current) {
      if (!flipped) {
        // Single tap/click → flip to items
        snapTo(rotation + 180);
      } else {
        // Double tap/click → flip back to original
        const now = Date.now();
        if (now - lastBackTapRef.current < 350) {
          lastBackTapRef.current = 0;
          handledDoubleTapRef.current = true;
          window.setTimeout(() => {
            handledDoubleTapRef.current = false;
          }, 400);
          snapTo(rotation + 180);
        } else {
          lastBackTapRef.current = now;
        }
      }
    }

    dragRef.current = null;
    setDragging(false);
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a")) return;
    // Already handled by the second click in onPointerUp.
    if (handledDoubleTapRef.current) return;
    if (!flipped) return;
    event.preventDefault();
    lastBackTapRef.current = 0;
    snapTo(rotation + 180);
  }

  return (
    <li
      className="relative aspect-square"
      style={{ perspective: "900px" } as CSSProperties}
    >
      <div
        className="tile-float relative h-full w-full"
        style={
          {
            // Randomize rhythm per tile so they never float in sync
            animationDuration: `${4.2 + seededRandom(group.id, 1) * 3.6}s`,
            animationDelay: `-${(seededRandom(group.id, 2) * 8).toFixed(2)}s`,
            animationDirection:
              seededRandom(group.id, 3) > 0.5 ? "normal" : "reverse",
            animationPlayState: dragging ? "paused" : "running",
          } as CSSProperties
        }
      >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        title={
          flipped
            ? "Tap rotate to flip back, or double-tap the card"
            : "Tap to view items"
        }
        className={`relative h-full w-full select-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={
          {
            transform: `rotateY(${rotation}deg)`,
            transformStyle: "preserve-3d",
            WebkitTransformStyle: "preserve-3d",
            transition: dragging
              ? "none"
              : "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)",
            touchAction: "none",
          } as CSSProperties
        }
      >
        {/* Front */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border border-border bg-card p-2.5 text-center shadow-sm"
          style={{ ...faceStyle, transform: "rotateY(0deg)" }}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-base font-semibold text-accent-foreground">
            {group.name.trim().charAt(0).toUpperCase() || "G"}
          </div>
          <div className="min-w-0 w-full">
            <p className="truncate text-base font-semibold leading-snug sm:text-lg">
              {group.name}
            </p>
            <p className="truncate text-xs capitalize text-muted-foreground sm:text-sm">
              {group.my_role}
              {group.description ? ` · ${group.description}` : ""}
            </p>
          </div>
          {owes > 0 ? (
            <div className="w-full rounded-lg bg-background/60 px-2 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                You owe
              </p>
              <p className="truncate text-2xl font-bold leading-tight tabular-nums tracking-tight text-amber-600 dark:text-amber-400 sm:text-3xl">
                {money(owes, currency)}
              </p>
            </div>
          ) : group.my_paid ? (
            <p className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Paid
            </p>
          ) : group.my_is_bill_payer && (group.my_share ?? 0) > 0 ? (
            <p className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              You paid the bill
            </p>
          ) : null}
          {flareKey > 0 && (
            <span
              key={`front-flare-${flareKey}`}
              className="card-flare pointer-events-none absolute inset-y-[-15%] left-0 w-2/3 bg-gradient-to-r from-transparent via-white/25 to-transparent blur-md dark:via-white/15"
              aria-hidden
            />
          )}
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm"
          style={{ ...faceStyle, transform: "rotateY(180deg)" }}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {itemCount} item{itemCount === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Flip back"
              onPointerDown={(e) => {
                // Don't start card drag / double-tap tracking
                e.stopPropagation();
                e.preventDefault();
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                e.preventDefault();
                suppressTapRef.current = true;
                window.setTimeout(() => {
                  suppressTapRef.current = false;
                }, 80);
                // Single tap on icon flips back (card still needs double-tap)
                snapTo(rotation + 180);
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <RotateCw className="h-4 w-4 -scale-x-100" />
            </button>
          </div>

          <div className="my-2 min-h-0 flex-1 overflow-y-auto pr-1">
            {itemCount > 0 ? (
              <div className="space-y-2">
                {receipts.map((receipt) => (
                  <div key={receipt.receipt_id}>
                    {receipt.merchant ? (
                      <p className="mb-0.5 truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {receipt.merchant}
                      </p>
                    ) : null}
                    <ItemBreakdownList
                      items={receipt.items}
                      currency={receipt.currency}
                      dense
                      showTotal={billPaid}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 text-center">
                <p className="text-xs text-muted-foreground">
                  No assigned items yet
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground/80">
                  Tap rotate to flip back, or double-tap the card
                </p>
              </div>
            )}
          </div>

          <Link
            href={`/groups/${group.id}`}
            className="flex w-full items-center justify-between border-t border-border/60 pt-2 transition-colors hover:opacity-90"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              suppressTapRef.current = true;
              window.setTimeout(() => {
                suppressTapRef.current = false;
              }, 80);
            }}
            aria-label={`Open ${group.name}`}
          >
            <span className="text-sm font-semibold tabular-nums">
              {group.my_paid
                ? "Paid"
                : owes > 0
                  ? money(owes, currency)
                  : group.my_is_bill_payer
                    ? "Bill paid"
                    : money(0, currency)}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
              Open <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
          {flareKey > 0 && (
            <span
              key={`back-flare-${flareKey}`}
              className="card-flare pointer-events-none absolute inset-y-[-15%] left-0 w-2/3 bg-gradient-to-r from-transparent via-white/25 to-transparent blur-md dark:via-white/15"
              aria-hidden
            />
          )}
        </div>
      </div>
      </div>
    </li>
  );
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
    router.push(`/invite/${encodeURIComponent(code)}`);
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
                <Button type="submit" disabled={inviteCode.trim().length < 4}>
                  Continue
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

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
        {(data ?? []).map((g) => (
          <GroupFlipTile key={g.id} group={g} />
        ))}
      </ul>
    </div>
  );
}
