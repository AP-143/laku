"use client";

import { useEffect, useRef } from "react";

/** The Price question: what the seller is asked before anything is spent. */
export interface PriceAsk {
  message: string;
  estimatedUsd?: number;
  /** The request that was asked about, sent again with the yes. */
  retry: Record<string, unknown>;
  /** The storyboard card the request draws the picture on again, so the yes goes on that card and not on a new one. */
  scenesItemId?: string;
}

interface Props {
  ask?: PriceAsk;
  /** The answer is taken once the request that asked has finished. */
  busy: boolean;
  onAnswer: (yes: boolean) => void;
}

/** A pop-up over the chat that tells the seller the price and waits for a yes or a no. Esc and a click outside are a no. */
export function PriceDialog({ ask, busy, onAnswer }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (ask && !element.open) element.showModal();
    if (!ask && element.open) element.close();
  }, [ask]);

  return (
    <dialog
      ref={dialog}
      className="info-dialog"
      aria-labelledby="price-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onAnswer(false);
      }}
      onClick={(event) => {
        // A click on the dimmed area outside the card is a no.
        if (event.target === event.currentTarget && !busy) onAnswer(false);
      }}
    >
      {ask && (
        <div className="info-card">
          <h2 id="price-title">Konfirmasi biaya</h2>
          <p>{ask.message}</p>
          <div className="price-actions">
            <button type="button" className="info-close" disabled={busy} onClick={() => onAnswer(true)}>
              Lanjut
            </button>
            <button type="button" className="price-no" autoFocus disabled={busy} onClick={() => onAnswer(false)}>
              Batal
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
