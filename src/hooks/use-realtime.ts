"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Subscribe to group member changes */
export function useGroupRealtime(groupId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!groupId) return;
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient();
    } catch {
      return;
    }

    const channel = client
      .channel(`group-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${groupId}`,
        },
        () => onChange()
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [groupId, onChange]);
}

/** Subscribe to receipt items + assignments for collaborative editing */
export function useReceiptRealtime(receiptId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!receiptId) return;
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient();
    } catch {
      return;
    }

    const channel = client
      .channel(`receipt-${receiptId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipts",
          filter: `id=eq.${receiptId}`,
        },
        () => onChange()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipt_items",
          filter: `receipt_id=eq.${receiptId}`,
        },
        () => onChange()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipt_item_assignments",
        },
        () => onChange()
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [receiptId, onChange]);
}

/** Live notifications for current user */
export function useNotificationsRealtime(userId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!userId) return;
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient();
    } catch {
      return;
    }

    const channel = client
      .channel(`notif-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => onChange()
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [userId, onChange]);
}
