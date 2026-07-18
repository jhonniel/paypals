"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPHP } from "@/lib/money";

type ReceiptRow = {
  id: string;
  merchant: string | null;
  total: number;
  currency: string;
  status: string;
  created_at: string;
  ocr_confidence: number | null;
};

async function fetchReceipts(): Promise<ReceiptRow[]> {
  const res = await fetch("/api/receipts");
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load receipts");
  return json.data ?? [];
}

export function ReceiptsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Receipts</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Scanned and edited bills
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/receipts/new">
            <Plus /> Upload receipt
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load"}
          </CardContent>
        </Card>
      )}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">No receipts yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a photo or PDF to extract items with OCR.
              </p>
            </div>
            <Button asChild>
              <Link href="/receipts/new">Upload your first receipt</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((r) => (
            <li key={r.id}>
              <Link
                href={`/receipts/${r.id}`}
                className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-4 transition hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.merchant ?? "Untitled receipt"}</p>
                  <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                    {r.status.replaceAll("_", " ")}
                    {" · "}
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    {r.ocr_confidence != null ? ` · ${r.ocr_confidence}% OCR` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">
                  {formatPHP(r.total, r.currency)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
