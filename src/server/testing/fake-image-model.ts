import { MockImageModelV4 } from "ai/test";
import type { ImageModelV4CallOptions } from "@ai-sdk/provider";
import { makePhoto } from "./photos";

interface FakeImageModelOptions {
  /** Make every call fail with this error, like a rate limit or a refusal. */
  failWith?: unknown;
}

/**
 * A deterministic stand-in for the image model. It never touches the network and costs nothing.
 * `calls` records every request, so tests can tell how many times (and with what) the model was asked.
 */
export function fakeImageModel(options: FakeImageModelOptions = {}) {
  const calls: ImageModelV4CallOptions[] = [];
  const model = new MockImageModelV4({
    doGenerate: async (callOptions) => {
      calls.push(callOptions);
      if (options.failWith) throw options.failWith;
      return {
        images: [new Uint8Array(await makePhoto("png", 640, 640))],
        warnings: [],
        response: { timestamp: new Date(), modelId: "fake-image", headers: undefined },
      };
    },
  });
  return Object.assign(model, { calls });
}

export type FakeImageModel = ReturnType<typeof fakeImageModel>;
