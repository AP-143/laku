import { CHAT_EVENTS_CONTENT_TYPE, encodeChatEvent, type ChatEvent } from "../shared/chat-events";

/** A streamed NDJSON response: `run` sends events, and the stream closes when it finishes. */
export function eventResponse(
  run: (send: (event: ChatEvent) => void) => Promise<void>,
  init: { status?: number } = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await run((event) => controller.enqueue(encoder.encode(encodeChatEvent(event))));
      controller.close();
    },
  });
  return new Response(body, { ...init, headers: { "content-type": CHAT_EVENTS_CONTENT_TYPE } });
}
