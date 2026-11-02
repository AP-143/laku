import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeChatModel } from "./testing/fake-models";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** The usage meter: a local estimate of this month's spend against the US$5 free credit. */

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

    assert.deepEqual(await readUsage(app), { monthUsd: 0, budgetUsd: 5, remainingUsd: 5 });
  });

  it("adds an estimated cost for every generated image and reports it in the stream", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const photoAssetId = await uploadPhoto(app);

    const first = await readEvents(await app.chat(studioRequest(photoAssetId)));
    const second = await readEvents(await app.chat(studioRequest(photoAssetId)));

    assert.deepEqual(first.find((e) => e.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.04, budgetUsd: 5 });
    assert.deepEqual(second.find((e) => e.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.08, budgetUsd: 5 });
    assert.deepEqual(await readUsage(app), { monthUsd: 0.08, budgetUsd: 5, remainingUsd: 4.92 });
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
    assert.equal((await readUsage(app)).monthUsd, 0.04);

    app.clock.now = new Date("2026-11-01T12:00:00Z");

    assert.equal((await readUsage(app)).monthUsd, 0);
  });

  it("refuses to generate once the free credit is used up and calls no model", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingMonthUsd: 4.99 });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(studioRequest(photoAssetId)));

    const error = events.at(-1);
    assert.equal(error?.type, "error");
    assert.match(error?.type === "error" ? error.message : "", /kuota/i);
    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "done"), false);
  });
});
