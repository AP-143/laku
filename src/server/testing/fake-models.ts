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
  /**
   * The pictures show a person using the product, like a real storyboard frame: the strict photo check says NO
   * ("mainly a person") while the frame check, which only asks that the product is clearly there, says YES.
   */
  peopleInPictures?: boolean;
  /** What the intent router answers for any message (STUDIO, REVISE, STORYBOARD, VIDEO or CHAT). */
  intent?: string;
  /** The scenes the planner proposes (one per storyboard panel). */
  scenes?: string[];
  /** The art direction the planner picks for the product (look, colour, effects). Left out when not given. */
  artDirection?: string;
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
      if ((task === "product-check" || task === "frame-check") && options.failProductCheck) {
        throw new Error("fake product check failure");
      }
      const yesNo = (yes: boolean) => (yes ? "YES" : "NO");
      const answer =
        task === "frame-check"
          ? yesNo(options.isProduct !== false)
          : task === "product-check" && options.peopleInPictures
            ? "NO"
            : task === "intent"
              ? (options.intent ?? "CHAT")
              : task === "plan-scenes"
                ? JSON.stringify({ scenes: options.scenes, artDirection: options.artDirection })
                : yesNo(options.isProduct !== false);
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
