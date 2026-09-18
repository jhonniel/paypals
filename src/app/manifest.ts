import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Paypals — Split bills beautifully",
    short_name: "Paypals",
    description:
      "Upload a receipt, extract items with AI, and split the bill with friends in seconds.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "browser"],
    orientation: "portrait-primary",
    background_color: "#f7f8f7",
    theme_color: "#0d9488",
    categories: ["finance", "utilities", "social"],
    lang: "en-PH",
    dir: "ltr",
    prefer_related_applications: false,
    icons: [
      {
        src: "/pwa/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Home",
        url: "/dashboard",
        icons: [{ src: "/pwa/icon-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Groups",
        short_name: "Groups",
        url: "/groups",
        icons: [{ src: "/pwa/icon-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Pal owes me",
        short_name: "Pal owes me",
        url: "/pal-owes-me",
        icons: [{ src: "/pwa/icon-192x192.png", sizes: "192x192" }],
      },
    ],
  };
}
