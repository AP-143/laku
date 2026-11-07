import type { ChatEvent } from "../../shared/chat-events";

/** Browser-side calls to the chat API. Nothing here retries: the user decides when to try again. */

const NETWORK_MESSAGE = "Koneksi ke server bermasalah. Cek internetmu lalu coba lagi ya.";
const NETWORK_ERROR: ChatEvent = { type: "error", message: NETWORK_MESSAGE, retryable: true };

/** Reads an NDJSON response and hands each event over as it arrives. */
async function readEventStream(response: Response, onEvent: (event: ChatEvent) => void): Promise<void> {
  if (!response.body) {
    onEvent(NETWORK_ERROR);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as ChatEvent);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent);
}

async function postForEvents(url: string, init: RequestInit, onEvent: (event: ChatEvent) => void): Promise<void> {
  try {
    await readEventStream(await fetch(url, { method: "POST", ...init }), onEvent);
  } catch {
    onEvent(NETWORK_ERROR);
  }
}

/** Sends one chat turn and reports its events as they stream in. */
export function sendChat(body: unknown, onEvent: (event: ChatEvent) => void): Promise<void> {
  return postForEvents(
    "/api/chat",
    { headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    onEvent,
  );
}

/** Uploads a product photo. Resolves with the asset id, or with the error to show. */
export async function uploadPhoto(file: File): Promise<{ assetId: string } | { error: string }> {
  const form = new FormData();
  form.set("photo", file);
  let result: { assetId: string } | { error: string } = { error: NETWORK_MESSAGE };
  await postForEvents("/api/assets", { body: form }, (event) => {
    if (event.type === "asset_ready") result = { assetId: event.assetId };
    else if (event.type === "error") result = { error: event.message };
  });
  return result;
}

export const assetUrl = (assetId: string, variant: "original" | "resized" = "original") =>
  `/api/assets/${assetId}${variant === "resized" ? "?variant=resized" : ""}`;

/** The same file, but with a header that makes the browser save it. */
export const downloadUrl = (assetId: string) => `/api/assets/${assetId}?download=1`;
