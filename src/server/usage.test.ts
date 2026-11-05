import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeChatModel } from "./testing/fake-models";
import { fakeImageModel } from "./testing/fake-image-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** The usage meter: a local estimate of this month's spend. It only counts; no limit stops a request, the real balance is Google's. */

async function uploadPhoto(app: ReturnType<typeof createTestApp>): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const studioRequest = (photoAssetId: string) =>
  chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "studio_photo" });

async function readUsage(app: ReturnType<typeof createTestApp>) {
  return (await app.usage(new Request("http://localhost/api/usage"))).json() as Promise<{
    monthUsd: number;
  }>;
}

describe("usage meter", () => {
  it("starts empty", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    assert.deepEqual(await readUsage(app), { monthUsd: 0 });
  });

  it("adds an estimated cost for every generated image and reports it in the stream", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const photoAssetId = await uploadPhoto(app);

    const first = await readEvents(await app.chat(studioRequest(photoAssetId)));
    const second = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.deepEqual(first.find((e) => e.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.0336 });
    assert.deepEqual(second.find((e) => e.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.0672 });
    assert.deepEqual(await readUsage(app), { monthUsd: 0.0672 });
  });

  it("does not charge for a turn that makes no image", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["Halo!"] }));

    const events = await readEvents(await app.chat(chatRequest({ messages: [{ role: "user", text: "Halo" }] })));

    assert.equal(events.some((e) => e.type === "usage_updated"), false);
    assert.equal((await readUsage(app)).monthUsd, 0);
  });

  it("starts a fresh total in a new calendar month", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { now: new Date("2026-10-31T12:00:00Z") });
    const photoAssetId = await uploadPhoto(app);
    await readEvents(await app.chat(studioRequest(photoAssetId)));
    assert.equal((await readUsage(app)).monthUsd, 0.0336);

    app.clock.now = new Date("2026-11-01T12:00:00Z");

    assert.equal((await readUsage(app)).monthUsd, 0);
  });

  it("has no monthly limit: a month that already passed US$4 still generates, and the meter keeps counting", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingMonthUsd: 3.99 });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal(events.some((e) => e.type === "asset_ready" && e.role === "studio_photo"), true);
    assert.equal(app.imageModel.calls.length, 1);
    assert.equal((await readUsage(app)).monthUsd, 4.0236);
  });
});

describe("no spending limit", () => {
  it("makes a studio photo however much was already spent today and this month, and keeps counting", async () => {
    // The app used to stop at US$3.50 a day; it sets no limit now, the balance on Google's side is the stop.
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 10 });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal(events.some((e) => e.type === "asset_ready" && e.role === "studio_photo"), true);
    assert.equal(app.imageModel.calls.length, 1);
    assert.equal((await readUsage(app)).monthUsd, 10.0336);
  });

  it("lets simultaneous requests all through, and books every one of them", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 10 });
    const photoAssetId = await uploadPhoto(app);

    const turns = await Promise.all([1, 2, 3].map(async () => readEvents(await app.chat(studioRequest(photoAssetId)))));

    assert.equal(app.imageModel.calls.length, 3);
    assert.equal(turns.filter((events) => events.some((e) => e.type === "asset_ready")).length, 3);
    assert.equal((await readUsage(app)).monthUsd, 10.1008);
  });
});

describe("usage meter under concurrent requests", () => {
  it("gives the reservation back when the model call fails", async () => {
    const failing = fakeImageModel({ failWith: new Error("boom") });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), failing);
    const photoAssetId = await uploadPhoto(app);

    await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal((await readUsage(app)).monthUsd, 0);
  });

  it("keeps the booking when the call times out, because the provider may still bill it", async () => {
    const timedOut = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), fakeImageModel({ failWith: timedOut }));
    const photoAssetId = await uploadPhoto(app);

    await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal((await readUsage(app)).monthUsd, 0.0336);
  });

  it("keeps the booking when the call is cancelled after it was sent", async () => {
    const cancelled = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), fakeImageModel({ failWith: cancelled }));
    const photoAssetId = await uploadPhoto(app);

    await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal((await readUsage(app)).monthUsd, 0.0336);
  });
});
