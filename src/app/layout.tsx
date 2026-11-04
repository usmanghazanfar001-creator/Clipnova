import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipnova - Upload once. Get scroll-stopping shorts in minutes.",
  description: "Turn long videos into ready-to-post vertical clips with captions for Shorts, Reels and TikTok.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
