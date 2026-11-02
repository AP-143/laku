import { COSTS } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";

/** Turns whatever a model call threw into the one error event the user sees. */

type ErrorEvent = Extract<ChatEvent, { type: "error" }>;

const RATE_LIMITED_MESSAGE = "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi ya.";
const QUOTA_EXHAUSTED_MESSAGE = "Kuota bulan ini sudah habis. Coba lagi nanti atau bulan depan ya.";
const REFUSED_MESSAGE = "Fotonya ditolak oleh model gambar. Coba foto lain, atau ubah permintaanmu, lalu coba lagi ya.";
const UNSUPPORTED_MESSAGE = "Model gambar tidak bisa memakai fotonya. Coba foto lain (JPG, PNG, atau WebP) lalu coba lagi ya.";
const NETWORK_MESSAGE = "Koneksi ke layanan AI bermasalah. Cek internetmu lalu coba lagi ya.";
const GENERIC_MESSAGE = "Maaf, ada gangguan saat memproses pesanmu. Coba lagi ya.";
const LOCAL_QUOTA_MESSAGE =
  "Kuota bulan ini sudah habis, jadi aku berhenti dulu supaya tidak ada biaya. Coba lagi bulan depan ya.";

/** The local usage meter says the free credit is gone, so no model was called at all. */
export class QuotaExhaustedError extends Error {}

/** Today's spend cap is reached, so no model was called. The balance of the month is not gone yet. */
export class DailyCapReachedError extends Error {
  constructor(
    /** When the day ends and today's total starts again from zero (00:00 UTC). */
    readonly resetsAt: Date,
    /** What is left of this month's budget, in US dollars. */
    readonly remainingMonthUsd: number,
  ) {
    super("Daily spend cap reached");
  }
}

/** The video asked for costs more than the budget has left, but a shorter one fits. No model was called. */
export class VideoNotAffordableError extends Error {
  constructor(/** The most seconds of video the remaining budget covers. */ readonly affordableSeconds: number) {
    super("The video does not fit the remaining budget");
  }
}

/** The reset time in the seller's own clock (WIB, UTC+7), as "07.00". */
function wibClock(date: Date): string {
  const hours = (date.getUTCHours() + 7) % 24;
  return `${String(hours).padStart(2, "0")}.${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function dailyCapMessage(error: DailyCapReachedError): string {
  return (
    `Batas pemakaian hari ini (US$${COSTS.dailyBudgetUsd.toFixed(2)}) sudah tercapai, jadi aku berhenti dulu supaya tidak ada biaya berlebih. ` +
    `Sisa anggaran bulan ini US$${error.remainingMonthUsd.toFixed(2)}. Bisa dipakai lagi sekitar pukul ${wibClock(error.resetsAt)} WIB.`
  );
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
  if (error instanceof DailyCapReachedError) {
    return { type: "error", message: dailyCapMessage(error), retryable: true, code: "daily_cap_reached" };
  }
  if (error instanceof VideoNotAffordableError) {
    return {
      type: "error",
      message: `Sisa anggaranmu baru cukup untuk sekitar ${error.affordableSeconds} detik video. Minta video yang lebih pendek ya.`,
      retryable: true,
      code: "quota_exhausted",
    };
  }
  if (error instanceof QuotaExhaustedError) {
    return { type: "error", message: LOCAL_QUOTA_MESSAGE, retryable: true, code: "quota_exhausted" };
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
