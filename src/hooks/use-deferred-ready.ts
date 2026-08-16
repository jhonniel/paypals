"use client";

import { useEffect, useState } from "react";

/** Delay secondary fetches until after first paint / idle time. */
export function useDeferredReady(delayMs = 600) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const enable = () => setReady(true);
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(enable, { timeout: delayMs });
      return () => cancelIdleCallback(id);
    }
    const timer = window.setTimeout(enable, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return ready;
}
