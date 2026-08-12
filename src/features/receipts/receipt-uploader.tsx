"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Camera,
  ClipboardPaste,
  FileImage,
  Loader2,
  X,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ReceiptScanOverlay } from "@/components/receipt-scan-overlay";
import { cn } from "@/utils/cn";
import { readApiJson } from "@/lib/api-client";
import {
  isPayloadTooLargeError,
  prepareReceiptUpload,
} from "@/lib/compress-receipt-image";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [creatingManual, setCreatingManual] = useState(false);
  const [linkGroupId, setLinkGroupId] = useState(groupId ?? "");
  const [liveCameraOpen, setLiveCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);

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

  const { data: ownedGroups } = useQuery({
    queryKey: ["groups-owned-for-upload"],
    enabled: !groupId,
    queryFn: async () => {
      const res = await fetch("/api/groups");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load groups");
      const rows = (json.data ?? []) as Array<{
        id: string;
        name: string;
        created_by?: string;
        my_role?: string;
      }>;
      return rows.filter((g) => g.my_role === "owner");
    },
  });

  const blockedForGroup =
    Boolean(groupId) && !gateLoading && groupGate != null && groupGate.my_role !== "owner";

  const effectiveGroupId = groupId || linkGroupId || null;

  async function createManualReceipt() {
    if (effectiveGroupId && groupId && groupGate && groupGate.my_role !== "owner") {
      toast.error("Only the group creator can add receipts to this group");
      return;
    }
    setCreatingManual(true);
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: null,
          group_id: effectiveGroupId,
          items: [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not create receipt");
      toast.success("Add your items, then save");
      router.push(`/receipts/${json.data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create receipt");
    } finally {
      setCreatingManual(false);
    }
  }

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
        const compressed = await prepareReceiptUpload(ready);
        const form = new FormData();
        form.append("file", compressed);
        if (effectiveGroupId) form.append("group_id", effectiveGroupId);

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
          if (isPayloadTooLargeError(res.status, parsed.message)) {
            throw new Error(
              "Photo is too large for upload. We’ll compress the next try — or use a smaller image."
            );
          }
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
    [router, groupId, groupGate, effectiveGroupId]
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

  function stopLiveCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLiveCameraOpen(false);
    setCameraStarting(false);
  }

  async function openCamera() {
    const prefersNativeCapture =
      typeof navigator !== "undefined" &&
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Mobile: native camera via file input (must not use display:none)
    if (prefersNativeCapture) {
      cameraRef.current?.click();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      cameraRef.current?.click();
      return;
    }

    setCameraStarting(true);
    setLiveCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      stopLiveCamera();
      toast.message("Couldn’t open webcam — choose a photo instead");
      cameraRef.current?.click();
    } finally {
      setCameraStarting(false);
    }
  }

  function captureFromLiveCamera() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      toast.error("Camera not ready yet");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error("Couldn’t capture photo");
          return;
        }
        stopLiveCamera();
        const file = new File([blob], `camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        void processFile(file);
      },
      "image/jpeg",
      0.92
    );
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

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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

      {!blockedForGroup && !groupId && (ownedGroups?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <Label htmlFor="link-group">Link to a group (optional)</Label>
          <select
            id="link-group"
            className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
            value={linkGroupId}
            onChange={(e) => setLinkGroupId(e.target.value)}
          >
            <option value="">No group yet — link later</option>
            {ownedGroups!.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!blockedForGroup && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:flex-1"
            disabled={creatingManual || uploading}
            onClick={() => void createManualReceipt()}
          >
            {creatingManual ? <Loader2 className="animate-spin" /> : <PenLine />}
            Enter items manually
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
          scanning && "min-h-[28rem] sm:min-h-[32rem]",
          dragging
            ? "border-primary bg-accent/40"
            : "border-border bg-muted/20 hover:border-primary/40"
        )}
      >
        <ReceiptScanOverlay active={scanning} previewUrl={preview} />

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Upload className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Drop a receipt here
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          PNG, JPG, WEBP, HEIC, or PDF. Photos are compressed automatically before
          upload. Paste from clipboard with ⌘V / Ctrl+V.
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
            disabled={uploading || cameraStarting}
            asChild
          >
            <label
              htmlFor="receipt-camera-input"
              className="inline-flex cursor-pointer items-center justify-center gap-2"
              onClick={(e) => {
                const mobile =
                  typeof navigator !== "undefined" &&
                  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                if (!mobile && typeof navigator !== "undefined" && navigator.mediaDevices) {
                  e.preventDefault();
                  void openCamera();
                }
              }}
            >
              {cameraStarting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Camera />
              )}
              Camera
            </label>
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

        {/* Keep file inputs in the tree but visible to the browser (not display:none) */}
        <input
          id="receipt-file-input"
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="pointer-events-none absolute h-px w-px opacity-0"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void processFile(f);
            e.target.value = "";
          }}
        />
        <input
          id="receipt-camera-input"
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="pointer-events-none absolute h-px w-px opacity-0"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void processFile(f);
            e.target.value = "";
          }}
        />
      </div>
      )}

      {liveCameraOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/90">
          <div className="flex items-center justify-between gap-2 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <p className="text-sm font-medium text-white">Take a receipt photo</p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={stopLiveCamera}
              aria-label="Close camera"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
            {cameraStarting && (
              <Loader2 className="absolute h-8 w-8 animate-spin text-white" />
            )}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="max-h-full max-w-full rounded-2xl object-contain"
            />
          </div>
          <div className="flex justify-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <Button type="button" variant="secondary" onClick={stopLiveCamera}>
              Cancel
            </Button>
            <Button type="button" onClick={captureFromLiveCamera} disabled={cameraStarting}>
              <Camera /> Capture
            </Button>
          </div>
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
