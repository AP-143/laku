"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatEvent, ChatIntent } from "../../shared/chat-events";
import { useInfoDialog } from "../InfoDialog";
import { PaperBackground } from "../PaperBackground";
import { assetUrl, fetchUsage, sendChat, uploadPhoto } from "./chat-client";
import { Composer, type AttachedPhoto } from "./Composer";
import {
  activeSession,
  browserStorage,
  deleteSession,
  loadWorkspace,
  saveWorkspace,
  selectSession,
  setActiveItems,
  startSession,
  storyboardFor,
  type Workspace,
} from "./saved-conversation";
import { Sidebar } from "./Sidebar";
import { ThreadView, type Progress } from "./ThreadView";
import {
  lastPhotoAssetId,
  lastStudioAssetId,
  narratedVideo,
  openStoryboard,
  styleOf,
  type Preset,
  type RetryRequest,
  type ThreadItem,
} from "./thread";
import "./chat.css";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** The width from which the sidebar stays beside the chat; below it, it is a drawer. */
const WIDE_SCREEN = "(min-width: 1000px)";
/** How long the chat must stay unchanged before it is saved. */
const SAVE_DELAY_MS = 400;
const VIDEO_TEXT ="Buatkan video iklan dari storyboard ini.";
const APPROVE_TEXT = "Setuju, buatkan gambarnya ya.";
const HISTORY_LENGTH = 12;

const newId = () => crypto.randomUUID();

const BEFORE_LOAD: Workspace = { sessions: [{ id: "before-load", items: [] }], activeId: "before-load" };

interface Usage {
  monthUsd: number;
}

/** How the events of one request are folded into the thread. */
interface RunContext {
  /** Set when the request continues an open storyboard instead of starting a new one. */
  scenesItemId?: string;
}

