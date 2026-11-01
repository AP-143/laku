import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeChatModel } from "./testing/fake-models";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** Chatting with a photo attached: the bot checks it is a product before doing anything else. */

async function uploadPhoto(app: ReturnType<typeof createTestApp>): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  assert.equal(event.type, "asset_ready");
  return event.type === "asset_ready" ? event.assetId : "";
}

describe("chat with a photo", () => {
  it("talks about a product photo like a normal turn", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["Botolnya bagus!"], isProduct: true }));
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(chatRequest({ messages: [{ role: "user", text: "Ini produkku", photoAssetId }] }));
    const events = await readEvents(response);

    assert.equal(response.status, 200);
    assert.deepEqual(events, [{ type: "assistant_text", text: "Botolnya bagus!" }, { type: "done" }]);
  });

  it("accepts a photo sent with no text at all", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["Oke, fotonya sudah masuk."] }));
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }] }));

    assert.equal(response.status, 200);
    assert.deepEqual((await readEvents(response)).at(-1), { type: "done" });
  });

  it("politely refuses a photo that is not a product and starts no generation", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["TIDAK BOLEH MUNCUL"], isProduct: false }));
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(chatRequest({ messages: [{ role: "user", text: "Bikin jadi foto studio", photoAssetId }] }));
    const events = await readEvents(response);

    const reply = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(reply, /foto produk/i);
    assert.doesNotMatch(reply, /TIDAK BOLEH MUNCUL/);
    assert.equal(events.some((event) => event.type === "job_started" || event.type === "asset_ready"), false);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("reports a photo it cannot find as a retryable error", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const response = await app.chat(
      chatRequest({ messages: [{ role: "user", text: "Halo", photoAssetId: "00000000-0000-0000-0000-000000000000" }] }),
    );
    const events = await readEvents(response);

    assert.equal(response.status, 400);
    assert.equal(events.length, 1);
    assert.equal(events[0].type === "error" && events[0].retryable, true);
  });

  it("rejects a photo id that is not an id at all", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const response = await app.chat(chatRequest({ messages: [{ role: "user", text: "Halo", photoAssetId: "../../secret" }] }));

    assert.equal(response.status, 400);
    assert.equal((await readEvents(response))[0].type, "error");
  });

  it("reports a failed product check as a retryable error and never says done", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], failProductCheck: true }));
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(chatRequest({ messages: [{ role: "user", text: "Halo", photoAssetId }] }));
    const events = await readEvents(response);

    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.type === "error" && (events.at(-1) as { retryable: boolean }).retryable, true);
    assert.equal(events.some((event) => event.type === "done"), false);
  });
});
