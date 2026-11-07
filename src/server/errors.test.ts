import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeImageModel } from "./testing/fake-image-model";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";
import { FILLER } from "./testing/plain-tone";

/** Failures are reported clearly, never retried automatically, and always leave the user in charge of "Coba lagi". */

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

async function failingTurn(failWith: unknown) {
  const app = createTestApp(fakeChatModel({ chunks: ["x"] }), fakeImageModel({ failWith }));
  const [uploaded] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  const photoAssetId = uploaded.type === "asset_ready" ? uploaded.assetId : "";
  const events = await readEvents(
    await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "studio_photo" })),
  );
  return { app, events, error: events.at(-1) as Extract<ChatEvent, { type: "error" }> };
}

/** A video turn whose video model fails with `failWith`. */
async function failingVideoTurn(failWith: unknown) {
  const app = createTestApp(fakeChatModel({ chunks: ["x"] }), fakeImageModel(), { videoModel: fakeVideoModel({ failWith }) });
  const [uploaded] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  const photoAssetId = uploaded.type === "asset_ready" ? uploaded.assetId : "";
  const events = await readEvents(
    await app.chat(chatRequest({ messages: [{ role: "user", text: "video 10 detik", photoAssetId }], intent: "video" })),
  );
  return events.at(-1) as Extract<ChatEvent, { type: "error" }>;
}

/** Everything the seller can be told in words by the chat API, one entry per situation. */
async function everyMessage(): Promise<string[]> {
  const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
  const wordsOf = (events: ChatEvent[]) =>
    events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : event.type === "error" ? [event.message] : []));
  const ask = async (body: unknown) => wordsOf(await readEvents(await app.chat(chatRequest(body))));
  const missingPhoto = "00000000-0000-0000-0000-000000000000";

  const messages = [
    ...(await ask({ messages: [] })),
    ...(await ask({ messages: [{ role: "user", text: "x", photoAssetId: missingPhoto }] })),
    ...(await ask({ messages: [{ role: "user", text: "foto studio" }], intent: "studio_photo" })),
    ...(await ask({ messages: [{ role: "user", text: "storyboard" }], intent: "storyboard" })),
    ...(await ask({ messages: [{ role: "user", text: "bikinin video" }], intent: "video" })),
    ...(await ask({ messages: [{ role: "user", text: "bikinin video" }], lastImageAssetId: missingPhoto, intent: "video" })),
  ];
  const notAProduct = createTestApp(fakeChatModel({ chunks: ["x"], isProduct: false }));
  const [uploaded] = await readEvents(await notAProduct.upload(uploadRequest(await makePhoto("jpeg"))));
  const photoAssetId = uploaded.type === "asset_ready" ? uploaded.assetId : "";
  messages.push(
    ...wordsOf(await readEvents(await notAProduct.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "studio_photo" })))),
  );
  for (const failure of [
    httpError(429, "slow down"),
    httpError(402, "no credit left"),
    new Error("sensitive information"),
    new Error("does not support that input"),
    new TypeError("fetch failed"),
    new Error("something odd"),
  ]) {
    messages.push((await failingTurn(failure)).error.message);
  }
  return messages;
}

describe("error handling", () => {
  it("words every message directly: what happened and what to do, with no filler and no leading apology", async () => {
    const messages = await everyMessage();

    assert.ok(messages.length >= 12);
    for (const message of messages) {
      assert.doesNotMatch(message, FILLER, message);
    }
  });

  it("does not blame the photo or the image model for a refusal or an unusable input when the video model is the one that failed", async () => {
    for (const failure of [new Error("The output may contain sensitive information"), new Error("This model does not support that input")]) {
      const error = await failingVideoTurn(failure);

      assert.equal(error.type, "error");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /model gambar|foto/i);
    }
  });

  it("reports a rate limit as its own retryable error after one attempt", async () => {
    const { app, events, error } = await failingTurn(httpError(429, "Rate limit exceeded"));

    assert.equal(error.type, "error");
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryable, true);
    assert.match(error.message, /terlalu banyak|tunggu/i);
    assert.equal(app.imageModel.calls.length, 1);
    assert.equal(events.some((e) => e.type === "done" || e.type === "asset_ready"), false);
  });

  it("reports exhausted credit as a different retryable error after one attempt", async () => {
    const { app, error } = await failingTurn(httpError(402, "Insufficient funds: the free credit is used up"));

    assert.equal(error.code, "quota_exhausted");
    assert.equal(error.retryable, true);
    // The real balance is Google's: when it is gone the seller is told to top it up there.
    assert.match(error.message, /saldo/i);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("keeps the two messages apart so the user knows which limit was hit", async () => {
    const rate = (await failingTurn(httpError(429, "slow down"))).error.message;
    const quota = (await failingTurn(httpError(402, "no credit left"))).error.message;

    assert.notEqual(rate, quota);
  });

  it("explains a model refusal without a generic crash", async () => {
    const { app, error } = await failingTurn(new Error("The output image may contain sensitive information"));

    assert.equal(error.type, "error");
    assert.equal(error.retryable, true);
    assert.match(error.message, /ditolak|tidak bisa/i);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("explains an input the model cannot use, and does not call it exhausted credit", async () => {
    const { app, error } = await failingTurn(new Error("This model does not support image input; your credit is fine"));

    assert.equal(error.retryable, true);
    assert.equal(error.code, undefined);
    assert.match(error.message, /foto|gambar/i);
    assert.notEqual(error.message, (await failingTurn(httpError(402, "no credit left"))).error.message);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("explains a network failure as a connection problem", async () => {
    const { app, error } = await failingTurn(new TypeError("fetch failed"));

    assert.equal(error.retryable, true);
    assert.match(error.message, /koneksi|internet/i);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("falls back to a readable message for anything else", async () => {
    const { error } = await failingTurn(new Error("something odd"));

    assert.equal(error.retryable, true);
    assert.match(error.message, /coba lagi/i);
  });
});
