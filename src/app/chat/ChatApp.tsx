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
  loadWorkspace,
  saveWorkspace,
  selectSession,
  setActiveItems,
  startSession,
  storyboardFor,
  type Workspace,
} from "./saved-conversation";
import { SessionList } from "./SessionList";
import { ThreadView, type Progress } from "./ThreadView";
import { SCENE_INDEXES } from "../../shared/storyboard";
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
const APPROVE_TEXT = "Setuju, buatkan gambarnya ya.";
const HISTORY_LENGTH = 12;

const newId = () => crypto.randomUUID();

const BEFORE_LOAD: Workspace = { sessions: [{ id: "before-load", items: [] }], activeId: "before-load" };

interface Usage {
  monthUsd: number;
  budgetUsd: number;
}

/** How the events of one request are folded into the thread. */
interface RunContext {
  /** Set when the request continues an open storyboard instead of starting a new one. */
  scenesItemId?: string;
  /** For a storyboard approval: which scenes get a frame, in order. */
  frameIndexes: number[];
}

function formatUsd(value: number): string {
  return `US$${value.toFixed(2).replace(".", ",")}`;
}

export default function ChatApp() {
  // Every saved chat. Until the browser's storage is read there is just one empty placeholder session (no random id during prerender).
  const [workspace, setWorkspace] = useState<Workspace>(BEFORE_LOAD);
  const [ready, setReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  useEffect(() => {
    if (ready) saveWorkspace(browserStorage(), workspace);
  }, [workspace, ready]);

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
    async (body: Record<string, unknown>, context: RunContext = { frameIndexes: [] }) => {
      setBusy(true);
      setNote(undefined);
      let botId: string | undefined;
      let framesStarted = 0;
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
            if (event.kind === "storyboard_frame" && context.scenesItemId) {
              const sceneIndex = context.frameIndexes[framesStarted++];
              // `approved` shows the frame area, which also covers a storyboard approved by typing.
              patchItem(context.scenesItemId, (item) =>
                item.kind === "scenes" ? { ...item, approved: true, busy: [...(item.busy ?? []), sceneIndex] } : item,
              );
            }
            setProgress((current) => current ?? { message: event.kind === "video" ? "Sedang membuat video…" : "Sedang membuat gambar…" });
            break;
          }
          case "job_progress":
            setProgress({ message: event.message, percent: event.percent });
            break;
          case "storyboard_scenes": {
            if (context.scenesItemId) {
              patchItem(context.scenesItemId, (item) => (item.kind === "scenes" ? { ...item, scenes: event.scenes } : item));
            } else {
              setItems((current) => [
                ...current,
                { id: newId(), kind: "scenes", sourceAssetId: event.sourceAssetId, scenes: event.scenes, frames: {}, approved: false },
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
            } else if (event.role === "storyboard_frame" && context.scenesItemId && event.sceneIndex !== undefined) {
              const sceneIndex = event.sceneIndex;
              patchItem(context.scenesItemId, (item) =>
                item.kind === "scenes"
                  ? {
                      ...item,
                      frames: { ...item.frames, [sceneIndex]: event.assetId },
                      busy: (item.busy ?? []).filter((index) => index !== sceneIndex),
                    }
                  : item,
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
                frames: Array.isArray(body.frames) ? (body.frames as string[]) : [],
              },
            ]);
            break;
          case "confirmation_requested":
            setItems((current) => [...current, { id: newId(), kind: "confirm", message: event.message, estimatedUsd: event.estimatedUsd, retry }]);
            break;
          case "usage_updated":
            setUsage({ monthUsd: event.monthUsd, budgetUsd: event.budgetUsd });
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
    const { frames, scenes } = storyboardFor(workspaceRef.current);
    return {
      messages,
      // The finished storyboard frames, so a typed "video 10 detik" can be made from them.
      frames: frames.length > 0 ? frames : undefined,
      scenes: frames.length > 0 ? scenes : undefined,
      // The video with a narration, so "ganti narasinya..." or "pakai suara cowok" can change it without new clips.
      revise: narratedVideo(itemsRef.current),
      // The newest result, or else the photo sent earlier, so "bikin foto studio" works on a later turn.
      lastImageAssetId: lastStudioAssetId(itemsRef.current) ?? lastPhotoAssetId(itemsRef.current),
      storyboard: open ? { photoAssetId: open.sourceAssetId, scenes: open.scenes } : undefined,
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
    // A new photo starts a new storyboard instead of editing the open one (frames follow the photo they were planned from).
    if (photo) body.storyboard = undefined;
    setItems((current) => [...current, { id: newId(), kind: "user", text: message, photoAssetId: photo?.assetId }]);
    setText("");
    setPhoto(undefined);
    setIntent(undefined);
    // A typed message may approve the open storyboard, which makes all four frames in order.
    void run(body, {
      scenesItemId: body.storyboard ? openStoryboard(itemsRef.current)?.id : undefined,
      frameIndexes: [...SCENE_INDEXES],
    });
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

  /** Generates frames for an approved storyboard: all four, or just the one asked for. */
  const makeFrames = useCallback(
    (itemId: string, sceneIndex?: number) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId);
      if (busy || !item || item.kind !== "scenes" || item.scenes.some((scene) => !scene.trim())) return;
      patchItem(itemId, (current) => (current.kind === "scenes" ? { ...current, approved: true } : current));
      const body = {
        messages: [{ role: "user", text: sceneIndex === undefined ? APPROVE_TEXT : `Buat ulang scene ${sceneIndex + 1}.` }],
        storyboard: { photoAssetId: item.sourceAssetId, scenes: item.scenes.map((scene) => scene.trim()) },
        approve: sceneIndex === undefined ? {} : { sceneIndex },
      };
      void run(body, { scenesItemId: itemId, frameIndexes: sceneIndex === undefined ? [...SCENE_INDEXES] : [sceneIndex] });
    },
    [busy, patchItem, run],
  );

  /** Resends the request that failed or produced an image, without adding a message to the thread. */
  const retryRequest = useCallback(
    (request: RetryRequest) => {
      if (busy) return;
      const approve = request.approve as { sceneIndex?: number } | undefined;
      if (!approve) {
        // A retried scene replacement must patch the open storyboard, not add a second one.
        void run(request, { scenesItemId: request.storyboard ? openStoryboard(itemsRef.current)?.id : undefined, frameIndexes: [] });
        return;
      }
      // A storyboard retry picks up where it stopped: only the first frame that is still missing.
      const scenes = itemsRef.current.findLast((item) => item.kind === "scenes");
      if (!scenes || scenes.kind !== "scenes") return;
      const firstMissing = SCENE_INDEXES.find((index) => !scenes.frames[index]);
      const anyDone = Object.keys(scenes.frames).length > 0;
      makeFrames(scenes.id, approve.sceneIndex ?? (anyDone ? firstMissing : undefined));
    },
    [busy, run, makeFrames],
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
          frames: item.frames,
          // The scenes let the script be written again when the first try asked for a voice-over.
          scenes: item.voiceOver ? storyboardFor(workspaceRef.current).scenes : undefined,
          resume: { seconds: item.seconds, clips: item.clips, finished: item.finished, voiceOver: item.voiceOver },
        },
        { frameIndexes: [] },
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
      if (yes) void run({ ...item.retry, confirmedUsd: item.estimatedUsd }, { frameIndexes: [] });
    },
    [busy, patchItem, run],
  );

  function clearComposer() {
    setText("");
    setPhoto(undefined);
    setIntent(undefined);
    setNote(undefined);
  }

  // Not while a request runs: its answer is added to the chat that was on screen when it started.
  function newSession() {
    if (busy) return;
    setWorkspace(startSession);
    clearComposer();
    setHistoryOpen(false);
  }

  function openSession(id: string) {
    if (busy) return;
    setWorkspace((current) => selectSession(current, id));
    clearComposer();
    setHistoryOpen(false);
  }

  return (
    <div className={`chat${inThread ? " is-thread" : ""}${animating ? " anim" : ""}`}>
      <div className="stage">
        <PaperBackground />
        <div className="frame">
          <header className="nav">
            <nav className="links" aria-label="Menu utama">
              <Link href="/">Beranda</Link>
              <a {...info.link("fitur")}>Fitur</a>
              <a {...info.link("cara-kerja")}>Cara Kerja</a>
              <a {...info.link("kontak")}>Kontak</a>
            </nav>
            <div className="nav-actions">
              <button
                type="button"
                className="history-toggle"
                onClick={() => setHistoryOpen((open) => !open)}
                aria-expanded={historyOpen}
              >
                Riwayat
              </button>
              <button type="button" className="new-chat" onClick={newSession} disabled={busy || !inThread}>
                Sesi Baru
              </button>
            </div>
          </header>

          {ready && (
            <SessionList
              workspace={workspace}
              open={historyOpen}
              disabled={busy}
              onSelect={openSession}
              onNew={newSession}
              onClose={() => setHistoryOpen(false)}
            />
          )}

          <main className="hero">
            <h1 className="h1">Ubah foto produkmu jadi konten studio.</h1>
            {inThread && (
              <ThreadView
                items={items}
                progress={progress}
                busy={busy}
                onRetry={retryRequest}
                onEditScene={editScene}
                onMakeFrames={makeFrames}
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

          <footer className="foot">
            <p>Dibuat untuk penjual online Indonesia — foto studio dan storyboard iklan dari satu foto produk.</p>
            <div className="foot-row">
              <span className="rule" />
              {usage && (
                <span className="usage" title="Perkiraan pemakaian saldo bulan ini">
                  Pemakaian bulan ini: {formatUsd(usage.monthUsd)} / {formatUsd(usage.budgetUsd)}
                </span>
              )}
            </div>
          </footer>
        </div>
      </div>
      {info.dialog}
    </div>
  );
}
