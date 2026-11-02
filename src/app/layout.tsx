import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted by Next at build time. The "opsz" axis is what the design's display type relies on.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", axes: ["opsz"], display: "block" });

export const metadata: Metadata = {
  title: "LAKU",
  description: "Ubah foto produk biasa jadi foto studio, storyboard, dan video iklan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
