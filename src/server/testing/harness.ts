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
import { fakeVideoModel, type FakeVideoModel } from "./fake-video-model";

interface TestAppOptions {
  /** The pretend current time, for month and day rollover. Change `app.clock.now` later to move time on. */
  now?: Date;
  /** Spend already on the meter this month, booked on the first day so it does not count towards today. */
  startingMonthUsd?: number;
  /** Spend already on the meter today. */
  startingTodayUsd?: number;
  /** The stand-in for the video model; defaults to one that makes every clip. */
  videoModel?: FakeVideoModel;
}

/** A mid-month, mid-day default, so no test depends on the real date. */
const DEFAULT_NOW = new Date("2026-11-15T12:00:00Z");

/** The app's request handlers wired to fake models and throwaway storage. */
export function createTestApp(
  model: ReturnType<typeof fakeChatModel>,
  imageModel: FakeImageModel = fakeImageModel(),
  options: TestAppOptions = {},
) {
  const videoModel = options.videoModel ?? fakeVideoModel();
  const dir = mkdtempSync(path.join(os.tmpdir(), "laku-test-"));
  const store = createAssetStore(path.join(dir, "assets"));
  const clock = { now: options.now ?? DEFAULT_NOW };
  const ledgerFile = path.join(dir, "usage.jsonl");
  const ledger = createUsageLedger(ledgerFile, () => clock.now);
  const monthStart = new Date(Date.UTC(clock.now.getUTCFullYear(), clock.now.getUTCMonth(), 1));
  const starting = [
    options.startingMonthUsd ? { at: monthStart, usd: options.startingMonthUsd } : undefined,
    options.startingTodayUsd ? { at: clock.now, usd: options.startingTodayUsd } : undefined,
  ].filter((entry) => entry !== undefined);
  if (starting.length > 0) {
    writeFileSync(ledgerFile, starting.map((entry) => `${JSON.stringify({ at: entry.at.toISOString(), usd: entry.usd })}\n`).join(""));
  }
  return {
    chat: createChatHandler(createModelClient({ chatModel: model, imageModel, videoModel }), store, ledger),
    upload: createUploadHandler(store),
    usage: createUsageHandler(ledger),
    store,
    imageModel,
    videoModel,
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
