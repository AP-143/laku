import type { ChatIntent } from "../../shared/chat-events";
import { OUTDATED_REPLIES } from "../../shared/chat-messages";
import { storyboardFrames, storyboardScenes, type ThreadItem } from "./thread";

/** The chats live in this browser only. Every access is guarded: storage can be blocked or full. */

/** The key of the single conversation the app kept before sessions existed. */
const KEY = "laku:conversation:v1";
const SESSIONS_KEY = "laku:sessions:v1";
const MAX_ITEMS = 200;
const MAX_SESSIONS = 30;
const MAX_TITLE = 32;

/** One chat the seller can come back to, listed in the sidebar. */
export interface ChatSession {
  id: string;
  items: ThreadItem[];
}

/** Every saved chat, newest first, and the one on screen. There is always at least one (possibly empty) session. */
export interface Workspace {
  sessions: ChatSession[];
  activeId: string;
}

/** The part of localStorage this module uses, so tests can pass a plain object. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptySession = (): ChatSession => ({ id: crypto.randomUUID(), items: [] });

function readJson(storage: KeyValueStorage | undefined, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const isSession = (value: unknown): value is ChatSession =>
  typeof value === "object" && value !== null && typeof (value as ChatSession).id === "string" && Array.isArray((value as ChatSession).items);

/** A reply of the bot saved with older wording reads as the current one; the seller's own words are never touched. */
function withCurrentWording(item: ThreadItem): ThreadItem {
  if (item.kind !== "bot") return item;
  const current = Object.hasOwn(OUTDATED_REPLIES, item.text) ? OUTDATED_REPLIES[item.text] : undefined;
  return current ? { ...item, text: current } : item;
}

export function loadWorkspace(storage: KeyValueStorage | undefined): Workspace {
  const saved = readJson(storage, SESSIONS_KEY) as Partial<Workspace> | null | undefined;
  if (saved && Array.isArray(saved.sessions) && saved.sessions.length > 0 && saved.sessions.every(isSession)) {
    const activeId = saved.sessions.some((session) => session.id === saved.activeId) ? saved.activeId! : saved.sessions[0].id;
    const sessions = saved.sessions.map((session) => ({ ...session, items: session.items.map(withCurrentWording) }));
    return { sessions, activeId };
  }
  // Before sessions existed the whole app kept one conversation under another key; it becomes the first session.
  const legacy = readJson(storage, KEY);
  const session = { ...emptySession(), items: Array.isArray(legacy) ? (legacy as ThreadItem[]).map(withCurrentWording) : [] };
  return { sessions: [session], activeId: session.id };
}

export function saveWorkspace(storage: KeyValueStorage | undefined, workspace: Workspace): void {
  try {
    // Drop transient state that only makes sense while a request is running.
    const sessions = workspace.sessions.map((session) => ({
      ...session,
      items: session.items.slice(-MAX_ITEMS).map((item) => (item.kind === "scenes" ? { ...item, busy: undefined } : item)),
    }));
    storage?.setItem(SESSIONS_KEY, JSON.stringify({ sessions, activeId: workspace.activeId }));
  } catch {
    // Without storage the chat still works; it just will not survive a reload.
  }
}

/** What the sidebar shows for a session: a title from the first message, and the feature of its first result. */
export function describeSession(session: ChatSession): { title: string; feature?: ChatIntent } {
  const first = session.items.find((item) => item.kind === "user");
  const text = first?.kind === "user" ? first.text.trim() : "";
  const title = !first
    ? "Chat baru"
    : !text
      ? "Foto produk"
      : text.length > MAX_TITLE
        ? `${text.slice(0, MAX_TITLE).trimEnd()}…`
        : text;
  return { title, feature: featureOf(session.items) };
}

function featureOf(items: ThreadItem[]): ChatIntent | undefined {
  for (const item of items) {
    if (item.kind === "studio") return "studio_photo";
    // Storyboard and video are one feature: the video is made from the storyboard.
    if (item.kind === "scenes" || item.kind === "video" || item.kind === "partial") return "storyboard";
  }
  return undefined;
}

/**
 * The storyboard a video is made from. The session on screen comes first; without frames of its own it borrows
 * the newest storyboard of another session, so a video chat can use a storyboard made in a storyboard chat.
 */
export function storyboardFor(workspace: Workspace): { frames: string[]; scenes: string[] } {
  const here = activeSession(workspace);
  const source =
    storyboardFrames(here.items).length > 0
      ? here
      : (workspace.sessions.find((session) => storyboardFrames(session.items).length > 0) ?? here);
  return { frames: storyboardFrames(source.items), scenes: storyboardScenes(source.items) };
}

/** The session on screen. */
export function activeSession(workspace: Workspace): ChatSession {
  return workspace.sessions.find((session) => session.id === workspace.activeId) ?? workspace.sessions[0];
}

/** Shows another session. An id that is not in the list changes nothing. */
export function selectSession(workspace: Workspace, id: string): Workspace {
  return workspace.sessions.some((session) => session.id === id) ? { ...workspace, activeId: id } : workspace;
}

/** Removes a session from the list for good. */
export function deleteSession(workspace: Workspace, id: string): Workspace {
  const position = workspace.sessions.findIndex((session) => session.id === id);
  if (position === -1) return workspace;
  const sessions = workspace.sessions.filter((session) => session.id !== id);
  // There is always a session to show, even when the last one was deleted.
  if (sessions.length === 0) return loadWorkspace(undefined);
  if (id !== workspace.activeId) return { ...workspace, sessions };
  // The next older session takes its place on screen, or the newest one left when it was the oldest.
  return { sessions, activeId: (sessions[position] ?? sessions[position - 1]).id };
}

/** Puts a fresh, empty session on top of the list and shows it. */
export function startSession(workspace: Workspace): Workspace {
  // Another blank session would only add an empty row to the sidebar, so a blank one that exists is shown instead.
  const blank = workspace.sessions.find((session) => session.items.length === 0);
  if (blank) return selectSession(workspace, blank.id);
  const session = emptySession();
  return { sessions: [session, ...workspace.sessions].slice(0, MAX_SESSIONS), activeId: session.id };
}

/** Replaces the messages of the session on screen. */
export function setActiveItems(workspace: Workspace, items: ThreadItem[]): Workspace {
  return {
    ...workspace,
    sessions: workspace.sessions.map((session) => (session.id === workspace.activeId ? { ...session, items } : session)),
  };
}

/** The browser's localStorage, or nothing when the browser does not allow even looking at it. */
export function browserStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
