import type { ChatEvent } from "../../shared/chat-events";

/** Reads a response made of NDJSON chat events into a list. */
export async function readEvents(response: Response): Promise<ChatEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ChatEvent);
}
