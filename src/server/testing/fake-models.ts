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
   * What the video planner decides about the sound: speech on camera (lip-synced, in the clips) or a separate
   * narration, the voice that suits the person, and the words said in each clip. Defaults to a female narration.
   */
  videoPlan?: {
    audio?: "on_camera" | "narration";
    voice?: "female" | "male";
    voiceProfile?: string;
    dialogues?: string[];
    /** The captions of each clip, with when they show (seconds from the start of the clip). */
    captions?: { text: string; from: number; to: number; kind?: "subtitle" | "callout" | "cta" }[][];
    /** The music the planner designed: a brief for the music model and how loud it sits. Left out means none. */
    music?: { brief: string; level?: number };
    /** The colours of the text bubbles, which the planner picks for the look of the ad. */
    palette?: { bubble?: string; text?: string; accent?: string };
    /** The colour grade of the whole video; keys that are left out take the app's default. */
    grade?: { contrast?: number; saturation?: number; brightness?: number; warmth?: number; grain?: number; vignette?: boolean };
  };
  /** The scene the editor rewrites (scene is 1 to 4). */
  replacement?: { scene: number; text: string };
  /** The video length the request reader finds in the message; leave out for "no length said". */
  videoSeconds?: number;
  /** Whether the request reader finds a request for a voice-over in the message. */
  voiceOver?: boolean;
  /** The narration script the writer answers with. */
  script?: string;
  /** How the writer says the narration should be performed. When given, the writer answers with thinking, delivery and script as JSON. */
  delivery?: string;
  /** What the voice reviser finds in a message about changing the narration. */
  voiceRevision?: { script?: string; voice?: "female" | "male" };
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
      // The directions are "Direction for clip 1", "Direction for clip 2" and so on, one per clip the prompt names.
      const clipCount = Number(JSON.stringify(callOptions.prompt).match(/Number of clips: (\d+)/)?.[1] ?? 0);
      const answer =
        task === "frame-check"
          ? yesNo(options.isProduct !== false)
          : task === "product-check" && options.peopleInPictures
            ? "NO"
            : task === "video-plan"
              ? JSON.stringify({
                  thinking: "A short reasoning about the product, the person and the sound.",
                  audio: options.videoPlan?.audio ?? "narration",
                  voice: options.videoPlan?.voice ?? "female",
                  voiceProfile: options.videoPlan?.voiceProfile ?? "Friendly young Indonesian voice, natural pace",
                  ...(options.videoPlan?.grade ? { grade: options.videoPlan.grade } : {}),
                  ...(options.videoPlan?.palette ? { palette: options.videoPlan.palette } : {}),
                  music: options.videoPlan?.music ? { use: true, ...options.videoPlan.music } : { use: false },
                  clips: Array.from({ length: clipCount }, (_, index) => ({
                    direction: `Direction for clip ${index + 1}`,
                    dialogue: options.videoPlan?.dialogues?.[index] ?? "",
                    captions: options.videoPlan?.captions?.[index] ?? [],
                  })),
                })
            : task === "intent"
              ? (options.intent ?? "CHAT")
              : task === "plan-scenes"
                ? JSON.stringify({ scenes: options.scenes, artDirection: options.artDirection })
                : task === "replace-scene"
                  ? JSON.stringify(options.replacement)
                  : task === "video-request"
                    ? JSON.stringify({ seconds: options.videoSeconds ?? null, voiceOver: options.voiceOver ?? false })
                    : task === "voice-script"
                      ? options.delivery
                        ? JSON.stringify({ thinking: "How the mood moves through the ad.", delivery: options.delivery, script: options.script })
                        : (options.script ?? "Ini naskah contoh untuk iklan produk.")
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
