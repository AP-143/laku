import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeImageModel } from "./testing/fake-image-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

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

describe("error handling", () => {
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
    assert.match(error.message, /kuota/i);
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
