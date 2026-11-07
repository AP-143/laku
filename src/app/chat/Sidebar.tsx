"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ChatIntent } from "../../shared/chat-events";
import { describeSession, type Workspace } from "./saved-conversation";

const FEATURES: Array<{ intent: ChatIntent; label: string; hint: string; icon: ReactNode }> = [
  {
    intent: "studio_photo",
    label: "Foto Studio",
    hint: "Foto produk jadi rapi",
    icon: (
      <svg viewBox="0 0 16 14" width="15" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5.2 0 4.1 1.6H2.4A2.4 2.4 0 0 0 0 4v7.6A2.4 2.4 0 0 0 2.4 14h11.2a2.4 2.4 0 0 0 2.4-2.4V4a2.4 2.4 0 0 0-2.4-2.4h-1.7L10.8 0H5.2ZM8 3.9a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z"
        />
      </svg>
    ),
  },
  {
    intent: "storyboard",
    label: "Storyboard",
    hint: "Panel iklan dalam satu gambar",
    icon: (
      <svg viewBox="0 0 14 14" width="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M1.8 0h4.4c1 0 1.8.8 1.8 1.8v4.4c0 1-.8 1.8-1.8 1.8H1.8C.8 8 0 7.2 0 6.2V1.8C0 .8.8 0 1.8 0Zm6.2 8h4.2c1 0 1.8.8 1.8 1.8v2.4c0 1-.8 1.8-1.8 1.8H8c-1 0-1.8-.8-1.8-1.8V9.8C6.2 8.8 7 8 8 8Zm-6.2 1h2.6c.9 0 1.6.7 1.6 1.6v1.8c0 .9-.7 1.6-1.6 1.6H1.8C.9 14 .2 13.3.2 12.4v-1.8C.2 9.7.9 9 1.8 9ZM9 0h3.2C13.2 0 14 .8 14 1.8v3c0 1-.8 1.8-1.8 1.8H9c-1 0-1.8-.8-1.8-1.8v-3C7.2.8 8 0 9 0Z"
        />
      </svg>
    ),
  },
  {
    intent: "video",
    label: "Video",
    hint: "Dari gambar storyboard",
    icon: (
      <svg viewBox="0 0 14 14" width="14" aria-hidden="true">
        <path fill="currentColor" d="M1.8 1.5h6.4c.7 0 1.3.6 1.3 1.3v8.4c0 .7-.6 1.3-1.3 1.3H1.8c-.7 0-1.3-.6-1.3-1.3V2.8c0-.7.6-1.3 1.3-1.3Zm8.7 3.2 3-1.9v8.4l-3-1.9V4.7Z" />
      </svg>
    ),
  },
];

const FEATURE_LABELS: Record<ChatIntent, string> = {
  studio_photo: "Foto Studio",
  storyboard: "Storyboard",
  video: "Video",
};

interface Props {
  workspace: Workspace;
  /** False until the saved chats are read, so the list does not flash an empty chat. */
  ready: boolean;
  /** On narrow screens the sidebar is a drawer; this says whether it is slid in. */
  open: boolean;
  /** Starting, switching and deleting chats wait while a request is running. */
  disabled: boolean;
  /** Info links (features, how it works, contact) shown at the bottom. */
  links: ReactNode;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** A new chat that starts with one of the features already chosen. */
  onFeature: (intent: ChatIntent) => void;
  onDelete: (id: string) => void;
  /** Hides the sidebar on a wide screen, or closes the drawer on a narrow one. */
  onToggle: () => void;
}

/** The app sidebar: brand, new chat, the three features, and every saved chat (newest first). */
export function Sidebar({ workspace, ready, open, disabled, links, onSelect, onNew, onFeature, onDelete, onToggle }: Props) {
  // The chat the seller is being asked about; deleting takes a second click so it cannot happen by accident.
  const [confirming, setConfirming] = useState<string | undefined>();

  // Esc backs out of a delete question first, then closes the drawer.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (confirming) setConfirming(undefined);
      else if (open) onToggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, open, onToggle]);

  // A request that starts while a question is open makes the delete unavailable, so the question goes away.
  const asking = disabled ? undefined : confirming;

  return (
    <>
      {open && <button type="button" className="side-scrim" aria-label="Tutup menu samping" onClick={onToggle} />}
      <aside className={`side${open ? " is-open" : ""}`} aria-label="Menu samping">
        <div className="side-head">
          <Link href="/" className="brand" aria-label="LAKU, ke beranda">
            LAKU
          </Link>
          <button type="button" className="icon-btn" aria-label="Sembunyikan menu samping" onClick={onToggle}>
            <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
              <rect x="2" y="3" width="14" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 3.5v11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <button type="button" className="side-new" onClick={onNew} disabled={disabled}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Sesi baru
        </button>
        {disabled && <p className="side-hint">Tunggu proses selesai.</p>}

        <h3 className="side-label">Mulai dari</h3>
        <nav className="side-features" aria-label="Mulai dari fitur">
          {FEATURES.map((feature) => (
            <button
              key={feature.intent}
              type="button"
              className={`side-feature f-${feature.intent}`}
              disabled={disabled}
              onClick={() => onFeature(feature.intent)}
            >
              <span className="side-feature-icon">{feature.icon}</span>
              <span className="side-feature-text">
                <strong>{feature.label}</strong>
                <small>{feature.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <h3 className="side-label">Riwayat{ready ? ` · ${workspace.sessions.length}` : ""}</h3>
        <ul className="side-list">
          {ready &&
            workspace.sessions.map((session) => {
              const { title, feature } = describeSession(session);
              const current = session.id === workspace.activeId;
              if (asking === session.id) {
                return (
                  <li key={session.id} className="session-ask" role="group" aria-label={`Hapus chat ${title}`}>
                    <p>Hapus chat ini? Isinya tidak bisa dikembalikan.</p>
                    <div className="session-ask-actions">
                      <button type="button" className="session-cancel" autoFocus onClick={() => setConfirming(undefined)}>
                        Batal
                      </button>
                      <button
                        type="button"
                        className="session-danger"
                        onClick={() => {
                          setConfirming(undefined);
                          onDelete(session.id);
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={session.id} className="session-row">
                  <button
                    type="button"
                    className={`session${current ? " is-current" : ""}`}
                    aria-current={current ? "true" : undefined}
                    disabled={disabled && !current}
                    onClick={() => onSelect(session.id)}
                  >
                    <span className="session-title">{title}</span>
                    {feature && <span className={`session-feature f-${feature}`}>{FEATURE_LABELS[feature]}</span>}
                    {session.items.length === 0 && <span className="session-blank">Belum ada pesan</span>}
                  </button>
                  <button
                    type="button"
                    className="session-delete"
                    aria-label={`Hapus chat: ${title}`}
                    title="Hapus chat ini"
                    disabled={disabled}
                    onClick={() => setConfirming(session.id)}
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path
                        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M7 7v3.5M9 7v3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
        </ul>

        <div className="side-foot">
          <div className="side-links">{links}</div>
        </div>
      </aside>
    </>
  );
}
