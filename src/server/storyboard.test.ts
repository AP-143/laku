import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { MAX_BRIEF_CHARS, PANEL_SHOTS, PANEL_TITLES } from "../shared/storyboard";
import { fakeChatModel } from "./testing/fake-models";
import { fakeImageModel } from "./testing/fake-image-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";

/** Feature 2 through the chat API: a storyboard request goes straight to its one picture; the video is made from that picture. */

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
  /** A typed request for a storyboard: the picture is made in the same request, with no text step in between. */
  async function makeStoryboard(app: ReturnType<typeof createTestApp>, photoAssetId: string, text = "") {
    return readEvents(await app.chat(chatRequest({ messages: [{ role: "user", text, photoAssetId }], intent: "storyboard" })));
  }

  it("goes straight to the one picture: the planner plans once, one image is made and nothing waits for an approval", async () => {
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES, artDirection: ART, intent: "STORYBOARD" });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "buatkan storyboard dan video 10 detik", photoAssetId }] })),
    );

    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.deepEqual(plan.scenes, SCENES);
    assert.equal(plan.sourceAssetId, photoAssetId);
    assert.equal(plan.artDirection, ART);
    assert.equal(chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]")).length, 1);
    assert.equal(app.imageModel.calls.length, 1);
    assert.equal(sheets(events).length, 1);
    assert.equal(sheets(events)[0].sourceAssetId, photoAssetId);
    // The data for the video comes first, then the picture, then the words that say what to do next.
    assert.deepEqual(
      events.map((e) => e.type),
      ["storyboard_scenes", "job_started", "asset_ready", "usage_updated", "assistant_text", "done"],
    );
  });

  it("draws the picture from the scenes and the art direction of this request, from the product photo, for the price of one image", async () => {
    const app = newApp({ artDirection: ART });
    const photoAssetId = await uploadPhoto(app);

    const events = await makeStoryboard(app, photoAssetId);

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
    assert.ok(prompt.includes(ART));
    // One picture costs one image, not six; vertical (9:16), so the video made from it is vertical too.
    const lastUsage = events.findLast((e) => e.type === "usage_updated");
    assert.equal(lastUsage?.type === "usage_updated" && lastUsage.monthUsd, 0.0336);
    assert.equal(app.imageModel.calls[0].aspectRatio, "9:16");
  });

  it("says in Indonesian that the storyboard is ready and that the video panel is below, and no longer asks for an approval", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const events = await makeStoryboard(app, photoAssetId);

    const words = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(words, /storyboard/i);
    assert.match(words, /Buat video iklan/);
    assert.match(words, /Generate/);
    assert.doesNotMatch(words, /Setujui|setuju|usulan/i);
  });

  it("uses the studio photo of an earlier turn when the request is typed without a new photo", async () => {
    const app = newApp({ intent: "STORYBOARD" });
    const studioPhotoId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "bikinin storyboard dong" }], lastImageAssetId: studioPhotoId })),
    );

    assert.equal(sheets(events).length, 1);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("asks the planner for an art direction picked for the product, and to work like a professional editor", async () => {
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES, artDirection: ART });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    await makeStoryboard(app, photoAssetId);

    // The look is not a fixed recipe: the planner is asked to choose it for this product, its buyers and its story.
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]"));
    const prompt = JSON.stringify(planned?.prompt);
    assert.match(prompt, /professional (video )?editor/i);
    assert.match(prompt, /suits? this product/i);
  });

  it("asks the planner for a different shot in each panel, and for the closing caption to end with the call to buy", async () => {
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    await makeStoryboard(app, photoAssetId);

    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]"));
    const prompt = JSON.stringify(planned?.prompt);
    for (const shot of PANEL_SHOTS) assert.ok(prompt.includes(shot), shot);
    assert.match(prompt, /call to buy/i);
    assert.match(prompt, /three short benefits/i);
  });

  it("asks for the panel titles and the captions of the scenes to be written on the picture, and nothing else", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    await makeStoryboard(app, photoAssetId);

    // A real run once drew "SCENE 3 - CLOSE ON ..." inside a frame: camera notes are not part of an ad picture.
    const prompt = app.imageModel.calls[0].prompt ?? "";
    assert.match(prompt, /grid/i);
    assert.match(prompt, /Caption:/);
    assert.match(prompt, /no camera notes/i);
  });

  it("gives the image model no words about itself to write on the picture", async () => {
    // A real run drew "storyboard" and "panel 9:16" on the picture, and the video model then copied them into a clip.
    const app = newApp({ artDirection: ART });
    const photoAssetId = await uploadPhoto(app);

    await makeStoryboard(app, photoAssetId);

    const prompt = app.imageModel.calls[0].prompt ?? "";
    assert.doesNotMatch(prompt, /9:16|storyboard|sheet|panel/i);
    // What is on the picture is told positively: the title pills and the captions are its only text.
    assert.match(prompt, /only text/i);
    assert.match(prompt, /grid of 6 scenes/i);
    // The shape is still asked for through the image call itself.
    assert.equal(app.imageModel.calls[0].aspectRatio, "9:16");
  });

  it("asks for a professionally designed ad sheet, with a different kind of shot in each panel", async () => {
    // A plain grid with white captions looked flat next to a hand-finished ad storyboard.
    const app = newApp({ artDirection: ART });
    const photoAssetId = await uploadPhoto(app);

    await makeStoryboard(app, photoAssetId);

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

  it("makes the sheet with a neutral professional look when the planner gave no art direction, and says nothing odd about it", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    await makeStoryboard(app, photoAssetId);

    const prompt = app.imageModel.calls[0].prompt ?? "";
    assert.doesNotMatch(prompt, /undefined/);
    assert.match(prompt, /professional/i);
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
    const none = proposed(await makeStoryboard(app, photoAssetId, "   "));
    assert.ok(none?.type === "storyboard_scenes");
    assert.equal(none.brief, undefined);

    const plan = proposed(await makeStoryboard(app, photoAssetId, " " + "x".repeat(MAX_BRIEF_CHARS * 3)));
    assert.ok(plan?.type === "storyboard_scenes");
    assert.equal(plan.brief?.length, MAX_BRIEF_CHARS);
  });

  it("reports a failed picture once, books nothing and does not retry by itself", async () => {
    const failing = fakeImageModel({ failWith: Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["unused"], scenes: SCENES }), failing);
    const photoAssetId = await uploadPhoto(app);

    const events = await makeStoryboard(app, photoAssetId);

    assert.equal(sheets(events).length, 0);
    assert.equal(app.imageModel.calls.length, 1);
    // The scenes still reached the browser, so a retry does not have to plan them again.
    assert.ok(proposed(events));
    const last = events.at(-1);
    assert.equal(last?.type === "error" && last.code, "rate_limited");
    assert.equal(events.some((e) => e.type === "assistant_text"), false);
    assert.equal((await (await app.usage(new Request("http://localhost/api/usage"))).json()).monthUsd, 0);
  });

  it("draws the picture again from the same scenes on a retry, without planning again", async () => {
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES, artDirection: ART });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Coba lagi" }],
          redraw: { photoAssetId, scenes: SCENES, artDirection: ART, brief: "video 10 detik" },
        }),
      ),
    );

    assert.equal(chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]")).length, 0);
    assert.equal(sheets(events).length, 1);
    assert.equal(app.imageModel.calls.length, 1);
    SCENES.forEach((scene) => assert.match(app.imageModel.calls[0].prompt ?? "", new RegExp(scene)));
    assert.ok((app.imageModel.calls[0].prompt ?? "").includes(ART));
    // The browser gets the same data again, so a card that is gone after a reload is made again with it.
    const plan = proposed(events);
    assert.ok(plan?.type === "storyboard_scenes");
    assert.equal(plan.brief, "video 10 detik");
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("rejects a retry whose scenes are not exactly six, or whose art direction or brief is not a short text", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);
    const bad = [
      { photoAssetId, scenes: SCENES.slice(0, 4) },
      { photoAssetId, scenes: SCENES, artDirection: 42 },
      { photoAssetId, scenes: SCENES, brief: 42 },
      { photoAssetId, scenes: SCENES, brief: "x".repeat(MAX_BRIEF_CHARS + 1) },
    ];
    for (const redraw of bad) {
      const response = await app.chat(chatRequest({ messages: [{ role: "user", text: "Coba lagi" }], redraw }));
      assert.equal(response.status, 400);
    }
    assert.equal(app.imageModel.calls.length, 0);
  });

  it("accepts a retry of a storyboard made before there was a brief or an art direction", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(
      chatRequest({ messages: [{ role: "user", text: "Coba lagi" }], redraw: { photoAssetId, scenes: SCENES } }),
    );
    const events = await readEvents(response);

    assert.equal(response.status, 200);
    assert.equal(sheets(events).length, 1);
    assert.equal(app.imageModel.calls.length, 1);
  });

  it("makes the video from the picture the request just drew, with the scenes, the art direction and the seller's words it sent", async () => {
    const WISH = "buatkan storyboard dan video 10 detik";
    const chat = fakeChatModel({ chunks: ["unused"], scenes: SCENES, artDirection: ART, intent: "STORYBOARD" });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    const made = await readEvents(await app.chat(chatRequest({ messages: [{ role: "user", text: WISH, photoAssetId }] })));
    const plan = proposed(made);
    const sheet = sheets(made)[0];
    assert.ok(plan?.type === "storyboard_scenes" && sheet);

    // What the browser keeps from that answer is what it sends when the seller presses Generate.
    const video = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Buatkan video iklan dari storyboard ini." }],
          sheet: sheet.assetId,
          scenes: plan.scenes,
          artDirection: plan.artDirection,
          brief: plan.brief,
          video: true,
        }),
      ),
    );

    const question = video.find((e) => e.type === "confirmation_requested");
    assert.ok(question?.type === "confirmation_requested");
    assert.equal(video.some((e) => e.type === "job_started"), false);
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    const prompt = JSON.stringify(planned?.prompt);
    assert.ok(prompt.includes(WISH));
    assert.ok(prompt.includes(ART));
    SCENES.forEach((scene) => assert.ok(prompt.includes(scene)));
  });

  it("ignores the approve flow of a page that was open before the text step went away: nothing is generated for it", async () => {
    const app = newApp();
    const photoAssetId = await uploadPhoto(app);

    const response = await app.chat(
      chatRequest({
        messages: [{ role: "user", text: "Setuju, buatkan gambarnya" }],
        storyboard: { photoAssetId, scenes: SCENES, artDirection: ART },
        approve: {},
      }),
    );
    const events = await readEvents(response);

    assert.equal(response.status, 200);
    assert.equal(events.some((e) => e.type === "job_started" || e.type === "asset_ready" || e.type === "storyboard_scenes"), false);
    assert.deepEqual(events.at(-1), { type: "done" });
    assert.equal(app.imageModel.calls.length, 0);
    assert.equal((await (await app.usage(new Request("http://localhost/api/usage"))).json()).monthUsd, 0);
  });
});

