import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { MAX_BRIEF_CHARS, PANEL_SHOTS, PANEL_TITLES } from "../shared/storyboard";
import { fakeChatModel } from "./testing/fake-models";
import { fakeImageModel } from "./testing/fake-image-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** Feature 2 through the chat API: six scenes as text first, the storyboard picture only after the seller approves. */

/** The art direction a planner might pick for a gadget: nothing like the warm, appetizing look of food. */
const ART = "Night-time neon palette of electric blue and magenta, glossy highlights, glitchy speed-ramp transitions and HUD-style graphic accents.";

const SCENES = [
  "Scene satu di dapur",
  "Scene dua di meja",
  "Scene tiga di taman",
  "Scene empat di rak toko",
  "Scene lima di teras",
  "Scene enam di kasir",
];

async function uploadPhoto(app: ReturnType<typeof createTestApp>): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

const proposed = (events: ChatEvent[]) => events.find((e) => e.type === "storyboard_scenes");
const sheets = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === "asset_ready" && e.role === "storyboard_sheet" ? [e] : []));

function newApp(extra: Partial<Parameters<typeof fakeChatModel>[0]> = {}) {
  return createTestApp(fakeChatModel({ chunks: ["unused"], scenes: SCENES, ...extra }));
}

describe("storyboard", () => {
  it("proposes exactly six scenes and generates no image before approval", async () => {
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

  it("proposes an art direction picked for the product, and tells the planner to work like a professional editor", async () => {
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES, artDirection: ART });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "storyboard" })),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.equal(plan.artDirection, ART);
    // The look is not a fixed recipe: the planner is asked to choose it for this product, its buyers and its story.
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]"));
    const prompt = JSON.stringify(planned?.prompt);
    assert.match(prompt, /professional (video )?editor/i);
    assert.match(prompt, /suits? this product/i);
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

  it("explains the steps in its words: approve first, then the video panel with its Generate button follows the images", async () => {
    const app = newApp({ intent: "EDIT_SCENE", replacement: { scene: 3, text: "Scene tiga baru di pantai" } });
    const photoAssetId = await uploadPhoto(app);
    const wordsOf = (events: ChatEvent[]) =>
      events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");

    const proposal = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "storyboard" })),
    );
    const replaced = await readEvents(
      await app.chat(
        chatRequest({ messages: [{ role: "user", text: "ganti scene 3" }], storyboard: { photoAssetId, scenes: SCENES } }),
      ),
    );

    for (const words of [wordsOf(proposal), wordsOf(replaced)]) {
      assert.match(words, /Setujui & buat gambar/);
      assert.match(words, /Buat video iklan/);
      assert.match(words, /Generate/);
    }
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
    assert.equal(plan.scenes.length, 6);
    assert.equal(app.imageModel.calls.length, 0);
  });

  it("replaces only the scene the seller asks to change", async () => {
    const app = newApp({ intent: "EDIT_SCENE", replacement: { scene: 3, text: "Scene tiga baru di pantai" } });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "ganti scene 3 jadi di pantai" }],
          storyboard: { photoAssetId, scenes: SCENES, artDirection: ART },
        }),
      ),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.deepEqual(plan.scenes, [SCENES[0], SCENES[1], "Scene tiga baru di pantai", ...SCENES.slice(3)]);
    // Changing one scene does not change the look of the whole storyboard.
    assert.equal(plan.artDirection, ART);
    assert.equal(app.imageModel.calls.length, 0);
  });

  it("makes one storyboard picture of all six scenes after approval, from the product photo, and records it", async () => {
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

    const made = sheets(events);
    assert.equal(made.length, 1);
    assert.equal(made[0].sourceAssetId, photoAssetId);
    assert.equal(app.imageModel.calls.length, 1);
    // The picture starts from the product photo, which keeps the product the same in every panel.
    const reference = Buffer.from((await app.store.read(photoAssetId, "resized"))!.bytes);
    const file = app.imageModel.calls[0].files?.[0];
    assert.deepEqual(Buffer.from(file && file.type === "file" ? (file.data as Uint8Array) : []), reference);
    // Every scene and every panel title is in the one prompt, in order.
    const prompt = app.imageModel.calls[0].prompt ?? "";
    SCENES.forEach((scene) => assert.match(prompt, new RegExp(scene)));
    PANEL_TITLES.forEach((title, index) => assert.match(prompt, new RegExp(`${index + 1}\\. ${title}`)));
    assert.ok(prompt.indexOf(SCENES[0]) < prompt.indexOf(SCENES[5]));
    // One picture costs one image, not six.
    const lastUsage = events.findLast((e) => e.type === "usage_updated");
    assert.equal(lastUsage?.type === "usage_updated" && lastUsage.monthUsd, 0.0336);
    // Vertical (9:16), so the video made from it is vertical too.
    assert.equal(app.imageModel.calls[0].aspectRatio, "9:16");
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("asks for the panel titles and the captions of the scenes to be written on the picture, and nothing else", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju, buatkan gambarnya" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: {},
        }),
      ),
    );

    // A real run once drew "SCENE 3 - CLOSE ON ..." inside a frame: camera notes are not part of an ad picture.
    const prompt = app.imageModel.calls[0].prompt ?? "";
    assert.match(prompt, /grid/i);
    assert.match(prompt, /Caption:/);
    assert.match(prompt, /no camera notes/i);
  });

  it("asks for a professionally designed ad sheet, with a different kind of shot in each panel", async () => {
    // A plain grid with white captions looked flat next to a hand-finished ad storyboard.
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju, buatkan gambarnya" }],
          storyboard: { photoAssetId, scenes: SCENES, artDirection: ART },
          approve: {},
        }),
      ),
    );

    const prompt = app.imageModel.calls[0].prompt ?? "";
    // The layout is the same for every product: slanted gutters, a pill label and a caption bubble per panel, a call to action.
    for (const layout of [/angled/i, /rounded pill/i, /speech bubble/i, /call-to-action/i]) {
      assert.match(prompt, layout);
    }
    // The look is the planner's choice for this product, and the sheet is made as a professional editor would.
    assert.ok(prompt.includes(ART));
    assert.match(prompt, /professional (video )?editor/i);
    // A real run drew the benefits twice in the checklist panel: as ticks and again in a bubble, with a raw "|" in it.
    assert.match(prompt, /only as the tick checklist/i);
    assert.match(prompt, /never write the "\|" sign/i);
    // Each panel is told its own kind of shot, in order, so the sheet is not six copies of the same medium shot.
    let from = 0;
    for (const shot of PANEL_SHOTS) {
      const at = prompt.indexOf(shot, from);
      assert.ok(at >= from, `missing, or out of order: ${shot}`);
      from = at;
    }
  });

  it("makes the sheet with a neutral professional look when no art direction was given, and says nothing odd about it", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju" }],
          storyboard: { photoAssetId, scenes: SCENES },
          approve: {},
        }),
      ),
    );

    const prompt = app.imageModel.calls[0].prompt ?? "";
    assert.doesNotMatch(prompt, /undefined/);
    assert.match(prompt, /professional/i);
  });

  it("rejects an art direction that is not text", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(
      chatRequest({
        messages: [{ role: "user", text: "Setuju" }],
        storyboard: { photoAssetId, scenes: SCENES, artDirection: 42 },
        approve: {},
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(app.imageModel.calls.length, 0);
  });

  it("reads the first request from the start: the planner sees all of it, and the seller's own words reach the browser for the video", async () => {
    const WISH = "buatkan storyboard dan video 10 detik, santai tapi bikin lapar";
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES, intent: "STORYBOARD" });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(await app.chat(chatRequest({ messages: [{ role: "user", text: WISH, photoAssetId }] })));

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    // Not a summary written by a model: the words themselves, so nothing the seller asked for can be lost on the way.
    assert.equal(plan.brief, WISH);
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]"));
    const prompt = JSON.stringify(planned?.prompt);
    assert.ok(prompt.includes(WISH));
    assert.doesNotMatch(prompt, /\\+"brief/);
  });

  it("has no brief when the seller typed nothing, and keeps only a short text of what was typed", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);
    const empty = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "   ", photoAssetId }], intent: "storyboard" })),
    );
    const none = proposed(empty);
    assert.ok(none?.type === "storyboard_scenes");
    assert.equal(none.brief, undefined);

    const long = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: " " + "x".repeat(MAX_BRIEF_CHARS * 3), photoAssetId }], intent: "storyboard" })),
    );
    const plan = proposed(long);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.equal(plan.brief?.length, MAX_BRIEF_CHARS);
  });

  it("keeps the brief when one scene is replaced", async () => {
    const app = newApp({ intent: "EDIT_SCENE", replacement: { scene: 2, text: "Scene dua baru" } });
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "ganti scene 2" }],
          storyboard: { photoAssetId, scenes: SCENES, artDirection: ART, brief: "About 10 seconds, with a voice-over." },
        }),
      ),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.equal(plan.brief, "About 10 seconds, with a voice-over.");
  });

  it("rejects a brief that is not a short text, and still accepts a storyboard from before there was a brief", async () => {
    for (const bad of [42, "x".repeat(MAX_BRIEF_CHARS + 1)]) {
      const app = newApp();
      const photoAssetId = await uploadPhoto(app);
      const response = await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju" }],
          storyboard: { photoAssetId, scenes: SCENES, brief: bad },
          approve: {},
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(app.imageModel.calls.length, 0);
    }

    const app = newApp();
    const photoAssetId = await uploadPhoto(app);
    const old = await app.chat(
      chatRequest({ messages: [{ role: "user", text: "Setuju" }], storyboard: { photoAssetId, scenes: SCENES }, approve: {} }),
    );
    assert.equal(old.status, 200);
  });

  it("asks the planner for a different shot in each panel, and for the closing caption to end with the call to buy", async () => {
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "storyboard" })),
    );

    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]"));
    const prompt = JSON.stringify(planned?.prompt);
    for (const shot of PANEL_SHOTS) assert.ok(prompt.includes(shot), shot);
    assert.match(prompt, /call to buy/i);
    assert.match(prompt, /three short benefits/i);
  });

  it("makes the one picture when the seller types their approval while the storyboard is open", async () => {
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

    assert.equal(sheets(events).length, 1);
    assert.equal(app.imageModel.calls.length, 1);
    SCENES.forEach((scene) => assert.match(app.imageModel.calls[0].prompt ?? "", new RegExp(scene)));
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
    assert.equal(sheets(events).length, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("uses the scene text the seller edited before approving", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);
    const edited = [...SCENES.slice(0, 5), "Scene enam yang kuedit sendiri"];

    await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Setuju" }],
          storyboard: { photoAssetId, scenes: edited },
          approve: {},
        }),
      ),
    );

    assert.match(app.imageModel.calls[0].prompt ?? "", /kuedit sendiri/);
  });

  it("reports a failed picture once, books nothing and does not retry by itself", async () => {
    const failing = fakeImageModel({ failWith: Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["unused"], scenes: SCENES }), failing);
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

    assert.equal(sheets(events).length, 0);
    assert.equal(app.imageModel.calls.length, 1);
    const last = events.at(-1);
    assert.equal(last?.type === "error" && last.code, "rate_limited");
    assert.equal((await (await app.usage(new Request("http://localhost/api/usage"))).json()).monthUsd, 0);
  });

  it("rejects an approval whose scenes are not exactly six", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(
      chatRequest({
        messages: [{ role: "user", text: "Setuju" }],
        storyboard: { photoAssetId, scenes: SCENES.slice(0, 4) },
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
