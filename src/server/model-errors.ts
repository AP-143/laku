import type { ChatEvent } from "../shared/chat-events";

/** Turns whatever a model call threw into the one error event the user sees. */

type ErrorEvent = Extract<ChatEvent, { type: "error" }>;

const RATE_LIMITED_MESSAGE = "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar, lalu coba lagi.";
const QUOTA_EXHAUSTED_MESSAGE = "Saldo atau kuota layanan AI habis. Isi saldo di Google AI Studio atau coba lagi nanti.";
const REFUSED_MESSAGE = "Permintaan ditolak oleh model AI. Ubah permintaan atau gunakan gambar lain, lalu coba lagi.";
const UNSUPPORTED_MESSAGE = "Gambar tidak dapat digunakan. Gunakan file JPG, PNG, atau WebP, lalu coba lagi.";
const NETWORK_MESSAGE = "Koneksi ke layanan AI bermasalah. Periksa koneksi internet, lalu coba lagi.";
const GENERIC_MESSAGE = "Terjadi gangguan saat memproses pesan. Coba lagi.";

function statusOf(error: unknown): number | undefined {
  const { statusCode, status, cause } = (error ?? {}) as { statusCode?: unknown; status?: unknown; cause?: unknown };
  if (typeof statusCode === "number") return statusCode;
  if (typeof status === "number") return status;
  return cause ? statusOf(cause) : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function describeFailure(error: unknown): ErrorEvent {
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
