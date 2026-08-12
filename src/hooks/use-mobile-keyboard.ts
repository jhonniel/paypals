"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Detects mobile soft keyboard via Visual Viewport shrinkage.
 * Used to hide the bottom dock so it doesn't sit on top of inputs.
 */
export function useMobileKeyboardOpen(thresholdPx = 120): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const baselineRef = useRef(
    typeof window !== "undefined" ? window.innerHeight : 0
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;
    baselineRef.current = window.innerHeight;

    function measure() {
      const layoutH = window.innerHeight;

      if (vv) {
        const covered = layoutH - vv.height - vv.offsetTop;
        const open = covered > thresholdPx;
        if (!open) baselineRef.current = Math.max(baselineRef.current, layoutH);
        setKeyboardOpen(open);
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const isField =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        active?.isContentEditable === true;
      const open =
        Boolean(isField) && layoutH < baselineRef.current - thresholdPx;
      if (!open) baselineRef.current = Math.max(baselineRef.current, layoutH);
      setKeyboardOpen(open);
    }

    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) {
        window.setTimeout(measure, 50);
        window.setTimeout(measure, 300);
      }
    }

    function onFocusOut() {
      window.setTimeout(measure, 50);
      window.setTimeout(measure, 300);
    }

    measure();
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [thresholdPx]);

  return keyboardOpen;
}
