"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./info-dialog.css";

type Topic = "fitur" | "cara-kerja" | "kontak";

/** What the nav links say. Short on purpose: the pages stay one screen, the details live here. */
const TOPICS: Record<Topic, { title: string; body: ReactNode }> = {
  fitur: {
    title: "Fitur LAKU",
    body: (
      <ul>
        <li>
          <strong>Foto Studio</strong>
          <span>Foto produk dari HP jadi foto studio: latar putih bersih, backdrop warna, atau suasana lifestyle.</span>
        </li>
        <li>
          <strong>Storyboard &amp; Video</strong>
          <span>
            Storyboard 6 panel dari satu foto produk, jadi satu gambar lengkap dengan judul dan caption. Kamu setujui teksnya dulu, baru gambarnya dibuat. Setelah itu, pilih durasi
            pada panel “Buat video iklan” (dan voice over kalau mau), lalu tekan Generate.
          </span>
        </li>
      </ul>
    ),
  },
  "cara-kerja": {
    title: "Cara kerja",
    body: (
      <>
        <ol>
          <li>Unggah satu foto produk (JPG, PNG, atau WebP, maksimal 10 MB).</li>
          <li>Pilih gaya foto atau tulis permintaanmu, misalnya “bikinin storyboard dong”.</li>
          <li>Bandingkan hasilnya dengan foto asli, coba lagi kalau perlu, lalu unduh.</li>
        </ol>
        <p>Produknya harus tetap sama: bentuk, warna, logo, dan tulisannya tidak boleh berubah.</p>
      </>
    ),
  },
  kontak: {
    title: "Kontak",
    body: (
      <p>
        LAKU masih prototipe yang berjalan di komputer lokal, jadi belum ada kontak resmi. Punya masukan? Sampaikan langsung
        ke pembuat aplikasi ini.
      </p>
    ),
  },
};

const noSubscription = () => () => {};
/** False while the server renders (and while the browser hydrates), true afterwards. */
const useIsClient = () => useSyncExternalStore(noSubscription, () => true, () => false);

/** Opens the Fitur, Cara Kerja and Kontak topics in a small dialog. `link` gives the props for a nav anchor. */
export function useInfoDialog() {
  const [topic, setTopic] = useState<Topic | undefined>();
  const dialog = useRef<HTMLDialogElement>(null);
  const isClient = useIsClient();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (topic && !element.open) element.showModal();
    if (!topic && element.open) element.close();
  }, [topic]);

  const link = useCallback(
    (name: Topic) => ({
      href: `#${name}`,
      onClick: (event: MouseEvent) => {
        event.preventDefault();
        setTopic(name);
      },
    }),
    [],
  );

  const content = topic ? TOPICS[topic] : undefined;
  const element =
    !isClient
      ? null
      : createPortal(
          <dialog
            ref={dialog}
            className="info-dialog"
            aria-labelledby="info-title"
            onClose={() => setTopic(undefined)}
            onClick={(event) => {
              // A click on the dimmed area outside the card closes it.
              if (event.target === event.currentTarget) setTopic(undefined);
            }}
          >
            {content && (
              <div className="info-card">
                <h2 id="info-title">{content.title}</h2>
                {content.body}
                <button type="button" className="info-close" onClick={() => setTopic(undefined)}>
                  Tutup
                </button>
              </div>
            )}
          </dialog>,
          document.body,
        );

  return { link, dialog: element };
}
