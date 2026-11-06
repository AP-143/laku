"use client";

import { useRef, type Ref } from "react";
import type { ChatIntent } from "../../shared/chat-events";
import { PRESET_LABELS, type Preset } from "./thread";

export interface AttachedPhoto {
  /** A local preview, shown while the upload runs and until the message is sent. */
  previewUrl: string;
  assetId?: string;
  uploading: boolean;
}

/** Ready-made requests shown under the empty composer, so a new seller sees what to ask for. */
const SUGGESTIONS: Array<{ label: string; text: string; intent: ChatIntent; preset?: Preset }> = [
  { label: "Foto studio latar putih", text: "Bikinin foto studio dengan latar putih bersih", intent: "studio_photo", preset: "clean_white" },
  { label: "Foto lifestyle meja kayu", text: "Bikinin foto lifestyle di atas meja kayu dengan cahaya pagi", intent: "studio_photo", preset: "lifestyle" },
  { label: "Storyboard untuk Reels", text: "Bikinin storyboard untuk Reels", intent: "storyboard" },
];

interface ComposerProps {
  onSuggest: (suggestion: { text: string; intent: ChatIntent; preset?: Preset }) => void;
  /** The card, so the page can animate it when the hero turns into a thread. */
  ref?: Ref<HTMLFormElement>;
  text: string;
  onText: (text: string) => void;
  photo?: AttachedPhoto;
  onAttach: (file: File) => void;
  onRemovePhoto: () => void;
  intent?: ChatIntent;
  onIntent: (intent: ChatIntent) => void;
  preset?: Preset;
  onPreset: (preset: Preset | undefined) => void;
  menu: boolean;
  onMenu: (open: boolean) => void;
  note?: string;
  busy: boolean;
  onSubmit: () => void;
  inThread: boolean;
}

