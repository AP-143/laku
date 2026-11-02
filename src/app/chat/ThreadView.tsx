"use client";

import { useEffect, useRef } from "react";
import { assetUrl } from "./chat-client";
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
  onMakeFrames: (itemId: string, sceneIndex?: number) => void;
  photoUrl: (assetId: string) => string;
}

const downloadUrl = (assetId: string) => `${assetUrl(assetId)}${assetUrl(assetId).includes("?") ? "&" : "?"}download=1`;

function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function ThreadView({ items, progress, busy, onRetry, onEditScene, onMakeFrames, photoUrl }: ThreadViewProps) {
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items, progress]);

  return (
    <section className="thread" aria-label="Percakapan" aria-live="polite">
      {items.map((item) => {
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

          case "scenes": {
            const framesStarted = item.approved;
            return (
              <div key={item.id} className="board">
                <h2>Storyboard 4 scene</h2>
                <ol>
                  {item.scenes.map((scene, index) => {
                    const frame = item.frames[index];
                    const working = item.busy?.includes(index);
                    return (
                      <li key={index} className="scene">
                        <label>
                          <span className="scene-num">Scene {index + 1}</span>
                          <textarea
                            value={scene}
                            rows={3}
                            maxLength={600}
                            readOnly={framesStarted && busy}
                            onChange={(event) => onEditScene(item.id, index, event.target.value)}
                          />
                        </label>
                        {framesStarted && (
                          <div className="frame-box">
                            {frame ? (
                              // eslint-disable-next-line @next/next/no-img-element -- served by our own asset endpoint
                              <img src={assetUrl(frame)} alt={`Frame scene ${index + 1}`} />
                            ) : working ? (
                              <Spinner label={`Membuat scene ${index + 1}`} />
                            ) : (
                              <span className="frame-empty">Belum dibuat</span>
                            )}
                          </div>
                        )}
                        {framesStarted && !working && (
                          <div className="actions">
                            <button type="button" className="btn" disabled={busy} onClick={() => onMakeFrames(item.id, index)}>
                              {frame ? "Coba lagi" : "Buat gambar"}
                            </button>
                            {frame && (
                              <a className="btn btn-primary" href={downloadUrl(frame)} download>
                                Unduh
                              </a>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {!framesStarted && (
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onMakeFrames(item.id)}>
                      Setujui &amp; buat gambar
                    </button>
                    <span className="hint">Gambar baru dibuat setelah kamu setujui.</span>
                  </div>
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
