import type { ChatEvent } from "../shared/chat-events";

/** Turns whatever a model call threw into the one error event the user sees. */

type ErrorEvent = Extract<ChatEvent, { type: "error" }>;

const RATE_LIMITED_MESSAGE = "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi ya.";
const QUOTA_EXHAUSTED_MESSAGE = "Kuota gratis bulan ini sudah habis. Coba lagi nanti atau bulan depan ya.";
const REFUSED_MESSAGE = "Fotonya ditolak oleh model gambar. Coba foto lain, atau ubah permintaanmu, lalu coba lagi ya.";
const NETWORK_MESSAGE = "Koneksi ke layanan AI bermasalah. Cek internetmu lalu coba lagi ya.";
const GENERIC_MESSAGE = "Maaf, ada gangguan saat memproses pesanmu. Coba lagi ya.";
const LOCAL_QUOTA_MESSAGE =
  "Kuota gratis bulan ini sudah habis, jadi aku berhenti dulu supaya tidak ada biaya. Coba lagi bulan depan ya.";

/** The local usage meter says the free credit is gone, so no model was called at all. */
export class QuotaExhaustedError extends Error {}

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
  if (error instanceof QuotaExhaustedError) {
    return { type: "error", message: LOCAL_QUOTA_MESSAGE, retryable: true, code: "quota_exhausted" };
  }

  const status = statusOf(error);
  const message = messageOf(error);

  if (status === 429 || /rate.?limit/i.test(message)) {
    return { type: "error", message: RATE_LIMITED_MESSAGE, retryable: true, code: "rate_limited" };
  }
  if (status === 402 || /insufficient|credit|quota|balance/i.test(message)) {
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
