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
  redrawRequest,
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
const HISTORY_LENGTH = 12;

const newId = () => crypto.randomUUID();

const BEFORE_LOAD: Workspace = { sessions: [{ id: "before-load", items: [] }], activeId: "before-load" };

interface Usage {
  monthUsd: number;
}

/** How the events of one request are folded into the thread. */
interface RunContext {
  /** Set when the request draws the picture of a storyboard that is already in the chat again, instead of starting a new one. */
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
      // The storyboard card this request draws the picture for: the one it was started from, or the one its scenes created.
      let cardId = context.scenesItemId;
      // Once the scenes are known, a picture that fails is retried from them, without planning them again.
      let redraw: RetryRequest | undefined;

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
            if (event.kind === "storyboard_sheet" && cardId) {
              patchItem(cardId, (item) => (item.kind === "scenes" ? { ...item, busy: true } : item));
            }
            setProgress((current) => current ?? { message: event.kind === "video" ? "Sedang membuat video…" : "Sedang membuat gambar…" });
            break;
          }
          case "job_progress":
            setProgress({ message: event.message, percent: event.percent });
            break;
          case "storyboard_scenes": {
            // Data for the video, not something to read: the card shows the picture once it is made.
            redraw = redrawRequest(event);
            if (cardId) {
              patchItem(cardId, (item) =>
                item.kind === "scenes" ? { ...item, scenes: event.scenes, artDirection: event.artDirection ?? item.artDirection, brief: event.brief ?? item.brief } : item,
              );
            } else {
              const id = (cardId = newId());
              setItems((current) => [
                ...current,
                { id, kind: "scenes", sourceAssetId: event.sourceAssetId, scenes: event.scenes, artDirection: event.artDirection, brief: event.brief },
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
            } else if (event.role === "storyboard_sheet" && cardId) {
              patchItem(cardId, (item) => (item.kind === "scenes" ? { ...item, sheet: event.assetId, busy: undefined } : item));
            }
            break;
          }
          case "voice_over":
            // The narration belongs to the video that was just added.
            setItems((current) => {
              const index = current.findLastIndex((item) => item.kind === "video");
              return current.map((item, position) =>
                position === index && item.kind === "video"
                  ? {
                      ...item,
                      script: event.script,
                      silentAssetId: event.silentAssetId,
                      voice: event.voice,
                      seconds: event.seconds,
                      lines: event.lines,
                    }
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
                narration: event.narration,
                voice: event.voice,
                grade: event.grade,
                music: event.music,
              },
            ]);
            break;
          case "confirmation_requested":
            setItems((current) => [
              ...current,
              { id: newId(), kind: "confirm", message: event.message, estimatedUsd: event.estimatedUsd, videoChoice: event.videoChoice, retry },
            ]);
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
                retry: videoStopped ? undefined : (redraw ?? retry),
              },
            ]);
            break;
          case "done":
            break;
        }
      };

      await sendChat(body, handle);

      // Whatever happened, nothing is left spinning.
      if (cardId) {
        patchItem(cardId, (item) => (item.kind === "scenes" ? { ...item, busy: undefined } : item));
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
    // The storyboard may come from another chat, so a video chat can use a storyboard made elsewhere.
    const { sheet, scenes, artDirection, brief } = storyboardFor(workspaceRef.current);
    return {
      messages,
      // The finished storyboard picture, so a typed "video 10 detik" can be made from it.
      sheet,
      scenes: sheet ? scenes : undefined,
      artDirection: sheet ? artDirection : undefined,
      brief: sheet ? brief : undefined,
      // The video with a narration, so "ganti narasinya..." or "pakai suara cowok" can change it without new clips.
      revise: narratedVideo(itemsRef.current),
      // The newest result, or else the photo sent earlier, so "bikin foto studio" works on a later turn.
      lastImageAssetId: lastStudioAssetId(itemsRef.current) ?? lastPhotoAssetId(itemsRef.current),
      ...extra,
    };
  }

  const submit = useCallback(() => {
    const message = text.trim();
    if (busy || (!message && !photo) || photo?.uploading) return;
    if (!inThread) flipFrom.current = cardRef.current?.getBoundingClientRect() ?? null;

    // In the Video feature the attached picture is the storyboard, so the one borrowed from another chat (and its scenes) is left out.
    const ownStoryboard = intent === "video" && photo?.assetId ? { sheet: undefined, scenes: undefined, artDirection: undefined, brief: undefined } : {};
    const body = conversationBody(
      { intent, style: styleOf(preset), ...ownStoryboard },
      { text: message, photoAssetId: photo?.assetId },
    );
    setItems((current) => [...current, { id: newId(), kind: "user", text: message, photoAssetId: photo?.assetId }]);
    setText("");
    setPhoto(undefined);
    setIntent(undefined);
    void run(body);
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

  /** Draws the picture of a storyboard again from its scenes, which are not planned again. */
  const redrawSheet = useCallback(
    (itemId: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId);
      if (busy || !item || item.kind !== "scenes") return;
      void run(redrawRequest(item), { scenesItemId: itemId });
    },
    [busy, run],
  );

  /** Resends the request that failed or produced an image, without adding a message to the thread. */
  const retryRequest = useCallback(
    (request: RetryRequest) => {
      if (busy) return;
      // A retried picture goes on the card of its storyboard, when that card is still in the chat, and not on a second one.
      const photo = (request.redraw as { photoAssetId?: string } | undefined)?.photoAssetId;
      const card = photo ? itemsRef.current.findLast((item) => item.kind === "scenes" && item.sourceAssetId === photo) : undefined;
      void run(request, { scenesItemId: card?.id });
    },
    [busy, run],
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
          // The scenes tell the server which storyboard this is.
          scenes: item.voiceOver ? storyboardFor(workspaceRef.current).scenes : undefined,
          artDirection: storyboardFor(workspaceRef.current).artDirection,
          resume: {
            seconds: item.seconds,
            clips: item.clips,
            finished: item.finished,
            voiceOver: item.voiceOver,
            directions: item.directions,
            narration: item.narration,
            voice: item.voice,
            grade: item.grade,
            music: item.music,
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
      // The yes is for this price and this plan: the plan comes back as it was shown, and the server asks again if it would cost more.
      if (yes) void run({ ...item.retry, confirmedUsd: item.estimatedUsd, videoChoice: item.videoChoice }, {});
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
                  onRedraw={redrawSheet}
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
