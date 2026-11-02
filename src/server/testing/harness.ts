import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssetStore } from "../asset-store";
import { createUploadHandler } from "../assets-handler";
import { createChatHandler } from "../chat-handler";
import { createModelClient } from "../model-client";
import { createUsageHandler } from "../usage-handler";
import { createUsageLedger } from "../usage-ledger";
import { fakeChatModel } from "./fake-models";
import { fakeImageModel, type FakeImageModel } from "./fake-image-model";

interface TestAppOptions {
  /** The pretend current time, for month rollover. Change `app.clock.now` later to move time on. */
  now?: Date;
  /** Spend already on the meter this month. */
  startingMonthUsd?: number;
}

/** The app's request handlers wired to fake models and throwaway storage. */
export function createTestApp(
  model: ReturnType<typeof fakeChatModel>,
  imageModel: FakeImageModel = fakeImageModel(),
  options: TestAppOptions = {},
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "laku-test-"));
  const store = createAssetStore(path.join(dir, "assets"));
  const clock = { now: options.now ?? new Date() };
  const ledgerFile = path.join(dir, "usage.jsonl");
  const ledger = createUsageLedger(ledgerFile, () => clock.now);
  if (options.startingMonthUsd) {
    writeFileSync(ledgerFile, `${JSON.stringify({ at: clock.now.toISOString(), usd: options.startingMonthUsd })}
`);
  }
  return {
    chat: createChatHandler(createModelClient({ chatModel: model, imageModel }), store, ledger),
    upload: createUploadHandler(store),
    usage: createUsageHandler(ledger),
    store,
    imageModel,
    clock,
  };
}

export function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
