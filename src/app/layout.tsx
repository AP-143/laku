import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LAKU",
  description: "Ubah foto produk biasa jadi foto studio, storyboard, dan video iklan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
