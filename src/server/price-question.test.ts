import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/**
 * The Price question on the image paths: a studio photo, a studio photo revised in chat, a Storyboard picture and every
 * "Coba lagi" of a picture is asked about first, and nothing is spent until the seller says yes. (The Video's price
 * question is in video-feature.test.ts.)
 */

const SCENES = ["Scene satu", "Scene dua", "Scene tiga"];

type App = ReturnType<typeof createTestApp>;

async function uploadPhoto(app: App): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const question = (events: ChatEvent[]) => events.find((event) => event.type === "confirmation_requested");
const madeImage = (events: ChatEvent[]) => events.some((event) => event.type === "asset_ready");

/** Each way the seller can make a picture, as a request that has not been agreed to yet. */
const REQUESTS: Array<[string, (photo: string) => object, Parameters<typeof fakeChatModel>[0]]> = [
  [
    "a studio photo",
    (photo) => ({ messages: [{ role: "user", text: "", photoAssetId: photo }], intent: "studio_photo" }),
    { chunks: ["x"] },
  ],
  [
    "a studio photo revised in chat",
    (photo) => ({ messages: [{ role: "user", text: "ganti backdrop jadi biru" }], lastImageAssetId: photo }),
    { chunks: ["x"], intent: "REVISE" },
  ],
  [
    "a storyboard picture",
    (photo) => ({ messages: [{ role: "user", text: "bikin storyboard", photoAssetId: photo }], intent: "storyboard" }),
    { chunks: ["x"], scenes: SCENES },
  ],
  [
    "a storyboard picture drawn again",
    (photo) => ({ messages: [{ role: "user", text: "Coba lagi." }], redraw: { photoAssetId: photo, scenes: SCENES } }),
    { chunks: ["x"], scenes: SCENES },
  ],
];

describe("the price of a picture", () => {
  for (const [name, request, modelOptions] of REQUESTS) {
    it(`is asked first for ${name}, and nothing is made until the seller says yes`, async () => {
      const chat = fakeChatModel(modelOptions);
      const app = createTestApp(chat);
      const photo = await uploadPhoto(app);

      const asked = await readEvents(await app.chat(chatRequest({ ...request(photo), confirmedUsd: null })));

      const ask = question(asked);
      assert.ok(ask && ask.type === "confirmation_requested");
      assert.equal(ask.estimatedUsd, 0.0336);
      assert.match(ask.message, /US\$0\.03/);
      assert.match(ask.message, /Rp/);
      assert.equal(app.imageModel.calls.length, 0);
      assert.equal(madeImage(asked), false);
      assert.deepEqual(asked.at(-1), { type: "done" });

      const agreed = await readEvents(await app.chat(chatRequest({ ...request(photo), confirmedUsd: ask.estimatedUsd })));

      assert.equal(question(agreed), undefined);
      assert.equal(app.imageModel.calls.length, 1);
      assert.ok(madeImage(agreed));
    });

    it(`is asked again for ${name} when the yes was for a lower price`, async () => {
      const app = createTestApp(fakeChatModel(modelOptions));
      const photo = await uploadPhoto(app);

      const events = await readEvents(await app.chat(chatRequest({ ...request(photo), confirmedUsd: 0.01 })));

      assert.ok(question(events));
      assert.equal(app.imageModel.calls.length, 0);
    });
  }

  it("is one short line: what is made, the price in dollars and a rough price in rupiah", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], scenes: SCENES }));
    const photo = await uploadPhoto(app);
    const ask = async (request: object) => {
      const events = await readEvents(await app.chat(chatRequest({ ...request, confirmedUsd: null })));
      const asked = question(events);
      return asked && asked.type === "confirmation_requested" ? asked.message : undefined;
    };

    assert.equal(
      await ask({ messages: [{ role: "user", text: "", photoAssetId: photo }], intent: "studio_photo" }),
      "Foto studio · US$0.03 (sekitar Rp600)",
    );
    assert.equal(
      await ask({ messages: [{ role: "user", text: "Coba lagi." }], redraw: { photoAssetId: photo, scenes: SCENES } }),
      "Gambar storyboard (ulang) · US$0.03 (sekitar Rp600)",
    );
    assert.equal(
      await ask({ messages: [{ role: "user", text: "video 10 detik", photoAssetId: photo }], intent: "video" }),
      "Video 10 detik · US$1.00 (sekitar Rp18.200)",
    );
  });

  it("plans nothing for a storyboard until the seller says yes", async () => {
    const chat = fakeChatModel({ chunks: ["x"], scenes: SCENES });
    const app = createTestApp(chat);
    const photo = await uploadPhoto(app);

    const asked = await readEvents(
      await app.chat(
        chatRequest({ messages: [{ role: "user", text: "bikin storyboard", photoAssetId: photo }], intent: "storyboard", confirmedUsd: null }),
      ),
    );

    assert.ok(question(asked));
    assert.equal(asked.some((event) => event.type === "storyboard_scenes"), false);
    assert.equal(chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]")).length, 0);
  });

  it("is not asked when there is nothing to make a picture from", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "foto studio dong" }], intent: "studio_photo", confirmedUsd: null })),
    );

    assert.equal(question(events), undefined);
    assert.equal(events.some((event) => event.type === "assistant_text"), true);
  });
});
