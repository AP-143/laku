import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeChatModel } from "./testing/fake-models";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** Feature 1 through the chat API: a product photo and a style in, a studio photo out. */

async function uploadPhoto(app: ReturnType<typeof createTestApp>): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

describe("studio photo", () => {
  it("turns a product photo and a style preset into a studio photo shown next to the original", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(
      chatRequest({
        messages: [{ role: "user", text: "", photoAssetId }],
        intent: "studio_photo",
        style: { preset: "clean_white" },
      }),
    );
    const events = await readEvents(response);

    const ready = events.find((event) => event.type === "asset_ready");
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "studio_photo");
    assert.equal(ready.sourceAssetId, photoAssetId);
    assert.notEqual(ready.assetId, photoAssetId);
    assert.equal(app.imageModel.calls.length, 1);
    assert.deepEqual(events.at(-1), { type: "done" });

    // The result is fetchable through the asset store, next to the original it came from.
    assert.ok(await app.store.read(ready.assetId, "original"));
    assert.ok(await app.store.read(photoAssetId, "original"));
  });
});

describe("studio photo from free text", () => {
  it("understands a typed request with a photo, without any chip", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"], intent: "STUDIO" }));
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin foto studio dong, background pink", photoAssetId }] })),
    );

    const ready = events.find((event) => event.type === "asset_ready");
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "studio_photo");
    assert.equal(app.imageModel.calls.length, 1);
    // The seller's own words become the style.
    assert.match(app.imageModel.calls[0].prompt ?? "", /background pink/);
  });

  it("just chats when the typed message is not a request for a studio photo", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["Boleh, tanya aja."], intent: "CHAT" }));
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "ini produk apa ya?", photoAssetId }] })),
    );

    assert.equal(events.some((event) => event.type === "asset_ready"), false);
    assert.equal(app.imageModel.calls.length, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });
});

describe("studio photo details", () => {
  const studioRequest = (photoAssetId: string, extra: object = {}) =>
    chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "studio_photo", ...extra });

  it("asks for a different look per preset", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));
    const photoAssetId = await uploadPhoto(app);

    for (const preset of ["clean_white", "solid_color", "lifestyle"]) {
      await readEvents(await app.chat(studioRequest(photoAssetId, { style: { preset } })));
    }

    const prompts = app.imageModel.calls.map((call) => call.prompt);
    assert.equal(new Set(prompts).size, 3);
    assert.match(prompts[0] ?? "", /white/i);
    assert.match(prompts[1] ?? "", /colou?r/i);
    assert.match(prompts[2] ?? "", /lifestyle/i);
  });

  it("tells the image model not to change the product", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));
    const photoAssetId = await uploadPhoto(app);

    await readEvents(await app.chat(studioRequest(photoAssetId, { style: { text: "di atas meja kayu" } })));

    const prompt = app.imageModel.calls[0].prompt ?? "";
    for (const part of ["shape", "colour", "logo", "label text"]) assert.match(prompt, new RegExp(part));
    assert.match(prompt, /meja kayu/);
  });

  it("asks the image model for a square photo made from the seller's photo", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));
    const photoAssetId = await uploadPhoto(app);

    await readEvents(await app.chat(studioRequest(photoAssetId, { style: { preset: "clean_white" } })));

    assert.equal(app.imageModel.calls[0].aspectRatio, "1:1");
    assert.equal(app.imageModel.calls[0].files?.length, 1);
  });

  it("makes a new version on retry and keeps the earlier one", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));
    const photoAssetId = await uploadPhoto(app);

    const first = (await readEvents(await app.chat(studioRequest(photoAssetId)))).find((e) => e.type === "asset_ready");
    const second = (await readEvents(await app.chat(studioRequest(photoAssetId)))).find((e) => e.type === "asset_ready");

    assert.ok(first?.type === "asset_ready" && second?.type === "asset_ready");
    assert.notEqual(first.assetId, second.assetId);
    assert.ok(await app.store.read(first.assetId, "original"));
    assert.equal(app.imageModel.calls.length, 2);
  });

  it("revises the previous result when the seller asks for a change in chat", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"], intent: "REVISE" }));
    const photoAssetId = await uploadPhoto(app);
    const made = (await readEvents(await app.chat(studioRequest(photoAssetId)))).find((e) => e.type === "asset_ready");
    assert.ok(made?.type === "asset_ready");

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "background-nya lebih terang" }],
          lastImageAssetId: made.assetId,
        }),
      ),
    );

    const revised = events.find((e) => e.type === "asset_ready");
    assert.ok(revised?.type === "asset_ready");
    assert.equal(revised.role, "studio_photo");
    assert.equal(revised.sourceAssetId, made.assetId);
    assert.equal(app.imageModel.calls.length, 2);
    assert.match(app.imageModel.calls[1].prompt ?? "", /lebih terang/);
    // The previous result, not the first photo, is what gets revised.
    const sent = app.imageModel.calls[1].files?.[0];
    const previous = await app.store.read(made.assetId, "resized");
    assert.deepEqual(Buffer.from(sent && sent.type === "file" ? (sent.data as Uint8Array) : []), Buffer.from(previous!.bytes));
  });

  it("asks for a photo first when a studio photo is requested without one", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "foto studio" }], intent: "studio_photo" })),
    );

    assert.match(events.flatMap((e) => (e.type === "assistant_text" ? [e.text] : [])).join(""), /unggah|kirim.*foto/i);
    assert.equal(app.imageModel.calls.length, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("says video is not available yet instead of generating anything", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["unused"] }));
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "video" })),
    );

    assert.match(events.flatMap((e) => (e.type === "assistant_text" ? [e.text] : [])).join(""), /video/i);
    assert.equal(events.some((e) => e.type === "asset_ready" || e.type === "job_started"), false);
    assert.equal(app.imageModel.calls.length, 0);
  });
});
