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
          <span>Ubah foto produk dari HP menjadi foto studio: latar putih bersih, backdrop warna, atau suasana lifestyle.</span>
        </li>
        <li>
          <strong>Storyboard</strong>
          <span>Buat storyboard dari satu foto produk. AI menyesuaikan jumlah panel dengan permintaanmu, dan hasilnya satu gambar lengkap dengan nomor dan caption.</span>
        </li>
        <li>
          <strong>Video</strong>
          <span>
            Lampirkan gambar storyboard, lalu tulis video yang diinginkan dan durasinya. AI memutuskan sisanya. Harga harus
            disetujui sebelum video dibuat.
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
          <li>Pilih fitur di sidebar: Foto Studio, Storyboard, atau Video.</li>
          <li>
            Lampirkan foto produk (JPG, PNG, atau WebP, maksimal 10 MB) dan tulis permintaanmu. Untuk Video, lampirkan gambar
            storyboard dan sebutkan durasinya: 10, 20, atau 30 detik.
          </li>
          <li>Setujui harga yang ditampilkan. Gambar atau video baru dibuat setelah itu.</li>
          <li>Periksa hasilnya, coba lagi jika perlu, lalu unduh.</li>
        </ol>
        <p>Pada Foto Studio dan Storyboard, produk tetap sama: bentuk, warna, logo, dan tulisannya tidak berubah.</p>
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
