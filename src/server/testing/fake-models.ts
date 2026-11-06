import { planClips } from "../../shared/video-plan";
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
  /** What the intent router answers for any message (STUDIO, REVISE, STORYBOARD, EDIT_SCENE or CHAT). */
  intent?: string;
  /** The scenes the planner proposes (one per storyboard panel). */
  scenes?: string[];
  /** The art direction the planner picks for the product (look, colour, effects). Left out when not given. */
  artDirection?: string;
  /** Make the planner that shares the scenes over the video clips fail. */
  failVideoPlan?: boolean;
  /**
   * What the video planner decides: the voice that suits the actor, the narration line of each clip (the actor never
   * speaks) with the emotion it is read in and the second of the clip where it starts, grade, music.
   */
  videoPlan?: {
    voice?: "female" | "male";
    voiceProfile?: string;
    /** The narration of each clip. A clip left out gets a short default line; a line of "" means nothing is said there. */
    narration?: { line: string; delivery?: string; from?: number }[];
    /** The music the planner designed: a brief for the music model and how loud it sits. Left out means none. */
    music?: { brief: string; level?: number };
    /** The colour grade of the whole video; keys that are left out take the app's default. */
    grade?: { contrast?: number; saturation?: number; brightness?: number; warmth?: number; grain?: number; vignette?: boolean };
  };
  /** The scene the editor rewrites (scene is 1 to 4). */
  replacement?: { scene: number; text: string };
  /** The length the video planner chooses, in seconds (10, 20 or 30); 10 when left out. */
  videoSeconds?: number;
  /** Whether the video planner chooses a voice-over (the lines of `videoPlan.narration`); none when left out. */
  voiceOver?: boolean;
  /** What the voice reviser finds in a message about changing the narration. */
  voiceRevision?: { script?: string; voice?: "female" | "male" };
}

/** The narration the fake planner writes for a clip: its own line, or a short default one. */
function narrationOf(given: { line: string; delivery?: string; from?: number } | undefined, index: number) {
  if (given?.line === "") return null;
  return { line: given?.line ?? `Narasi klip ${index + 1}`, delivery: given?.delivery ?? "Warm and lively", from: given?.from ?? 0.4 };
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
      if (task === "video-plan" && options.failVideoPlan) throw new Error("fake video plan failure");
      const yesNo = (yes: boolean) => (yes ? "YES" : "NO");
      // The directions are "Direction for clip 1", "Direction for clip 2" and so on, one per clip of the length chosen.
      const chosen = planClips(options.videoSeconds ?? 10);
      const seconds = chosen.ok ? chosen.seconds : 10;
      const clipCount = chosen.ok ? chosen.clips.length : 2;
      const answer =
        task === "frame-check"
          ? yesNo(options.isProduct !== false)
          : task === "product-check" && options.peopleInPictures
            ? "NO"
            : task === "video-plan"
              ? JSON.stringify({
                  thinking: "A short reasoning about the product, the person and the sound.",
                  seconds,
                  voiceOver: options.voiceOver ?? false,
                  voice: options.videoPlan?.voice ?? "female",
                  voiceProfile: options.videoPlan?.voiceProfile ?? "Friendly young Indonesian voice, natural pace",
                  ...(options.videoPlan?.grade ? { grade: options.videoPlan.grade } : {}),
                  music: options.videoPlan?.music ? { use: true, ...options.videoPlan.music } : { use: false },
                  clips: Array.from({ length: clipCount }, (_, index) => ({
                    direction: `Direction for clip ${index + 1}`,
                    narration: narrationOf(options.videoPlan?.narration?.[index], index),
                  })),
                })
            : task === "intent"
              ? (options.intent ?? "CHAT")
              : task === "plan-scenes"
                ? JSON.stringify({ scenes: options.scenes, artDirection: options.artDirection })
                : task === "replace-scene"
                  ? JSON.stringify(options.replacement)
                  : task === "voice-revision"
                    ? JSON.stringify({
                        script: options.voiceRevision?.script ?? null,
                        voice: options.voiceRevision?.voice ?? null,
                      })
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
