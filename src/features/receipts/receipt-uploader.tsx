"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Camera,
  ClipboardPaste,
  FileImage,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { readApiJson } from "@/lib/api-client";

const ACCEPT =
  "image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif,application/pdf,.heic,.heif,.pdf";

async function maybeConvertHeic(file: File): Promise<File> {
  const isHeic =
    /heic|heif/i.test(file.type) || /\.heic$|\.heif$/i.test(file.name);
  if (!isHeic) return file;

  try {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return new File(
      [blob],
      file.name.replace(/\.(heic|heif)$/i, ".jpg"),
      { type: "image/jpeg" }
    );
  } catch {
    toast.message("HEIC conversion failed — uploading original");
    return file;
  }
}

export function ReceiptUploader({ groupId }: { groupId?: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const { data: groupGate, isLoading: gateLoading } = useQuery({
    queryKey: ["group-upload-gate", groupId],
    enabled: Boolean(groupId),
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Group not found");
      return json.data as {
        group: { id: string; name: string; created_by: string };
        my_role: string | null;
      };
    },
  });

  const blockedForGroup =
    Boolean(groupId) && !gateLoading && groupGate != null && groupGate.my_role !== "owner";

  const processFile = useCallback(
    async (file: File) => {
      if (groupId && groupGate && groupGate.my_role !== "owner") {
        toast.error("Only the group creator can upload receipts to this group");
        return;
      }
      setFileName(file.name);
      if (file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name)) {
        const url = URL.createObjectURL(file);
        setPreview(url);
      } else {
        setPreview(null);
      }

      setUploading(true);
      setScanning(true);
      try {
        const ready = await maybeConvertHeic(file);
        const form = new FormData();
        form.append("file", ready);
        if (groupId) form.append("group_id", groupId);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: form,
        });
        const parsed = await readApiJson<{
          data: {
            id: string;
            itemCount?: number;
            warning?: string;
            ocrFailed?: boolean;
          };
        }>(res);

        if (!parsed.ok) {
          throw new Error(parsed.message);
        }

        const payload = parsed.data.data;
        if (payload.warning || payload.ocrFailed) {
          toast.message("OCR could not read all items", {
            description:
              String(payload.warning ?? "Add items manually or tap Re-run OCR.").slice(
                0,
                160
              ),
          });
        } else {
          const count = payload.itemCount ?? 0;
          toast.success(
            count
              ? `Scanned ${count} item${count === 1 ? "" : "s"}`
              : "Receipt uploaded — add items manually"
          );
        }

        router.push(`/receipts/${payload.id}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
        setScanning(false);
      } finally {
        setUploading(false);
      }
    },
    [router, groupId, groupGate]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void processFile(file);
    },
    [processFile]
  );

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const file = new File([blob], `clipboard-${Date.now()}.png`, {
          type: blob.type || "image/png",
        });
        await processFile(file);
        return;
      }
      toast.error("No image found on clipboard");
    } catch {
      toast.error("Clipboard access denied — try paste in the dropzone (⌘V)");
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith("image/")
    );
    if (!item) return;
    e.preventDefault();
    const blob = item.getAsFile();
    if (blob) void processFile(blob);
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6" onPaste={onPaste}>
      {blockedForGroup && (
        <div className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Only the group creator can upload receipts. Open a receipt on the group page
            and tap what you got instead.
          </p>
          <Button className="mt-4" variant="outline" asChild>
            <Link href={`/groups/${groupId}`}>Back to group</Link>
          </Button>
        </div>
      )}

      {!blockedForGroup && (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "relative overflow-hidden rounded-3xl border-2 border-dashed px-4 py-12 text-center transition-all sm:px-8 sm:py-16",
          dragging
            ? "border-primary bg-accent/40"
            : "border-border bg-muted/20 hover:border-primary/40"
        )}
      >
        <AnimatePresence>
          {scanning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm"
            >
              <div className="relative mb-4 h-24 w-40 overflow-hidden rounded-xl border border-border bg-card">
                <motion.div
                  className="absolute inset-x-0 h-0.5 bg-primary shadow-[0_0_12px_var(--primary)]"
                  animate={{ top: ["8%", "90%", "8%"] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-full w-full object-cover opacity-60" />
                )}
              </div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Scanning receipt…
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Upload className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Drop a receipt here
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          PNG, JPG, WEBP, HEIC, or PDF — up to 12MB. Paste from clipboard with ⌘V /
          Ctrl+V.
        </p>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          <Button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <FileImage /> Choose file
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera /> Camera
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => void pasteFromClipboard()}
          >
            <ClipboardPaste /> Clipboard
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void processFile(f);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void processFile(f);
            e.target.value = "";
          }}
        />
      </div>
      )}

      {fileName && !scanning && !blockedForGroup && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 text-sm">
          <span className="truncate text-muted-foreground">{fileName}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Clear"
            onClick={() => {
              setFileName(null);
              setPreview(null);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
