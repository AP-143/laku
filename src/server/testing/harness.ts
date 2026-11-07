import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssetStore } from "../asset-store";
import { createUploadHandler } from "../assets-handler";
import { createChatHandler } from "../chat-handler";
import { createModelClient } from "../model-client";
import { fakeChatModel } from "./fake-models";
import { fakeImageModel, type FakeImageModel } from "./fake-image-model";
import { fakeVideoModel, type FakeVideoModel } from "./fake-video-model";

interface TestAppOptions {
  /** The stand-in for the video model; defaults to one that makes every video. */
  videoModel?: FakeVideoModel;
  /** Where the app writes what it tells the video model; nowhere unless a test listens. */
  log?: (message: string) => void;
}

/** The app's request handlers wired to fake models and throwaway storage. */
export function createTestApp(
  model: ReturnType<typeof fakeChatModel>,
  imageModel: FakeImageModel = fakeImageModel(),
  options: TestAppOptions = {},
) {
  const videoModel = options.videoModel ?? fakeVideoModel();
  const dir = mkdtempSync(path.join(os.tmpdir(), "laku-test-"));
  const store = createAssetStore(path.join(dir, "assets"));
  return {
    chat: createChatHandler(createModelClient({ chatModel: model, imageModel, videoModel }), store, { log: options.log }),
    upload: createUploadHandler(store),
    store,
    imageModel,
    videoModel,
  };
}

/**
 * A chat request. Unless the test says otherwise it already carries the seller's yes to the Price question, so a test
 * about something else is not stopped by it; pass `confirmedUsd: null` to send the request as if nothing was agreed yet.
 */
export function chatRequest(body: unknown): Request {
  const fields = { confirmedUsd: 10, ...(body as object) };
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}
