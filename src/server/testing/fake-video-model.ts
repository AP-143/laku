import type { AssetFile } from "../asset-store";
import type { VideoModel } from "../video-model";

interface FakeVideoModelOptions {
  /** Make every call fail with this error. */
  failWith?: unknown;
}

interface FakeVideoCall {
  prompt?: string;
  frame: AssetFile;
  seconds: number;
}

/**
 * A deterministic stand-in for the video model. It never touches the network and costs nothing.
 * `calls` records every request, so tests can tell which picture, words and length the model was asked for.
 */
export function fakeVideoModel(options: FakeVideoModelOptions = {}): VideoModel & { calls: FakeVideoCall[] } {
  const calls: FakeVideoCall[] = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      if ("failWith" in options) throw options.failWith ?? new Error("fake video failure");
      return new TextEncoder().encode(`fake video of ${request.seconds} seconds`);
    },
  };
}

export type FakeVideoModel = ReturnType<typeof fakeVideoModel>;
