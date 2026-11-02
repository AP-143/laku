import type { ThreadItem } from "./thread";

/** The conversation lives in this browser only. Every access is guarded: storage can be blocked or full. */

const KEY = "laku:conversation:v1";
const MAX_ITEMS = 200;

export function loadConversation(): ThreadItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ThreadItem[]) : [];
  } catch {
    return [];
  }
}

export function saveConversation(items: ThreadItem[]): void {
  try {
    // Drop transient state that only makes sense while a request is running.
    const saved = items.slice(-MAX_ITEMS).map((item) => (item.kind === "scenes" ? { ...item, busy: undefined } : item));
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Without storage the chat still works; it just will not survive a reload.
  }
}
