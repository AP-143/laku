import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssetStore } from "../asset-store";
import { createUploadHandler } from "../assets-handler";
import { createChatHandler } from "../chat-handler";
import { createModelClient } from "../model-client";
import { fakeChatModel } from "./fake-models";

/** The app's request handlers wired to a fake model and a throwaway asset folder. */
export function createTestApp(model: ReturnType<typeof fakeChatModel>) {
  const store = createAssetStore(mkdtempSync(path.join(os.tmpdir(), "laku-test-")));
  return {
    chat: createChatHandler(createModelClient({ chatModel: model }), store),
    upload: createUploadHandler(store),
  };
}

export function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
