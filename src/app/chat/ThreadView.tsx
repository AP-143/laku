"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PANEL_TITLES } from "../../shared/storyboard";
import { VIDEO_LENGTH_CHOICES } from "../../shared/video-plan";
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
  onEditScene: (itemId: string, index: number, value: string) => void;
  /** The approve button, and the retry button of the storyboard picture. */
  onMakeSheet: (itemId: string) => void;
  /** The "Generate" button of the video panel under an approved storyboard. */
  onMakeVideo: (itemId: string, options: { seconds: number; voiceOver: boolean; music: boolean }) => void;
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
 * What the seller picks before the video of an approved storyboard is made. Once a video exists, the panel folds into
 * one button, so a second video is a deliberate choice and not a stray click.
 */
function VideoPanel({
  busy,
  hasVideo,
  onMake,
}: {
  busy: boolean;
  hasVideo: boolean;
  onMake: (options: { seconds: number; voiceOver: boolean; music: boolean }) => void;
}) {
  const [seconds, setSeconds] = useState<(typeof VIDEO_LENGTH_CHOICES)[number]>(VIDEO_LENGTH_CHOICES[0]);
  const [voiceOver, setVoiceOver] = useState(false);
  const [music, setMusic] = useState(true);
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
      <div className="video-field">
        <span className="video-field-label" id="video-length-label">
          Durasi video
        </span>
        <div className="video-lengths" role="group" aria-labelledby="video-length-label">
          {VIDEO_LENGTH_CHOICES.map((length) => (
            <button
              key={length}
              type="button"
              className={`video-length${seconds === length ? " is-on" : ""}`}
              aria-pressed={seconds === length}
              disabled={busy}
              onClick={() => setSeconds(length)}
            >
              {length} detik
            </button>
          ))}
        </div>
      </div>
      <label className="video-voice">
        <input type="checkbox" checked={voiceOver} disabled={busy} onChange={(event) => setVoiceOver(event.target.checked)} />
        Tambahkan suara (AI memilih: orang bicara atau narasi)
      </label>
      <label className="video-voice">
        <input type="checkbox" checked={music} disabled={busy} onChange={(event) => setMusic(event.target.checked)} />
        Tambahkan musik latar (AI memilih yang cocok, +US$0,04)
      </label>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-ai" disabled={busy} onClick={() => {
            setExpanded(false);
            onMake({ seconds, voiceOver, music });
          }}>
          <SparkleIcon />
          Generate
        </button>
      </div>
    </section>
  );
}

/** The text of one scene. The box grows with its text, so a long scene is never cut off behind a scrollbar. */
function SceneText({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange: (value: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => fit(), [value, fit]);

  // A narrower or wider column wraps the text differently, so the height is worked out again.
  useEffect(() => {
    const column = field.current?.parentElement;
    if (!column) return;
    const observer = new ResizeObserver(fit);
    observer.observe(column);
    return () => observer.disconnect();
  }, [fit]);

  return <textarea ref={field} value={value} rows={2} maxLength={600} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />;
}

export function ThreadView({
  items,
  progress,
  busy,
  onRetry,
  onEditScene,
  onMakeSheet,
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

          case "scenes": {
            const approved = item.approved;
            const changed = Boolean(item.sheet) && item.madeFrom !== undefined && item.scenes.some((scene, index) => item.madeFrom![index]?.trim() !== scene.trim());
            return (
              <div key={item.id} className="board">
                <h2>
                  Storyboard {item.scenes.length} panel
                  {approved && <span className="board-badge">Disetujui</span>}
                </h2>
                <ol>
                  {item.scenes.map((scene, index) => (
                    <li key={index} className="scene">
                      <label>
                        <span className="scene-num">
                          {index + 1}. {PANEL_TITLES[index]}
                        </span>
                        <SceneText
                          value={scene}
                          readOnly={approved && busy}
                          onChange={(value) => onEditScene(item.id, index, value)}
                        />
                      </label>
                    </li>
                  ))}
                </ol>
                {approved && (
                  <div className="sheet-box">
                    {item.sheet ? (
                      // eslint-disable-next-line @next/next/no-img-element -- served by our own asset endpoint
                      <img src={assetUrl(item.sheet)} alt="Gambar storyboard dengan semua panel" />
                    ) : item.busy ? (
                      <Spinner label="Membuat gambar storyboard" />
                    ) : (
                      <span className="frame-empty">Belum dibuat</span>
                    )}
                  </div>
                )}
                {changed && <p className="scene-note">Teks diubah. Tekan “Coba lagi” untuk memperbarui gambar.</p>}
                {approved && !item.busy && (
                  <div className="actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => onMakeSheet(item.id)}>
                      {item.sheet ? "Coba lagi" : "Buat gambar"}
                    </button>
                    {item.sheet && (
                      <a className="btn btn-primary" href={downloadUrl(item.sheet)} download>
                        Unduh
                      </a>
                    )}
                  </div>
                )}
                {!approved && (
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onMakeSheet(item.id)}>
                      Setujui &amp; buat gambar
                    </button>
                  </div>
                )}
                {/* The approve button is gone once the picture is made: the next step is the video. */}
                {approved && !busy && item.sheet && (
                  <VideoPanel
                    busy={busy}
                    hasVideo={items.slice(position + 1).some((later) => later.kind === "video")}
                    onMake={(options) => onMakeVideo(item.id, options)}
                  />
                )}
              </div>
            );
          }

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
