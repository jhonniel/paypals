"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Paperclip, Receipt, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readApiJson } from "@/lib/api-client";
import { uploadReceiptFiles } from "@/lib/upload-receipt-client";
import { cn } from "@/utils/cn";

const RECEIPT_ACCEPT =
  "image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif,application/pdf,.heic,.heif,.pdf";

type LinkableReceipt = {
  id: string;
  merchant: string | null;
  total: number;
  currency: string;
  status: string;
  created_at: string;
  group_id: string | null;
};

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function GroupAddReceiptModal({
  groupId,
  groupName,
  busy,
  onClose,
  onLinked,
}: {
  groupId: string;
  groupName: string;
  busy?: boolean;
  onClose: () => void;
  onLinked: () => void | Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"upload" | "attach" | "existing">("upload");
  const [query, setQuery] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const searchQ = query.trim();

  const { data, isLoading, error } = useQuery({
    queryKey: ["receipts", "linkable", groupId, searchQ],
    enabled: mode === "existing",
    queryFn: async () => {
      const params = new URLSearchParams({
        excludeGroup: groupId,
        pageSize: "50",
      });
      if (searchQ.length >= 2) params.set("q", searchQ);
      const res = await fetch(`/api/receipts?${params}`);
      const parsed = await readApiJson<{ data: LinkableReceipt[] }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      return (parsed.data.data ?? []).filter(
        (receipt) => receipt.group_id !== groupId
      );
    },
  });

  async function attachReceiptPhotos() {
    if (!attachFiles.length) {
      attachInputRef.current?.click();
      return;
    }
    setAttaching(true);
    try {
      const { pageCount } = await uploadReceiptFiles({
        files: attachFiles,
        groupId,
        skipOcr: true,
      });
      toast.success(
        pageCount > 1
          ? `Attached ${pageCount} pages to ${groupName}`
          : `Receipt photo attached to ${groupName}`
      );
      setAttachFiles([]);
      if (attachInputRef.current) attachInputRef.current.value = "";
      await onLinked();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach receipt");
    } finally {
      setAttaching(false);
    }
  }

  async function linkReceipt(receipt: LinkableReceipt) {
    if (receipt.group_id === groupId) {
      toast.message("This receipt is already on the group");
      return;
    }
    setLinkingId(receipt.id);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId }),
      });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success(
        receipt.merchant
          ? `Added “${receipt.merchant}” to ${groupName}`
          : "Receipt added to group"
      );
      await onLinked();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add receipt");
    } finally {
      setLinkingId(null);
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !linkingId && !busy && !attaching) onClose();
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, linkingId, busy, attaching]);

  if (!mounted) return null;

  const receipts = data ?? [];
  const isBusy = Boolean(busy || linkingId || attaching);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-group-receipt-title"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-[1] border-b border-border bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="add-group-receipt-title" className="text-base font-semibold">
                Add receipt
              </h2>
              <p className="text-xs text-muted-foreground">
                Upload a new one or pick from your existing receipts
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 shrink-0"
              aria-label="Close"
              disabled={isBusy}
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "upload" ? "default" : "outline"}
              className="min-w-0 px-2"
              onClick={() => setMode("upload")}
            >
              <Upload className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Scan</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "attach" ? "default" : "outline"}
              className="min-w-0 px-2"
              onClick={() => setMode("attach")}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Attach</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "existing" ? "default" : "outline"}
              className="min-w-0 px-2"
              onClick={() => setMode("existing")}
            >
              <Receipt className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Existing</span>
            </Button>
          </div>
        </div>

        <div className="p-4">
          {mode === "upload" ? (
            <div className="space-y-4 py-2 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Upload className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-medium">Scan and extract line items</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  OCR reads prices from the photo. Best when you want automatic item
                  entry linked to {groupName}.
                </p>
              </div>
              <Button asChild className="w-full">
                <Link href={`/receipts/new?group=${groupId}`}>
                  <Upload className="h-4 w-4" />
                  Go to scan upload
                </Link>
              </Button>
            </div>
          ) : mode === "attach" ? (
            <div className="space-y-4 py-2">
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Paperclip className="h-7 w-7" />
                </div>
                <p className="mt-3 text-sm font-medium">Attach photo only</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save the receipt image to the group without scanning. Add items
                  manually or run OCR later from the receipt editor.
                </p>
              </div>
              <input
                ref={attachInputRef}
                type="file"
                accept={RECEIPT_ACCEPT}
                multiple
                className="hidden"
                disabled={isBusy}
                onChange={(e) => {
                  const list = e.target.files;
                  if (list?.length) setAttachFiles(Array.from(list));
                }}
              />
              {attachFiles.length > 0 ? (
                <ul className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {attachFiles.map((file) => (
                    <li key={`${file.name}-${file.size}`} className="truncate py-0.5">
                      {file.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={isBusy}
                  onClick={() => attachInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                  {attachFiles.length > 0 ? "Change files" : "Choose photo(s)"}
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={isBusy || attachFiles.length === 0}
                  onClick={() => void attachReceiptPhotos()}
                >
                  {attaching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  Attach to group
                </Button>
              </div>
              {attachFiles.length > 1 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Multiple photos are saved as pages on one receipt.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search receipts…"
                  className="pl-9"
                  disabled={isBusy}
                />
              </div>

              {isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <p className="py-8 text-center text-sm text-destructive">
                  {error instanceof Error ? error.message : "Could not load receipts"}
                </p>
              ) : receipts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                  <Receipt className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {searchQ.length >= 2
                      ? "No matching receipts to add."
                      : "No other receipts to add. Upload a new one instead."}
                  </p>
                  {searchQ.length < 2 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => setMode("upload")}
                    >
                      Upload new
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul className="max-h-[min(24rem,50dvh)] space-y-2 overflow-y-auto">
                  {receipts.map((receipt) => {
                    const linking = linkingId === receipt.id;
                    const inOtherGroup = Boolean(receipt.group_id);
                    return (
                      <li key={receipt.id}>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void linkReceipt(receipt)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-3 text-left transition hover:bg-muted/50 disabled:opacity-60",
                            linking && "ring-2 ring-primary/40"
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {receipt.merchant ?? "Untitled receipt"}
                            </p>
                            <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                              {receipt.status.replaceAll("_", " ")}
                              {" · "}
                              {formatDistanceToNow(new Date(receipt.created_at), {
                                addSuffix: true,
                              })}
                              {inOtherGroup ? " · In another group" : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <p className="text-sm font-semibold tabular-nums">
                              {money(receipt.total, receipt.currency)}
                            </p>
                            {linking ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
