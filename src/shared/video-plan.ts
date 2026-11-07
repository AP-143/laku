/**
 * The length of a video. The video model is given the storyboard picture and the seller's own words and makes the whole
 * video in one call, so the only thing the app works out itself is how many seconds to ask for (the price follows it).
 */

/** The lengths a video can have. A seller who names none gets the shortest. */
export const VIDEO_LENGTH_CHOICES = [10, 20, 30] as const;

export type VideoSeconds = (typeof VIDEO_LENGTH_CHOICES)[number];

/**
 * The length a seller's own words ask for: a number of seconds written as "10 detik", "30s" or "20 sec", taken as the
 * nearest length the app can make that is not longer ("15 detik" is 10). A time under 10 seconds is not a video length
 * ("teks muncul 3 detik"), so it asks for nothing. Found by a fixed pattern, not by a model, so it can be relied on.
 */
export function requestedLength(text: string | undefined): VideoSeconds | undefined {
  const match = text?.match(/(?<![\d.,])(\d{1,2})\s*(?:detik|dtk|sec(?:ond)?s?|s)\b/i);
  const asked = match ? Number(match[1]) : 0;
  if (asked < VIDEO_LENGTH_CHOICES[0]) return undefined;
  return VIDEO_LENGTH_CHOICES.filter((choice) => choice <= asked).at(-1);
}
