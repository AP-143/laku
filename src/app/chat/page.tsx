import type { Metadata } from "next";
import ChatApp from "./ChatApp";

export const metadata: Metadata = {
  title: "Chat · LAKU",
  description: "Ubah foto produk biasa jadi foto studio, storyboard, dan video iklan lewat satu chat.",
};

export default function ChatPage() {
  return <ChatApp />;
}
