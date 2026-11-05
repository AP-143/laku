import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** Feature 2 through the chat API: four scenes as text first, frames only after the seller approves. */

const SCENES = ["Scene satu di dapur", "Scene dua di meja", "Scene tiga di taman", "Scene empat di rak toko"];

async function uploadPhoto(app: ReturnType<typeof createTestApp>): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const proposed = (events: ChatEvent[]) => events.find((e) => e.type === "storyboard_scenes");
const frames = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === "asset_ready" && e.role === "storyboard_frame" ? [e] : []));

function newApp(extra: Partial<Parameters<typeof fakeChatModel>[0]> = {}) {
  return createTestApp(fakeChatModel({ chunks: ["unused"], scenes: SCENES, ...extra }));
}

describe("storyboard", () => {
  it("proposes exactly four scenes and generates no image before approval", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "storyboard" })),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.deepEqual(plan.scenes, SCENES);
    assert.equal(plan.sourceAssetId, photoAssetId);
    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "job_started" || e.type === "asset_ready"), false);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("says its words before the scene card, so the card with the approve button is the last thing in the chat", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "storyboard" })),
    );

    assert.deepEqual(
      events.map((e) => e.type),
      ["assistant_text", "storyboard_scenes", "done"],
    );
  });

  it("starts from a typed request and an already finished studio photo", async () => {
    const app = newApp({ intent: "STORYBOARD" });
    const studioPhotoId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({ messages: [{ role: "user", text: "bikinin storyboard 4 scene dong", photoAssetId: studioPhotoId }] }),
      ),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.equal(plan.scenes.length, 4);
    assert.equal(app.imageModel.calls.length, 0);
  });

  it("replaces only the scene the seller asks to change", async () => {
    const app = newApp({ intent: "EDIT_SCENE", replacement: { scene: 3, text: "Scene tiga baru di pantai" } });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "ganti scene 3 jadi di pantai" }],
          storyboard: { photoAssetId, scenes: SCENES },
        }),
      ),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.deepEqual(plan.scenes, [SCENES[0], SCENES[1], "Scene tiga baru di pantai", SCENES[3]]);
    assert.equal(app.imageModel.calls.length, 0);
  });

  it("generates four frames of the same product after approval, in order, and records each", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju, buatkan gambarnya" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: {},
        }),
      ),
    );

    const made = frames(events);
    assert.deepEqual(made.map((f) => f.sceneIndex), [0, 1, 2, 3]);
    assert.ok(made.every((f) => f.sourceAssetId === photoAssetId));
    assert.equal(app.imageModel.calls.length, 4);
    // Every frame starts from the same product photo, which keeps the product consistent.
    const reference = Buffer.from((await app.store.read(photoAssetId, "resized"))!.bytes);
    for (const call of app.imageModel.calls) {
      const file = call.files?.[0];
      assert.deepEqual(Buffer.from(file && file.type === "file" ? (file.data as Uint8Array) : []), reference);
    }
    SCENES.forEach((scene, index) => assert.match(app.imageModel.calls[index].prompt ?? "", new RegExp(scene)));
    assert.ok(events.some((e) => e.type === "job_progress"));
    const lastUsage = events.findLast((e) => e.type === "usage_updated");
    assert.equal(lastUsage?.type === "usage_updated" && lastUsage.monthUsd, 0.1344);
    // Frames are vertical (9:16) so they can feed a vertical video later.
    assert.ok(app.imageModel.calls.every((call) => call.aspectRatio === "9:16"));
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("tells the image model not to draw scene labels or captions the scene did not ask for", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju, buatkan gambarnya" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: { sceneIndex: 1 },
        }),
      ),
    );

    // A real run once drew "SCENE 3 - CLOSE ON ..." inside a frame, which is not part of an ad picture.
    assert.match(app.imageModel.calls[0].prompt ?? "", /do not write scene numbers|no scene numbers/i);
  });

  it("generates the four frames when the seller types their approval while the storyboard is open", async () => {
    const app = newApp({ intent: "APPROVE" });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "oke setuju" }],
          storyboard: { photoAssetId, scenes: SCENES },
        }),
      ),
    );

    assert.deepEqual(frames(events).map((f) => f.sceneIndex), [0, 1, 2, 3]);
    assert.equal(app.imageModel.calls.length, 4);
    SCENES.forEach((scene, index) => assert.match(app.imageModel.calls[index].prompt ?? "", new RegExp(scene)));
    assert.equal(events.some((e) => e.type === "assistant_text"), false);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("does not generate anything for an approval when there is no storyboard to approve", async () => {
    const app = newApp({ intent: "APPROVE" });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "oke setuju" }], lastImageAssetId: photoAssetId })),
    );

    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(frames(events).length, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("uses the scene text the seller edited before approving", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);
    const edited = [...SCENES.slice(0, 3), "Scene empat yang kuedit sendiri"];

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju" }],
          storyboard: { photoAssetId, scenes: edited },
          approve: {},
        }),
      ),
    );

    assert.match(app.imageModel.calls[3].prompt ?? "", /kuedit sendiri/);
  });

  it("retries a single frame without touching the other three", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Ulangi scene 2" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: { sceneIndex: 1 },
        }),
      ),
    );

    const made = frames(events);
    assert.equal(made.length, 1);
    assert.equal(made[0].sceneIndex, 1);
    assert.equal(app.imageModel.calls.length, 1);
    assert.match(app.imageModel.calls[0].prompt ?? "", /Scene dua/);
  });

  it("stops at the first failed frame, keeps the finished ones and does not retry", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);
    const original = app.imageModel.doGenerate;
    let count = 0;
    app.imageModel.doGenerate = async (options) => {
      if (++count === 3) {
        app.imageModel.calls.push(options);
        throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
      }
      return original(options);
    };

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: {},
        }),
      ),
    );

    assert.equal(frames(events).length, 2);
    assert.equal(app.imageModel.calls.length, 3);
    const last = events.at(-1);
    assert.equal(last?.type === "error" && last.code, "rate_limited");
  });

  it("rejects an approval whose scenes are not exactly four", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(
      chatRequest({
        messages: [{ role: "user", text: "Setuju" }],
        storyboard: { photoAssetId, scenes: SCENES.slice(0, 3) },
        approve: {},
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(app.imageModel.calls.length, 0);
  });
});

describe("product gate on every paid path", () => {
  it("refuses to generate frames from a photo that is not a product, even without attaching it", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], scenes: SCENES, isProduct: false }));
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: {},
        }),
      ),
    );

    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "job_started" || e.type === "asset_ready"), false);
    assert.match(events.flatMap((e) => (e.type === "assistant_text" ? [e.text] : [])).join(""), /foto produk/i);
  });

  it("refuses to revise an image that is not a product", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "REVISE", isProduct: false }));
    const lastImageAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "lebih terang" }], lastImageAssetId })),
    );

    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "asset_ready"), false);
  });
});
