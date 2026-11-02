import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";

const TEXT_PART_ID = "text-1";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

interface FakeChatModelOptions {
  /** The pieces of the streamed chat reply. */
  chunks: string[];
  /** Fail after streaming the chunks, like a dropped or refused call. */
  failAfterChunks?: boolean;
  /** What the product check answers for any photo. Defaults to "it is a product". */
  isProduct?: boolean;
  /** Make the product check itself fail. */
  failProductCheck?: boolean;
  /** What the intent router answers for any message (STUDIO, REVISE, STORYBOARD, EDIT_SCENE or CHAT). */
  intent?: string;
  /** The four scenes the planner proposes. */
  scenes?: string[];
  /** The scene the editor rewrites (scene is 1 to 4). */
  replacement?: { scene: number; text: string };
  /** The video length the request reader finds in the message; leave out for "no length said". */
  videoSeconds?: number;
}

/** Which one-shot task a generate call is, read from the tag every internal prompt starts with. */
function taskOf(callOptions: LanguageModelV4CallOptions): string | undefined {
  return JSON.stringify(callOptions.prompt).match(/\[task: ([a-z-]+)\]/)?.[1];
}

/**
 * A deterministic stand-in for the chat model. It never touches the network and costs nothing.
 * The streamed reply is the chat; the single-shot answer is the product check (YES or NO).
 */
export function fakeChatModel(options: FakeChatModelOptions) {
  return new MockLanguageModelV4({
    doGenerate: async (callOptions) => {
      const task = taskOf(callOptions);
      if (task === "product-check" && options.failProductCheck) throw new Error("fake product check failure");
      const answer =
        task === "intent"
          ? (options.intent ?? "CHAT")
          : task === "plan-scenes"
            ? JSON.stringify({ scenes: options.scenes })
            : task === "replace-scene"
              ? JSON.stringify(options.replacement)
              : task === "video-request"
                ? JSON.stringify({ seconds: options.videoSeconds ?? null })
                : options.isProduct === false
                ? "NO"
                : "YES";
      return {
        content: [{ type: "text" as const, text: answer }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      };
    },

    doStream: async () => {
      const deltas = options.chunks.map((delta) => ({ type: "text-delta" as const, id: TEXT_PART_ID, delta }));

      if (options.failAfterChunks) {
        // Pull-based, so the chunks are delivered before the failure (erroring in start() would drop them).
        const parts = [{ type: "text-start" as const, id: TEXT_PART_ID }, ...deltas];
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
            { type: "text-start" as const, id: TEXT_PART_ID },
            ...deltas,
            { type: "text-end" as const, id: TEXT_PART_ID },
            { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
          ],
        }),
      };
    },
  });
}
