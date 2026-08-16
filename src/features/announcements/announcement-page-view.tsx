"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AnnouncementReader } from "@/features/announcements/announcement-reader";

export function AnnouncementPageView({ id }: { id: string }) {
  const router = useRouter();

  useEffect(() => {
    void fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: `/announcements/${id}` }),
    });
  }, [id]);

  return (
    <AnnouncementReader
      announcementId={id}
      onClose={() => router.push("/dashboard")}
    />
  );
}
