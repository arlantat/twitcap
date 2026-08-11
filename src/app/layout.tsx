import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TwitCap — JP stream captions (VI/EN)",
  description:
    "English timed captions for Japanese TwitCasting archives. Local pipeline: yt-dlp → JP ASR → EN translation → SRT/VTT.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TwitCap",
  },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink font-sans text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
