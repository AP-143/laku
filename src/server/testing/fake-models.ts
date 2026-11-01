import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/**
 * A deterministic stand-in for the chat model. It never touches the network and costs nothing.
 * It streams `chunks` as the reply; with `failAfterChunks` it then fails, like a dropped or refused call.
 */
export function fakeChatModel(options: { chunks: string[]; failAfterChunks?: boolean }) {
  return new MockLanguageModelV4({
    doStream: async () => {
      const deltas = options.chunks.map((delta) => ({ type: "text-delta" as const, id: "text-1", delta }));

      if (options.failAfterChunks) {
        // Pull-based, so the chunks are delivered before the failure (erroring in start() would drop them).
        const parts = [{ type: "text-start" as const, id: "text-1" }, ...deltas];
        return {
          stream: new ReadableStream({
            pull(controller) {
              const next = parts.shift();
              if (next) controller.enqueue(next);
              else controller.error(new Error("fake model failure"));
            },
          }),
        };
      }

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start" as const, id: "text-1" },
            ...deltas,
            { type: "text-end" as const, id: "text-1" },
            { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
          ],
        }),
      };
    },
  });
}
