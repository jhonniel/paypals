import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.appUrl || "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup", "/invite/"],
        disallow: [
          "/dashboard",
          "/receipts",
          "/groups",
          "/friends",
          "/analytics",
          "/settings",
          "/profile",
          "/admin",
          "/api/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
