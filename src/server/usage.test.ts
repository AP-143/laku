import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeChatModel } from "./testing/fake-models";
import { fakeImageModel } from "./testing/fake-image-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** The usage meter: a local estimate of this month's spend against the prepaid US$4 balance. */

async function uploadPhoto(app: ReturnType<typeof createTestApp>): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const studioRequest = (photoAssetId: string) =>
  chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "studio_photo" });

async function readUsage(app: ReturnType<typeof createTestApp>) {
  return (await app.usage(new Request("http://localhost/api/usage"))).json() as Promise<{
    monthUsd: number;
    budgetUsd: number;
    remainingUsd: number;
  }>;
}

describe("usage meter", () => {
  it("starts empty with the whole free credit left", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    assert.deepEqual(await readUsage(app), { monthUsd: 0, budgetUsd: 4, remainingUsd: 4 });
  });

  it("adds an estimated cost for every generated image and reports it in the stream", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const photoAssetId = await uploadPhoto(app);

    const first = await readEvents(await app.chat(studioRequest(photoAssetId)));
    const second = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.deepEqual(first.find((e) => e.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.0336, budgetUsd: 4 });
    assert.deepEqual(second.find((e) => e.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.0672, budgetUsd: 4 });
    assert.deepEqual(await readUsage(app), { monthUsd: 0.0672, budgetUsd: 4, remainingUsd: 3.9328 });
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

  it("refuses to generate once the free credit is used up and calls no model", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingMonthUsd: 3.99 });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    const error = events.at(-1);
    assert.equal(error?.type, "error");
    assert.match(error?.type === "error" ? error.message : "", /kuota/i);
    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "done"), false);
  });
});

describe("daily spend cap", () => {
  it("refuses once today's spend would pass US$2, names what is left and when it resets, and calls no model", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 1.99 });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    const error = events.at(-1);
    assert.equal(error?.type === "error" && error.code, "daily_cap_reached");
    const message = error?.type === "error" ? error.message : "";
    assert.match(message, /hari ini/i);
    assert.match(message, /US\$2\.01/); // what is left of this month's US$4
    assert.match(message, /07\.00 WIB/); // the day follows UTC, so it resets at 00:00 UTC
    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "done"), false);
  });

  it("only counts today: spend from earlier days of the month does not use up the day", async () => {
    // US$3 spent on the 1st is over the daily cap, but not today's spend.
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingMonthUsd: 3 });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal(events.some((e) => e.type === "asset_ready" && e.role === "studio_photo"), true);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("starts the day again from zero at midnight UTC", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 1.99 });
    const photoAssetId = await uploadPhoto(app);
    const refused = await readEvents(await app.chat(studioRequest(photoAssetId)));
    assert.equal(refused.at(-1)?.type === "error" && (refused.at(-1) as { code?: string }).code, "daily_cap_reached");

    app.clock.now = new Date("2026-11-16T00:00:01Z");
    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal(events.some((e) => e.type === "asset_ready" && e.role === "studio_photo"), true);
  });

  it("never lets simultaneous requests pass the cap together", async () => {
    // Room for exactly one more image (US$0.0336 of the US$2 daily cap).
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 1.95 });
    const photoAssetId = await uploadPhoto(app);

    const turns = await Promise.all(
      [1, 2, 3].map(async () => readEvents(await app.chat(studioRequest(photoAssetId)))),
    );

    assert.equal(app.imageModel.calls.length, 1);
    assert.equal(turns.filter((events) => events.some((e) => e.type === "asset_ready")).length, 1);
  });

  it("gives a failed call's reservation back to today's total too", async () => {
    // Room for exactly one image today; if the failed call kept its booking, the second request would be refused.
    const failing = fakeImageModel({ failWith: new Error("boom") });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), failing, { startingTodayUsd: 1.96 });
    const photoAssetId = await uploadPhoto(app);

    const first = await readEvents(await app.chat(studioRequest(photoAssetId)));
    const second = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal(app.imageModel.calls.length, 2);
    for (const events of [first, second]) {
      assert.notEqual(events.at(-1)?.type === "error" && (events.at(-1) as { code?: string }).code, "daily_cap_reached");
    }
  });
});

describe("usage meter under concurrent requests", () => {
  it("never lets simultaneous requests pass the free credit together", async () => {
    // Room for exactly one more image (US$0.0336 of the US$4 budget).
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingMonthUsd: 3.95 });
    const photoAssetId = await uploadPhoto(app);

    const turns = await Promise.all(
      [1, 2, 3].map(async () => readEvents(await app.chat(studioRequest(photoAssetId)))),
    );

    assert.equal(app.imageModel.calls.length, 1);
    assert.equal(turns.filter((events) => events.some((e) => e.type === "asset_ready")).length, 1);
  });

  it("gives the reservation back when the model call fails", async () => {
    const failing = fakeImageModel({ failWith: new Error("boom") });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), failing);
    const photoAssetId = await uploadPhoto(app);

    await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.equal((await readUsage(app)).monthUsd, 0);
  });
});
