"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

type ConfirmModalProps = {
  title: string;
  description?: string;
  highlight?: React.ReactNode;
  highlightClassName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default" | "secondary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  titleId?: string;
};

export function ConfirmModal({
  title,
  description,
  highlight,
  highlightClassName,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
  onConfirm,
  onClose,
  titleId = "confirm-modal-title",
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, busy]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div
        className="relative z-[1] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {highlight ? (
            <div
              className={cn(
                "rounded-xl border border-border bg-muted/30 px-4 py-3 text-center",
                highlightClassName
              )}
            >
              {highlight}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={onClose}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              className="flex-1"
              variant={variant}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
