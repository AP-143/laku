"use client";

import { useEffect, useRef, useState } from "react";
import { assetUrl, downloadUrl } from "./chat-client";
import type { RetryRequest, ThreadItem } from "./thread";

export interface Progress {
  message: string;
  percent?: number;
}

interface ThreadViewProps {
  items: ThreadItem[];
  progress?: Progress;
  busy: boolean;
  onRetry: (request: RetryRequest) => void;
  /** The retry button of the storyboard picture, which draws it again from the same scenes. */
  onRedraw: (itemId: string) => void;
  /** The "Generate" button of the video panel under a storyboard picture. */
  onMakeVideo: (itemId: string) => void;
  onAnswerConfirm: (itemId: string, yes: boolean) => void;
  onResumeVideo: (itemId: string) => void;
  photoUrl: (assetId: string) => string;
}

function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

/** The AI sparkle shown on the buttons that generate something. */
function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 2.5c.3 0 .6.2.7.5l1.3 4.4a6 6 0 0 0 4.1 4.1l4.4 1.3a.75.75 0 0 1 0 1.4l-4.4 1.3a6 6 0 0 0-4.1 4.1l-1.3 4.4a.75.75 0 0 1-1.4 0l-1.3-4.4a6 6 0 0 0-4.1-4.1L2.5 14.2a.75.75 0 0 1 0-1.4l4.4-1.3a6 6 0 0 0 4.1-4.1L9.3 3c.1-.3.4-.5.7-.5Zm9.5-1c.3 0 .5.2.6.4l.5 1.6c.2.6.6 1 1.2 1.2l1.6.5a.65.65 0 0 1 0 1.2l-1.6.5c-.6.2-1 .6-1.2 1.2l-.5 1.6a.65.65 0 0 1-1.2 0l-.5-1.6a1.8 1.8 0 0 0-1.2-1.2l-1.6-.5a.65.65 0 0 1 0-1.2l1.6-.5c.6-.2 1-.6 1.2-1.2l.5-1.6c.1-.2.3-.4.6-.4Z"
      />
    </svg>
  );
}

/**
 * The "Generate" button of a storyboard picture, with no options: the AI decides the length, the voice-over and the music.
 * Once a video exists, the panel folds into one button, so a second video is a deliberate choice and not a stray click.
 */
function VideoPanel({
  busy,
  hasVideo,
  onMake,
}: {
  busy: boolean;
  hasVideo: boolean;
  onMake: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (hasVideo && !expanded) {
    return (
      <div className="video-again">
        <button type="button" className="btn btn-ai" disabled={busy} onClick={() => setExpanded(true)}>
          <SparkleIcon />
          Buat versi video lain
        </button>
      </div>
    );
  }

  return (
    <section className="video-panel" aria-label="Buat video iklan">
      <h3>Buat video iklan</h3>
      <p className="video-note">AI yang menentukan durasi, suara, dan musiknya dari storyboard. Kamu tinggal setuju dengan harganya.</p>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-ai" disabled={busy} onClick={() => {
            setExpanded(false);
            onMake();
          }}>
          <SparkleIcon />
          Generate
        </button>
      </div>
    </section>
  );
}

