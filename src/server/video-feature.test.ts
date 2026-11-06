import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/**
 * Video as a Feature of its own through the chat API: the seller picks it, attaches a Storyboard picture they already
 * have, and asks for the video. No storyboard has to be made in the same chat first.
 */

type App = ReturnType<typeof createTestApp>;

/** A stored storyboard picture, as the seller attaches it to a message. */
async function attachStoryboard(app: App): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg", 800, 600, "#cc3333"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const finishedVideo = (events: ChatEvent[]) =>
  events.find((event) => event.type === "asset_ready" && event.kind === "video");

describe("video as a feature of its own", () => {
  it("makes the video from the storyboard picture attached to the message, with no storyboard made in this chat", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10 }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan dari storyboard ini", photoAssetId: picture }], intent: "video", confirmedUsd: 1 })),
    );

    // Every clip starts from the attached picture.
    const stored = Buffer.from((await app.store.read(picture, "resized"))!.bytes);
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
    for (const call of app.videoModel.calls) assert.deepEqual(Buffer.from(call.frame.bytes), stored);

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "video");
    assert.equal(ready.sourceAssetId, picture);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes the video from the attached picture, not from a storyboard the browser borrowed from another chat", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10 }));
    const attached = await attachStoryboard(app);
    const [other] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg", 800, 600, "#3366cc"))));
    const borrowed = other.type === "asset_ready" ? other.assetId : "";

    const events = await readEvents(
      await app.chat(
        chatRequest({ messages: [{ role: "user", text: "bikinin video iklan", photoAssetId: attached }], intent: "video", sheet: borrowed, confirmedUsd: 1 }),
      ),
    );

    const stored = Buffer.from((await app.store.read(attached, "resized"))!.bytes);
    for (const call of app.videoModel.calls) assert.deepEqual(Buffer.from(call.frame.bytes), stored);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.sourceAssetId, attached);
  });

  it("accepts an attached storyboard that shows a person using the product, since that is a normal ad picture", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10, peopleInPictures: true }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan", photoAssetId: picture }], intent: "video", confirmedUsd: 1 })),
    );

    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 2);
  });

  it("refuses an attached picture that shows no product, before any clip is made, and books nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], isProduct: false }));
    const picture = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan", photoAssetId: picture }], intent: "video", confirmedUsd: 1 })),
    );

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    const usage = (await (await app.usage(new Request("http://localhost/api/usage"))).json()) as { monthUsd: number };
    assert.equal(usage.monthUsd, 0);
  });

  it("always asks the price first, even for a short video, and makes exactly the plan that was priced after a yes", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10 }));
    const picture = await attachStoryboard(app);
    const request = { messages: [{ role: "user", text: "bikinin video iklan", photoAssetId: picture }], intent: "video" };

    const asked = await readEvents(await app.chat(chatRequest(request)));

    const ask = asked.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 1);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(asked), undefined);

    const agreed = await readEvents(await app.chat(chatRequest({ ...request, confirmedUsd: ask.estimatedUsd, videoChoice: ask.videoChoice })));

    assert.ok(finishedVideo(agreed));
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
  });

  it("plans the video from the attached picture and the words typed now, and from nothing an older page still sends", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 10 });
    const app = createTestApp(chat);
    const picture = await attachStoryboard(app);

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "santai dan hangat", photoAssetId: picture }],
          intent: "video",
          confirmedUsd: 1,
          // What the storyboard used to hand over to the video: none of it is read any more.
          scenes: ["Scene satu di dapur", "b", "c", "d", "e", "f"],
          artDirection: "Night-time neon palette of electric blue and magenta.",
          brief: "storyboard dan video 30 detik",
          video: true,
        }),
      ),
    );

    const planned = chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.equal(planned.length, 1);
    const prompt = JSON.stringify(planned[0].prompt);
    assert.ok(prompt.includes("santai dan hangat"));
    for (const handedOver of ["Scene satu di dapur", "Night-time neon", "30 detik"]) assert.ok(!prompt.includes(handedOver), handedOver);
    // The 30 seconds of the old first request do not decide the length: the planner does.
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
  });

  it("does not borrow a storyboard picture the browser sends along: with nothing attached it asks for one", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const borrowed = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan" }], intent: "video", sheet: borrowed })),
    );

    assert.equal(app.videoModel.calls.length, 0);
    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /lampirkan/i);
  });

  it("does not make a video from a photo when the router guesses a video but the Video feature was not picked", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO" }));
    const photo = await attachStoryboard(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video dong", photoAssetId: photo }] })),
    );

    assert.equal(app.videoModel.calls.length, 0);
    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /fitur Video/);
  });

  it("asks the seller to attach a storyboard picture when the video is asked for with nothing attached", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin video iklan" }], intent: "video" })),
    );

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /lampirkan/i);
    assert.match(text, /storyboard/i);
    assert.equal(app.videoModel.calls.length, 0);
  });
});
