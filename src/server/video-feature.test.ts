import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/**
 * Video as a Feature of its own through the chat API: the seller picks it, attaches a Storyboard picture they already
 * have, and says in their own words what video they want. The words and the picture go to the video model as they are
 * and the model decides the rest.
 */

type App = ReturnType<typeof createTestApp>;

/** A stored storyboard picture, as the seller attaches it to a message. */
async function attachStoryboard(app: App): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg", 800, 600, "#cc3333"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const finishedVideo = (events: ChatEvent[]) =>
  events.find((event) => event.type === "asset_ready" && event.kind === "video");

const replyText = (events: ChatEvent[]) =>
  events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");

const monthUsd = async (app: App) =>
  ((await (await app.usage(new Request("http://localhost/api/usage"))).json()) as { monthUsd: number }).monthUsd;

/** A request to make a video that the seller has already said yes to, for up to `confirmedUsd`. */
const video = (picture: string, text: string, extra: Record<string, unknown> = {}) =>
  chatRequest({ messages: [{ role: "user", text, photoAssetId: picture }], intent: "video", confirmedUsd: 10, ...extra });

describe("video as a feature of its own", () => {
  it("makes the whole video in one call from the storyboard picture attached to the message", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(await app.chat(video(picture, "buatkan video iklan 10 detik layaknya editan profesional dari storyboard ini")));

    assert.equal(app.videoModel.calls.length, 1);
    const [call] = app.videoModel.calls;
    assert.equal(call.seconds, 10);
    assert.deepEqual(Buffer.from(call.frame.bytes), Buffer.from((await app.store.read(picture, "resized"))!.bytes));

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "video");
    assert.equal(ready.sourceAssetId, picture);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("gives the video model the seller's words exactly as typed, and nothing of ours", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const picture = await attachStoryboard(app);
    const words = "buatkan video iklan 10 detik layaknya editan profesional dari storyboard ini";

    await readEvents(await app.chat(video(picture, words)));

    assert.equal(app.videoModel.calls[0].prompt, words);
  });

  it("gives the video model only the picture when the seller typed nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId: picture }], intent: "video", confirmedUsd: 10 })),
    );

    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls[0].prompt, undefined);
    assert.equal(app.videoModel.calls[0].seconds, 10);
  });

  it("asks the text model nothing about the video except whether the picture shows a product", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const picture = await attachStoryboard(app);

    await readEvents(await app.chat(video(picture, "video santai dan hangat")));

    const tasks = chat.doGenerateCalls.map((call) => JSON.stringify(call.prompt).match(/\[task: ([a-z-]+)\]/)?.[1]);
    assert.deepEqual(tasks, ["frame-check"]);
  });

  it("makes the length the seller names, and the nearest one that is not longer when it is between two", async () => {
    for (const [words, seconds] of [
      ["video 20 detik", 20],
      ["video 30s", 30],
      ["video 15 detik", 10],
      ["video 25 sec", 20],
    ] as const) {
      const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
      const picture = await attachStoryboard(app);

      await readEvents(await app.chat(video(picture, words)));

      assert.equal(app.videoModel.calls[0].seconds, seconds, words);
    }
  });

  it("makes the shortest video when the words name no length, or only a time that is not a video length", async () => {
    for (const words of ["bikinin video iklan", "teks muncul 3 detik di video"]) {
      const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
      const picture = await attachStoryboard(app);

      await readEvents(await app.chat(video(picture, words)));

      assert.equal(app.videoModel.calls[0].seconds, 10, words);
    }
  });

  it("accepts an attached storyboard that shows a person using the product, since that is a normal ad picture", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], peopleInPictures: true }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(await app.chat(video(picture, "bikinin video iklan")));

    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 1);
  });

  it("refuses an attached picture that shows no product, before the video is made, and books nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], isProduct: false }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(await app.chat(video(picture, "bikinin video iklan")));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal(await monthUsd(app), 0);
  });

  it("does not borrow a storyboard picture the browser sends along: with nothing attached it asks for one", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const borrowed = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan" }], intent: "video", sheet: borrowed })),
    );

    assert.equal(app.videoModel.calls.length, 0);
    assert.match(replyText(events), /lampirkan/i);
  });

  it("does not make a video from a photo when the router guesses a video but the Video feature was not picked", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO" }));
    const photo = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video dong", photoAssetId: photo }] })),
    );

    assert.equal(app.videoModel.calls.length, 0);
    assert.match(replyText(events), /fitur Video/);
  });

  it("asks the seller to attach a storyboard picture when the video is asked for with nothing attached", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan" }], intent: "video" })),
    );

    const text = replyText(events);
    assert.match(text, /lampirkan/i);
    assert.match(text, /storyboard/i);
    assert.equal(app.videoModel.calls.length, 0);
  });
});

describe("the price of a video", () => {
  it("is always asked first, whatever the length, and nothing is spent until the seller says yes", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const picture = await attachStoryboard(app);
    const request = { messages: [{ role: "user", text: "video 20 detik", photoAssetId: picture }], intent: "video" };

    const asked = await readEvents(await app.chat(chatRequest(request)));

    const ask = asked.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 2);
    assert.match(ask.message, /20 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(asked), undefined);
    assert.equal(await monthUsd(app), 0);

    const agreed = await readEvents(await app.chat(chatRequest({ ...request, confirmedUsd: ask.estimatedUsd })));

    assert.ok(finishedVideo(agreed));
    assert.equal(app.videoModel.calls[0].seconds, 20);
    assert.equal(await monthUsd(app), 2);
  });

  it("is asked again when the same request would now cost more than the price the seller said yes to", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(await app.chat(video(picture, "video 30 detik", { confirmedUsd: 1 })));

    const ask = events.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 3);
    assert.equal(app.videoModel.calls.length, 0);
  });
});

describe("a video that fails", () => {
  it("is never tried again by itself, gives the booking back, and says it failed", async () => {
    const videoModel = fakeVideoModel({ failWith: new Error("fake video failure") });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { videoModel });
    const picture = await attachStoryboard(app);

    const events = await readEvents(await app.chat(video(picture, "video 20 detik")));

    assert.equal(videoModel.calls.length, 1);
    assert.equal(finishedVideo(events), undefined);
    assert.ok(events.some((event) => event.type === "error"));
    assert.equal(await monthUsd(app), 0);
  });

  it("stays booked when the call timed out, because it may still be billed", async () => {
    const videoModel = fakeVideoModel({ failWith: Object.assign(new Error("took too long"), { name: "TimeoutError" }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { videoModel });
    const picture = await attachStoryboard(app);

    const events = await readEvents(await app.chat(video(picture, "video 20 detik")));

    assert.ok(events.some((event) => event.type === "error"));
    assert.equal(await monthUsd(app), 2);
  });
});

describe("what the app tells the video model", () => {
  it("is logged, and is only the seller's words", async () => {
    const lines: string[] = [];
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { log: (message) => lines.push(message) });
    const picture = await attachStoryboard(app);

    await readEvents(await app.chat(video(picture, "video iklan 10 detik")));

    assert.deepEqual(lines, ["[video 10s] prompt: video iklan 10 detik"]);
  });
});