export default function ChatApp() {
  // Every saved chat. Until the browser's storage is read there is just one empty placeholder session (no random id during prerender).
  const [workspace, setWorkspace] = useState<Workspace>(BEFORE_LOAD);
  const [ready, setReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<AttachedPhoto | undefined>();
  const [intent, setIntent] = useState<ChatIntent | undefined>();
  const [preset, setPreset] = useState<Preset | undefined>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [usage, setUsage] = useState<Usage | undefined>();
  const [menu, setMenu] = useState(false);
  const info = useInfoDialog();
  // The entrance animation plays once on first paint, then its class is removed.
  const [animating, setAnimating] = useState(true);

  const items = activeSession(workspace).items;
  /** Changes the messages of the session on screen. Requests are not started while another chat is open, so this is the one a request belongs to. */
  const setItems = useCallback((update: (current: ThreadItem[]) => ThreadItem[]) => {
    setWorkspace((current) => setActiveItems(current, update(activeSession(current).items)));
  }, []);

  const itemsRef = useRef(items);
  const workspaceRef = useRef(workspace);
  /** The chat changed and is not written to the browser's storage yet. */
  const savePending = useRef(false);
  const cardRef = useRef<HTMLFormElement>(null);
  const flipFrom = useRef<DOMRect | null>(null);

  const inThread = items.length > 0;

  // Load the saved conversation once, after the first render, so the server and browser markup match.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage can only happen after mount
    setWorkspace(loadWorkspace(browserStorage()));
    setReady(true);
    void fetchUsage().then(setUsage);
  }, []);

  // Callbacks read the newest thread through these refs, so they do not need to be rebuilt on every message.
  useLayoutEffect(() => {
    itemsRef.current = items;
    workspaceRef.current = workspace;
  }, [items, workspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnimating(false), 2600);
    return () => window.clearTimeout(timer);
  }, []);

  // A streamed reply changes the chat many times a second, so the whole history is written once things settle.
  useEffect(() => {
    if (!ready) return;
    savePending.current = true;
    const timer = window.setTimeout(() => {
      saveWorkspace(browserStorage(), workspaceRef.current);
      savePending.current = false;
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workspace, ready]);

  // A change made just before the tab is hidden, closed or left is saved at once instead of waiting for the delay.
  useEffect(() => {
    function flush() {
      if (!savePending.current) return;
      saveWorkspace(browserStorage(), workspaceRef.current);
      savePending.current = false;
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  // When the first message turns the hero into a thread, glide the composer to its new place.
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    const card = cardRef.current;
    if (!from || !card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = card.getBoundingClientRect();
    card.animate(
      [{ transform: `translateY(${from.top - to.top}px)` }, { transform: "translateY(0)" }],
      { duration: 650, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  }, [inThread]);

  const patchItem = useCallback(
    (id: string, change: (item: ThreadItem) => ThreadItem) => {
      setItems((current) => current.map((item) => (item.id === id ? change(item) : item)));
    },
    [setItems],
  );

  /** Sends one request and folds its events into the thread. Used by every button and by the composer. */
  const run = useCallback(
    async (body: Record<string, unknown>, context: RunContext = {}) => {
      setBusy(true);
      setNote(undefined);
      let botId: string | undefined;
      // After a video stopped part way, only the "remake this part" button may continue it, never a full retry.
      let videoStopped = false;
      const retry: RetryRequest = body;

      const handle = (event: ChatEvent) => {
        switch (event.type) {
          case "assistant_text": {
            const id = (botId ??= newId());
            setItems((current) =>
              current.some((item) => item.id === id)
                ? current.map((item) => (item.id === id && item.kind === "bot" ? { ...item, text: item.text + event.text } : item))
                : [...current, { id, kind: "bot", text: event.text }],
            );
            break;
          }
          case "job_started": {
            if (event.kind === "storyboard_sheet" && context.scenesItemId) {
              // `approved` shows the picture area, which also covers a storyboard approved by typing.
              patchItem(context.scenesItemId, (item) => (item.kind === "scenes" ? { ...item, approved: true, busy: true } : item));
            }
            setProgress((current) => current ?? { message: event.kind === "video" ? "Sedang membuat video…" : "Sedang membuat gambar…" });
            break;
          }
          case "job_progress":
            setProgress({ message: event.message, percent: event.percent });
            break;
          case "storyboard_scenes": {
            if (context.scenesItemId) {
              patchItem(context.scenesItemId, (item) =>
                item.kind === "scenes" ? { ...item, scenes: event.scenes, artDirection: event.artDirection ?? item.artDirection } : item,
              );
            } else {
              setItems((current) => [
                ...current,
                { id: newId(), kind: "scenes", sourceAssetId: event.sourceAssetId, scenes: event.scenes, artDirection: event.artDirection, approved: false },
              ]);
            }
            break;
          }
          case "asset_ready": {
            if (event.role === "studio_photo" && event.sourceAssetId) {
              const sourceAssetId = event.sourceAssetId;
              setItems((current) => [
                ...current,
                { id: newId(), kind: "studio", assetId: event.assetId, sourceAssetId, retry },
              ]);
            } else if (event.role === "video" && event.sourceAssetId) {
              const sourceAssetId = event.sourceAssetId;
              setItems((current) => [...current, { id: newId(), kind: "video", assetId: event.assetId, sourceAssetId }]);
            } else if (event.role === "storyboard_sheet" && context.scenesItemId) {
              patchItem(context.scenesItemId, (item) =>
                item.kind === "scenes" ? { ...item, sheet: event.assetId, madeFrom: item.scenes, busy: undefined } : item,
              );
            }
            break;
          }
          case "voice_over":
            // The narration belongs to the video that was just added.
            setItems((current) => {
              const index = current.findLastIndex((item) => item.kind === "video");
              return current.map((item, position) =>
                position === index && item.kind === "video"
                  ? { ...item, script: event.script, silentAssetId: event.silentAssetId, voice: event.voice, seconds: event.seconds }
                  : item,
              );
            });
            break;
          case "video_partial":
            videoStopped = true;
            setItems((current) => [
              ...current,
              {
                id: newId(),
                kind: "partial",
                seconds: event.seconds,
                clips: event.clips,
                finished: event.finished,
                failedIndex: event.failedIndex,
                voiceOver: event.voiceOver,
                sheet: typeof body.sheet === "string" ? body.sheet : "",
                directions: event.directions,
              },
            ]);
            break;
          case "confirmation_requested":
            setItems((current) => [...current, { id: newId(), kind: "confirm", message: event.message, estimatedUsd: event.estimatedUsd, retry }]);
            break;
          case "usage_updated":
            setUsage({ monthUsd: event.monthUsd });
            break;
          case "error":
            setItems((current) => [
              ...current,
              {
                id: newId(),
                kind: "error",
                message: event.message,
                code: event.code,
                retryable: event.retryable,
                retry: videoStopped ? undefined : retry,
              },
            ]);
            break;
          case "done":
            break;
        }
      };

      await sendChat(body, handle);

      // Whatever happened, nothing is left spinning.
      if (context.scenesItemId) {
        patchItem(context.scenesItemId, (item) => (item.kind === "scenes" ? { ...item, busy: undefined } : item));
      }
      setProgress(undefined);
      setBusy(false);
    },
    [patchItem, setItems],
  );

  function conversationBody(extra: Record<string, unknown>, lastMessage: { text: string; photoAssetId?: string }) {
    const history = itemsRef.current.flatMap((item): Array<{ role: "user" | "assistant"; text: string }> =>
      item.kind === "user"
        ? [{ role: "user" as const, text: item.text }]
        : item.kind === "bot"
          ? [{ role: "assistant" as const, text: item.text }]
          : [],
    );
    const messages: Array<{ role: "user" | "assistant"; text: string; photoAssetId?: string }> = [
      ...history.slice(-(HISTORY_LENGTH - 1)),
      { role: "user", ...lastMessage },
    ];
    const open = openStoryboard(itemsRef.current);
    // The storyboard may come from another chat, so a video chat can use a storyboard made elsewhere.
    const { sheet, scenes, artDirection } = storyboardFor(workspaceRef.current);
    return {
      messages,
      // The finished storyboard picture, so a typed "video 10 detik" can be made from it.
      sheet,
      scenes: sheet ? scenes : undefined,
      artDirection: sheet ? artDirection : undefined,
      // The video with a narration, so "ganti narasinya..." or "pakai suara cowok" can change it without new clips.
      revise: narratedVideo(itemsRef.current),
      // The newest result, or else the photo sent earlier, so "bikin foto studio" works on a later turn.
      lastImageAssetId: lastStudioAssetId(itemsRef.current) ?? lastPhotoAssetId(itemsRef.current),
      storyboard: open ? { photoAssetId: open.sourceAssetId, scenes: open.scenes, artDirection: open.artDirection } : undefined,
      ...extra,
    };
  }

  const submit = useCallback(() => {
    const message = text.trim();
    if (busy || (!message && !photo) || photo?.uploading) return;
    if (!inThread) flipFrom.current = cardRef.current?.getBoundingClientRect() ?? null;

    const body = conversationBody(
      { intent, style: styleOf(preset) },
      { text: message, photoAssetId: photo?.assetId },
    );
    // A new photo starts a new storyboard instead of editing the open one (the picture follows the photo it was planned from).
    if (photo) body.storyboard = undefined;
    setItems((current) => [...current, { id: newId(), kind: "user", text: message, photoAssetId: photo?.assetId }]);
    setText("");
    setPhoto(undefined);
    setIntent(undefined);
    // A typed message may approve the open storyboard, which makes its one picture.
    void run(body, { scenesItemId: body.storyboard ? openStoryboard(itemsRef.current)?.id : undefined });
  }, [text, photo, busy, inThread, intent, preset, run, setItems]);

  const attach = useCallback(async (file: File) => {
    setNote(undefined);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setNote("Format fotonya belum didukung. Pakai JPG, PNG, atau WebP ya.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setNote("Fotonya terlalu besar. Maksimal 10 MB ya.");
      return;
    }
    setPhoto({ previewUrl: URL.createObjectURL(file), uploading: true });
    const result = await uploadPhoto(file);
    if ("error" in result) {
      setPhoto(undefined);
      setNote(result.error);
    } else {
      setPhoto((current) => (current ? { ...current, assetId: result.assetId, uploading: false } : current));
    }
  }, []);

  const editScene = useCallback(
    (itemId: string, index: number, value: string) => {
      patchItem(itemId, (item) =>
        item.kind === "scenes" ? { ...item, scenes: item.scenes.map((scene, i) => (i === index ? value : scene)) } : item,
      );
    },
    [patchItem],
  );

  /** Makes the one picture of an approved storyboard, or makes it again. */
  const makeSheet = useCallback(
    (itemId: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId);
      if (busy || !item || item.kind !== "scenes" || item.scenes.some((scene) => !scene.trim())) return;
      patchItem(itemId, (current) => (current.kind === "scenes" ? { ...current, approved: true } : current));
      const body = {
        messages: [{ role: "user", text: APPROVE_TEXT }],
        storyboard: {
          photoAssetId: item.sourceAssetId,
          scenes: item.scenes.map((scene) => scene.trim()),
          artDirection: item.artDirection,
        },
        approve: {},
      };
      void run(body, { scenesItemId: itemId });
    },
    [busy, patchItem, run],
  );

  /** Makes the video of an approved storyboard from its picture, with the length and voice-over the seller chose. */
  const makeVideo = useCallback(
    (itemId: string, options: { seconds: number; voiceOver: boolean }) => {
      const card = itemsRef.current.find((candidate) => candidate.id === itemId);
      if (busy || !card || card.kind !== "scenes" || !card.sheet) return;
      void run(
        {
          messages: [{ role: "user", text: VIDEO_TEXT }],
          sheet: card.sheet,
          // The scenes let the narration be written from them when a voice-over is asked for.
          scenes: card.scenes,
          artDirection: card.artDirection,
          video: options,
        },
        {},
      );
    },
    [busy, run],
  );

  /** Resends the request that failed or produced an image, without adding a message to the thread. */
  const retryRequest = useCallback(
    (request: RetryRequest) => {
      if (busy) return;
      if (!request.approve) {
        // A retried scene replacement must patch the open storyboard, not add a second one.
        void run(request, { scenesItemId: request.storyboard ? openStoryboard(itemsRef.current)?.id : undefined });
        return;
      }
      // A storyboard retry makes its picture again.
      const scenes = itemsRef.current.findLast((item) => item.kind === "scenes");
      if (!scenes || scenes.kind !== "scenes") return;
      makeSheet(scenes.id);
    },
    [busy, run, makeSheet],
  );

  /** Remakes only the clips of a stopped video that are still missing; the finished ones are reused. */
  const resumeVideo = useCallback(
    (itemId: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId);
      if (busy || !item || item.kind !== "partial" || item.resumed) return;
      patchItem(itemId, (current) => (current.kind === "partial" ? { ...current, resumed: true } : current));
      void run(
        {
          messages: [{ role: "user", text: "Coba ulang bagian yang gagal." }],
          sheet: item.sheet,
          // The scenes let the script be written again when the first try asked for a voice-over.
          scenes: item.voiceOver ? storyboardFor(workspaceRef.current).scenes : undefined,
          artDirection: storyboardFor(workspaceRef.current).artDirection,
          resume: {
            seconds: item.seconds,
            clips: item.clips,
            finished: item.finished,
            voiceOver: item.voiceOver,
            directions: item.directions,
          },
        },
        {},
      );
    },
    [busy, patchItem, run],
  );

  /** The seller's answer to a price question: yes sends the same request again, now confirmed; no spends nothing. */
  const answerConfirmation = useCallback(
    (itemId: string, yes: boolean) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId);
      if (busy || !item || item.kind !== "confirm" || item.answer) return;
      patchItem(itemId, (current) => (current.kind === "confirm" ? { ...current, answer: yes ? "yes" : "no" } : current));
      // The yes is for this price: the server asks again if the same request would now cost more.
      if (yes) void run({ ...item.retry, confirmedUsd: item.estimatedUsd }, {});
    },
    [busy, patchItem, run],
  );

  function clearComposer() {
    setText("");
    setPhoto(undefined);
    setIntent(undefined);
    setNote(undefined);
  }

  /** Puts the cursor in the message box, so the seller can type right after picking a chat. Not on a touch screen, where it would raise the keyboard. */
  function focusComposer() {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    window.requestAnimationFrame(() => cardRef.current?.querySelector("textarea")?.focus());
  }

  // Not while a request runs: its answer is added to the chat that was on screen when it started.
  function newSession() {
    if (busy) return;
    setWorkspace(startSession);
    clearComposer();
    setHistoryOpen(false);
    focusComposer();
  }

  function removeSession(id: string) {
    if (busy) return;
    // The chat on screen changes when the one on screen is deleted, so what was typed for it goes too.
    if (id === workspaceRef.current.activeId) {
      clearComposer();
      focusComposer();
    }
    setWorkspace((current) => deleteSession(current, id));
  }

  /** A new chat with a feature already chosen, from the sidebar. */
  function startWithFeature(feature: ChatIntent) {
    if (busy) return;
    setWorkspace(startSession);
    clearComposer();
    setIntent(feature);
    setHistoryOpen(false);
    focusComposer();
  }

  /** Hides the sidebar on a wide screen, or slides the drawer in and out on a narrow one. */
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(WIDE_SCREEN).matches) setCollapsed((current) => !current);
    else setHistoryOpen((current) => !current);
  }, []);

  function openSession(id: string) {
    if (busy) return;
    setWorkspace((current) => selectSession(current, id));
    clearComposer();
    setHistoryOpen(false);
    focusComposer();
  }

  return (
    <div className={`chat${inThread ? " is-thread" : ""}${animating ? " anim" : ""}${collapsed ? " side-collapsed" : ""}`}>
      <div className="stage">
        <PaperBackground />
        <div className="frame">
          <Sidebar
            workspace={workspace}
            ready={ready}
            open={historyOpen}
            disabled={busy}
            usage={usage}
            links={
              <>
                <a {...info.link("fitur")}>Fitur</a>
                <a {...info.link("cara-kerja")}>Cara Kerja</a>
                <a {...info.link("kontak")}>Kontak</a>
              </>
            }
            onSelect={openSession}
            onNew={newSession}
            onFeature={startWithFeature}
            onDelete={removeSession}
            onToggle={toggleSidebar}
          />

          <div className="main">
            <header className="topbar">
              <div className="topbar-left">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Tampilkan menu samping"
                  aria-expanded={collapsed ? false : historyOpen}
                  onClick={toggleSidebar}
                >
                  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                    <rect x="2" y="3" width="14" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7 3.5v11" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </div>
              <div className="topbar-right">
                <button type="button" className="topbar-new" onClick={newSession} disabled={busy}>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Sesi baru
                </button>
                <Link href="/">Beranda</Link>
              </div>
            </header>

            <main className="hero">
              <h1 className="h1">Ubah foto produkmu jadi konten studio.</h1>
              {inThread && (
                <ThreadView
                  items={items}
                  progress={progress}
                  busy={busy}
                  onRetry={retryRequest}
                  onEditScene={editScene}
                  onMakeSheet={makeSheet}
                  onMakeVideo={makeVideo}
                  onAnswerConfirm={answerConfirmation}
                  onResumeVideo={resumeVideo}
                  photoUrl={(assetId) => assetUrl(assetId, "resized")}
                />
              )}
              <Composer
                ref={cardRef}
                text={text}
                onText={setText}
                photo={photo}
                onAttach={attach}
                onRemovePhoto={() => setPhoto(undefined)}
                intent={intent}
                onIntent={(next) => setIntent((current) => (current === next ? undefined : next))}
                preset={preset}
                onPreset={setPreset}
                menu={menu}
                onMenu={setMenu}
                note={note}
                busy={busy}
                onSubmit={submit}
                inThread={inThread}
                onSuggest={(suggestion) => {
                  setText(suggestion.text);
                  setIntent(suggestion.intent);
                  if (suggestion.preset) setPreset(suggestion.preset);
                }}
              />
            </main>
          </div>
        </div>
      </div>
      {info.dialog}
    </div>
  );
}