describe("product gate on every paid path", () => {
  it("refuses to generate frames from a photo that is not a product, even without attaching it", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], scenes: SCENES, isProduct: false }));
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(
        chatRequest({
          messages: [{ role: "user", text: "Coba lagi" }],
          redraw: { photoAssetId, scenes: SCENES },
        }),
      ),
    );

    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(events.some((e) => e.type === "job_started" || e.type === "asset_ready"), false);
    assert.match(events.flatMap((e) => (e.type === "assistant_text" ? [e.text] : [])).join(""), /foto produk/i);
  });

  it("refuses a storyboard request for a photo that is not a product, before anything is planned or drawn", async () => {
    const chat = fakeChatModel({ chunks: ["x"], scenes: SCENES, isProduct: false });
    const app = createTestApp(chat);
    const photoAssetId = await uploadPhoto(app);

    const events = await readEvents(
      await app.chat(chatRequest({ messages: [{ role: "user", text: "", photoAssetId }], intent: "storyboard" })),
    );

    assert.equal(app.imageModel.calls.length, 0);
    assert.equal(chat.doGenerateCalls.some((call) => JSON.stringify(call.prompt).includes("[task: plan-scenes]")), false);
    assert.equal(events.some((e) => e.type === "storyboard_scenes" || e.type === "asset_ready"), false);
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
