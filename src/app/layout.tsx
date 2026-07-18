import type { Metadata } from "next";
import { Instrument_Serif, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import "./globals.css";

const instrument = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Paypals — Split bills beautifully",
    template: "%s · Paypals",
  },
  description:
    "Upload a receipt, extract items with AI, and split the bill with friends in seconds.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  applicationName: "Paypals",
  openGraph: {
    type: "website",
    locale: "en_PH",
    siteName: "Paypals",
    title: "Paypals — Split bills beautifully",
    description:
      "Upload a receipt, extract items with AI, and split the bill with friends in seconds.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Paypals — Split bills beautifully",
    description:
      "Upload a receipt, extract items with AI, and split the bill with friends in seconds.",
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Paypals",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#070a09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${instrument.variable} ${geistMono.variable} font-sans antialiased`}
        style={
          {
            ["--font-satoshi" as string]: "'Satoshi', ui-sans-serif, system-ui, sans-serif",
          } as React.CSSProperties
        }
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <QueryProvider>
            {children}
            <ToastProvider />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