export function ThreadView({
  items,
  progress,
  busy,
  onRetry,
  onRedraw,
  onMakeVideo,
  onAnswerConfirm,
  onResumeVideo,
  photoUrl,
}: ThreadViewProps) {
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items, progress]);

  return (
    <section className="thread" aria-label="Percakapan" aria-live="polite">
      {items.map((item, position) => {
        switch (item.kind) {
          case "user":
            return (
              <div key={item.id} className="msg msg-user">
                {item.photoAssetId && (
                  // eslint-disable-next-line @next/next/no-img-element -- served by our own asset endpoint
                  <img className="msg-photo" src={photoUrl(item.photoAssetId)} alt="Foto produk yang kamu kirim" />
                )}
                {item.text && <p>{item.text}</p>}
              </div>
            );

          case "bot":
            return (
              <div key={item.id} className="msg msg-bot">
                <p>{item.text}</p>
              </div>
            );

          case "studio":
            return (
              <figure key={item.id} className="result">
                <div className="pair">
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by our own asset endpoint */}
                    <img src={photoUrl(item.sourceAssetId)} alt="Foto asli" />
                    <figcaption>Foto asli</figcaption>
                  </div>
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by our own asset endpoint */}
                    <img src={assetUrl(item.assetId)} alt="Foto studio hasil LAKU" />
                    <figcaption>Foto studio</figcaption>
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => onRetry(item.retry)}>
                    Coba lagi
                  </button>
                  <a className="btn btn-primary" href={downloadUrl(item.assetId)} download>
                    Unduh
                  </a>
                </div>
              </figure>
            );

          case "partial": {
            return (
              <div key={item.id} className="msg msg-bot">
                <p>Sebagian video belum selesai dibuat. Bagian yang sudah jadi tersimpan, jadi hanya sisanya yang dibuat ulang.</p>
                {!item.resumed && (
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onResumeVideo(item.id)}>
                      Coba ulang bagian ini
                    </button>
                  </div>
                )}
              </div>
            );
          }

          case "confirm":
            return (
              <div key={item.id} className="msg msg-bot">
                <p>{item.message}</p>
                {/* A yes needs no note: the video's progress follows. Only a no is worth saying aloud. */}
                {item.answer === "no" && <span className="hint">Dibatalkan, tidak ada biaya.</span>}
                {!item.answer && (
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAnswerConfirm(item.id, true)}>
                      Lanjut
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => onAnswerConfirm(item.id, false)}>
                      Batal
                    </button>
                  </div>
                )}
              </div>
            );

          case "video":
            return (
              <figure key={item.id} className="result result-video">
                <video className="video-player" src={assetUrl(item.assetId)} controls playsInline preload="metadata" aria-label="Video iklan hasil LAKU" />
                {item.script && (
                  <p className="script">
                    <strong>Naskah voice over:</strong> {item.script.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
                  </p>
                )}
                <div className="actions">
                  <a className="btn btn-primary" href={downloadUrl(item.assetId)} download>
                    Unduh
                  </a>
                </div>
              </figure>
            );

          case "scenes":
            // The scenes are data for the video and are not shown: the card is the picture made from them.
            // A card without a picture and not being drawn has nothing to show; its error message has the retry.
            if (!item.sheet && !item.busy) return null;
            return (
              <div key={item.id} className="board">
                <h2>Storyboard {item.scenes.length} panel</h2>
                <div className="sheet-box">
                  {item.sheet ? (
                    // eslint-disable-next-line @next/next/no-img-element -- served by our own asset endpoint
                    <img src={assetUrl(item.sheet)} alt="Gambar storyboard dengan semua panel" />
                  ) : (
                    <Spinner label="Membuat gambar storyboard" />
                  )}
                </div>
                {item.sheet && !item.busy && (
                  <div className="actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => onRedraw(item.id)}>
                      Coba lagi
                    </button>
                    <a className="btn btn-primary" href={downloadUrl(item.sheet)} download>
                      Unduh
                    </a>
                  </div>
                )}
                {/* The next step once the picture is made: the video. */}
                {item.sheet && !item.busy && (
                  <VideoPanel
                    busy={busy}
                    hasVideo={items.slice(position + 1).some((later) => later.kind === "video")}
                    onMake={() => onMakeVideo(item.id)}
                  />
                )}
              </div>
            );

          case "error":
            return (
              <div key={item.id} className="msg msg-error" role="alert">
                <p>{item.message}</p>
                {item.retryable && item.retry && (
                  <button type="button" className="btn" disabled={busy} onClick={() => onRetry(item.retry!)}>
                    Coba lagi
                  </button>
                )}
              </div>
            );
        }
      })}

      {busy && (
        <div className="msg msg-bot msg-progress">
          <Spinner label="Sedang bekerja" />
          <p>{progress?.message ?? "Sebentar ya…"}</p>
        </div>
      )}
      <div ref={end} />
    </section>
  );
}
