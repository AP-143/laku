import type { ChatEvent } from "../shared/chat-events";

/** Turns whatever a model call threw into the one error event the user sees. */

type ErrorEvent = Extract<ChatEvent, { type: "error" }>;

const RATE_LIMITED_MESSAGE = "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi ya.";
const QUOTA_EXHAUSTED_MESSAGE =
  "Saldo atau kuota layanan AI sudah habis. Isi saldo di Google AI Studio atau coba lagi nanti ya.";
const REFUSED_MESSAGE = "Fotonya ditolak oleh model gambar. Coba foto lain, atau ubah permintaanmu, lalu coba lagi ya.";
const UNSUPPORTED_MESSAGE = "Model gambar tidak bisa memakai fotonya. Coba foto lain (JPG, PNG, atau WebP) lalu coba lagi ya.";
const NETWORK_MESSAGE = "Koneksi ke layanan AI bermasalah. Cek internetmu lalu coba lagi ya.";
const GENERIC_MESSAGE = "Maaf, ada gangguan saat memproses pesanmu. Coba lagi ya.";

/** One clip of a video did not come out. The clips made before it are kept; `cause` is what the model threw. */
export class ClipFailedError extends Error {
  constructor(
    readonly index: number,
    readonly total: number,
    readonly cause: unknown,
  ) {
    super(`Clip ${index + 1} of ${total} failed`);
  }
}

function statusOf(error: unknown): number | undefined {
  const { statusCode, status, cause } = (error ?? {}) as { statusCode?: unknown; status?: unknown; cause?: unknown };
  if (typeof statusCode === "number") return statusCode;
  if (typeof status === "number") return status;
  return cause ? statusOf(cause) : undefined;
}

/**
 * True when a failed paid call may still have been billed: it timed out or was cancelled after it was sent,
 * so the provider could have done the work. Every other failure (a rejection, a refusal, no connection)
 * is treated as not billed.
 */
export function mayStillBeBilled(error: unknown): boolean {
  const { name, cause } = (error ?? {}) as { name?: unknown; cause?: unknown };
  if (name === "TimeoutError" || name === "AbortError") return true;
  return cause ? mayStillBeBilled(cause) : false;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function describeFailure(error: unknown): ErrorEvent {
  if (error instanceof ClipFailedError) {
    const why = describeFailure(error.cause);
    return { ...why, message: `Klip ${error.index + 1} dari ${error.total} gagal dibuat. ${why.message}` };
  }

  const status = statusOf(error);
  const message = messageOf(error);

  if (status === 429 || /rate.?limit/i.test(message)) {
    return { type: "error", message: RATE_LIMITED_MESSAGE, retryable: true, code: "rate_limited" };
  }
  // Checked before the credit words, so "does not support image input, credit is fine" is not read as no credit.
  if (/unsupported|not support|invalid (image|file|input)/i.test(message)) {
    return { type: "error", message: UNSUPPORTED_MESSAGE, retryable: true };
  }
  if (status === 402 || /insufficient (funds|credit)|quota|out of credit|credits? (exhausted|used up|left)/i.test(message)) {
    return { type: "error", message: QUOTA_EXHAUSTED_MESSAGE, retryable: true, code: "quota_exhausted" };
  }
  if (/sensitive|moderation|safety|blocked|policy/i.test(message)) {
    return { type: "error", message: REFUSED_MESSAGE, retryable: true };
  }
  if (error instanceof TypeError || /fetch failed|network|ECONN|ENOTFOUND|timed? ?out/i.test(message)) {
    return { type: "error", message: NETWORK_MESSAGE, retryable: true };
  }
  return { type: "error", message: GENERIC_MESSAGE, retryable: true };
}