const CHIPS: Array<{ intent: ChatIntent; label: string; style: Record<string, number>; icon: React.ReactNode }> = [
  {
    intent: "studio_photo",
    label: "Foto Studio",
    style: { "--cw": 104, "--pl": 12, "--ig": 4.2 },
    icon: (
      <svg viewBox="0 0 16 14" width="1em" aria-hidden="true" style={{ width: "calc(14*var(--u))" }}>
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
    style: { "--cw": 108, "--pl": 14, "--ig": 4 },
    icon: (
      <svg viewBox="0 0 14 14" aria-hidden="true" style={{ width: "calc(11.8*var(--u))" }}>
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
    style: { "--cw": 84, "--pl": 14, "--ig": 4 },
    icon: (
      <svg viewBox="0 0 14 14" aria-hidden="true" style={{ width: "calc(11.8*var(--u))" }}>
        <path fill="currentColor" d="M1.8 1.5h6.4c.7 0 1.3.6 1.3 1.3v8.4c0 .7-.6 1.3-1.3 1.3H1.8c-.7 0-1.3-.6-1.3-1.3V2.8c0-.7.6-1.3 1.3-1.3Zm8.7 3.2 3-1.9v8.4l-3-1.9V4.7Z" />
      </svg>
    ),
  },
];

const PRESET_SHORT: Record<Preset, string> = { clean_white: "Putih bersih", solid_color: "Backdrop", lifestyle: "Lifestyle" };

export function Composer({ ref, ...props }: ComposerProps) {
  const { photo, intent, preset, menu, busy } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = !busy && !photo?.uploading && (props.text.trim() !== "" || Boolean(photo?.assetId));

  const placeholder =
    intent === "storyboard"
      ? "Lampirkan foto produk, lalu ceritakan ide iklannya (boleh dikosongkan)…"
      : intent === "studio_photo"
        ? "Lampirkan foto produk, lalu ceritakan gaya fotonya (boleh dikosongkan)…"
        : intent === "video"
          ? "Lampirkan gambar storyboard, lalu ceritakan videonya, misalnya “video 20 detik pakai voice over” (boleh dikosongkan)…"
          : "Lampirkan foto produkmu, lalu ceritakan mau dibuat apa, misalnya “bikinin foto studio background putih”…";

  return (
    <div className="card-wrap">
      {props.note && (
        <p className="card-note" role="alert">
          {props.note}
        </p>
      )}
      <form
        className="card"
        ref={ref}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) props.onSubmit();
        }}
      >
        {photo && (
          <div className="preview">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not an optimisable asset */}
            <img src={photo.previewUrl} alt="Foto produk yang dilampirkan" />
            {photo.uploading && <span className="preview-busy" aria-label="Mengunggah foto" />}
            <button type="button" className="preview-remove" aria-label="Hapus foto" onClick={props.onRemovePhoto}>
              ×
            </button>
          </div>
        )}
        <textarea
          className={`ph${photo ? " has-photo" : ""}`}
          value={props.text}
          onChange={(event) => props.onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) props.onSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label="Pesan untuk LAKU"
          rows={2}
          maxLength={4000}
        />

        <div className="tools">
          <div className="chips" role="group" aria-label="Pilih fitur">
            {CHIPS.map((chip) => (
              <button
                key={chip.intent}
                type="button"
                className={`chip${intent === chip.intent ? " is-on" : ""}`}
                style={chip.style}
                aria-pressed={intent === chip.intent}
                onClick={() => props.onIntent(chip.intent)}
              >
                {chip.icon}
                <span>{chip.label}</span>
              </button>
            ))}
          </div>

          <div className="right">
            <div className="model-wrap">
              <button
                type="button"
                className="model"
                aria-haspopup="listbox"
                aria-expanded={menu}
                onClick={() => props.onMenu(!menu)}
              >
                <span>{preset ? PRESET_SHORT[preset] : "Pilih gaya"}</span>
                <svg viewBox="0 0 7 4" aria-hidden="true">
                  <path d="M.5.5 3.5 3.5 6.5.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                </svg>
              </button>
              {menu && (
                <ul className="menu" role="listbox" aria-label="Gaya foto studio">
                  {(Object.keys(PRESET_LABELS) as Preset[]).map((key) => (
                    <li key={key} role="option" aria-selected={preset === key}>
                      <button
                        type="button"
                        onClick={() => {
                          props.onPreset(key);
                          props.onMenu(false);
                        }}
                      >
                        {PRESET_LABELS[key]}
                      </button>
                    </li>
                  ))}
                  <li role="option" aria-selected={!preset}>
                    <button
                      type="button"
                      onClick={() => {
                        props.onPreset(undefined);
                        props.onMenu(false);
                      }}
                    >
                      Tanpa preset (tulis sendiri)
                    </button>
                  </li>
                </ul>
              )}
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) props.onAttach(file);
              }}
            />
            <button type="button" className="attach" aria-label="Lampirkan foto produk" onClick={() => fileInput.current?.click()}>
              {/* The drawing reaches x 21.2 and y 22.3, so the box is bigger than 20 or the clip's edges are cut off. */}
              <svg viewBox="0.5 0.4 23 23" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M13.9 2.6a4.4 4.4 0 0 1 6.2 6.2l-8.4 8.4a2.9 2.9 0 0 1-4.1-4.1l7.6-7.6a1.1 1.1 0 0 1 1.6 1.6l-7.6 7.6a.7.7 0 0 0 1 1l8.4-8.4a2.2 2.2 0 0 0-3.1-3.1L6.6 12.5a4.4 4.4 0 0 0 6.2 6.2l.6-.6a1.1 1.1 0 0 1 1.6 1.6l-.6.6A6.6 6.6 0 0 1 4.9 11l9-8.4Z"
                />
              </svg>
            </button>
            <button type="submit" className="send" aria-label="Kirim" disabled={!canSend}>
              <svg viewBox="0 0 12 14" aria-hidden="true">
                <path fill="#fff" d="M6 0 .4 5.2a1 1 0 0 0 1.4 1.4L5 3.7V13a1 1 0 0 0 2 0V3.7l3.2 2.9a1 1 0 0 0 1.4-1.4L6 0Z" />
              </svg>
            </button>
          </div>
        </div>
      </form>
      {!props.inThread && (
        <div className="suggest" role="group" aria-label="Contoh permintaan">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion.label} type="button" onClick={() => props.onSuggest(suggestion)}>
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
