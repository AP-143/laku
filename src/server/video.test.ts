import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";
import { probeVideo } from "./testing/probe-video";

/** Feature 3 through the chat API: a silent video made from the storyboard frames, with the length the seller asks for. */

type App = ReturnType<typeof createTestApp>;

async function uploadPhoto(app: App): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

/** The four storyboard frames, as the seller would have them (here, four stored images). */
async function uploadFrames(app: App): Promise<string[]> {
  return Promise.all([1, 2, 3, 4].map(() => uploadPhoto(app)));
}

const videoRequest = (text: string, frames: string[], extra: object = {}) =>
  chatRequest({ messages: [{ role: "user", text }], frames, ...extra });

const finishedVideo = (events: ChatEvent[]) =>
  events.find((event) => event.type === "asset_ready" && event.kind === "video");

function errorOf(events: ChatEvent[]) {
  const last = events.at(-1);
  return last?.type === "error" ? last : undefined;
}

async function usageOf(app: App) {
  return (await (await app.usage(new Request("http://localhost/api/usage"))).json()) as { monthUsd: number };
}

describe("video from the storyboard", () => {
  it("makes a silent video of the length asked for, from the frames in order, and books the cost per second", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("bikinin video iklan 10 detik dari storyboard", frames)));

    // Two clips, 6 s and 4 s, from the first two frames.
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
    for (const [index, call] of app.videoModel.calls.entries()) {
      const stored = await app.store.read(frames[index], "resized");
      assert.deepEqual(Buffer.from(call.frame.bytes), Buffer.from(stored!.bytes));
    }

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "video");
    assert.equal(ready.url, `/api/assets/${ready.assetId}`);
    assert.equal(ready.sourceAssetId, frames[0]);

    // The stored file is one 9:16 MP4 of about the length asked for, with the audio of the model dropped.
    const file = await app.store.read(ready.assetId, "original");
    assert.equal(file?.mediaType, "video/mp4");
    const probe = await probeVideo(file!.bytes);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);
    assert.equal(probe.hasAudio, false);

    assert.equal(events.some((event) => event.type === "job_started" && event.kind === "video"), true);
    assert.equal(events.filter((event) => event.type === "job_progress").length, 2);
    assert.deepEqual(events.findLast((event) => event.type === "usage_updated"), { type: "usage_updated", monthUsd: 1, budgetUsd: 4 });
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes 10 seconds when the seller names no length", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO" }));
    const frames = await uploadFrames(app);

    await readEvents(await app.chat(videoRequest("bikinin video dong", frames)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
  });

  it("raises a length that is shorter than the shortest clip", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 2 }));
    const frames = await uploadFrames(app);

    await readEvents(await app.chat(videoRequest("video 2 detik", frames)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [4]);
  });

  it("works from the video shortcut chip as well as from typed words", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 4 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 4 detik", frames, { intent: "video" })));

    assert.ok(finishedVideo(events));
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [4]);
  });

  it("refuses a length the storyboard cannot cover, says the most it can, and spends nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 40 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 40 detik", frames)));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /32 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("asks for a storyboard first when there are no frames", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(await app.chat(chatRequest({ messages: [{ role: "user", text: "video 10 detik" }], intent: "video" })));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /storyboard/i);
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("refuses frames that are not a product, before anything is generated", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", isProduct: false }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });
});

describe("video spending", () => {
  it("refuses up front when the budget cannot cover the video and says how many seconds it can", async () => {
    // US$1.50 spent today: US$0.50 is left of the day, which is 5 seconds.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { startingTodayUsd: 1.5 });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    const error = errorOf(events);
    assert.match(error?.message ?? "", /5 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 1.5);
  });

  it("uses the daily cap message when not even the shortest clip is affordable", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { startingTodayUsd: 1.9 });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(errorOf(events)?.code, "daily_cap_reached");
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("gives back the clips that were not made when one fails, and keeps the ones that were", async () => {
    const failing = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: failing });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(errorOf(events)?.type, "error");
    assert.equal(finishedVideo(events), undefined);
    // The 6 s clip was made (US$0.60); the 4 s clip failed and is given back.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
  });

  it("keeps the booking of a clip that timed out, because it may still be billed", async () => {
    const timedOut = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const failing = fakeVideoModel({ failOnClip: 0, failWith: timedOut });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: failing });
    const frames = await uploadFrames(app);

    await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    // The first clip (6 s, US$0.60) stays booked; the clip that never started (4 s) is given back.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
  });
});
