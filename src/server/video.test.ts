import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VOICES } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeMusicModel } from "./testing/fake-music-model";
import { fakeSpeechModel } from "./testing/fake-speech-model";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";
import { colourfulness, levelAround, lowerThird, meanDifference, probeVideo, wholeFrame } from "./testing/probe-video";

/**
 * Feature 3 through the chat API: a video made from the one storyboard picture, with the length the seller asks for.
 * The text model splits the six panels over the clips (a "direction" for each), and every clip starts from the same picture.
 */

type App = ReturnType<typeof createTestApp>;

async function uploadPhoto(app: App, background?: string): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg", 800, 600, background))));
  return event.type === "asset_ready" ? event.assetId : "";
}

/** The storyboard picture, as the seller would have it: one stored image the video is made from. */
async function uploadSheet(app: App): Promise<string> {
  return uploadPhoto(app, "#cc3333");
}

const videoRequest = (text: string, sheet: string | undefined, extra: object = {}) =>
  chatRequest({ messages: [{ role: "user", text }], sheet, ...extra });

/** The art direction the planner picked, sent back with the video request. */
const ART = "Night-time neon palette of electric blue and magenta, glossy highlights, glitchy speed-ramp transitions and HUD-style graphic accents.";

/** The directions the fake text model gives the clips, so a test can tell which one a clip was made with. */
/** The picture bitrate of the clips the fake video model makes (a 6 s clip), to compare the joined video with. */
async function clipBitrate(): Promise<number> {
  const clip = await fakeVideoModel().generate({ prompt: "", frame: { bytes: new Uint8Array(), mediaType: "image/png" }, seconds: 6 });
  return (await probeVideo(clip)).videoBitrate;
}

const directionOf = (clip: number) => `Direction for clip ${clip + 1}`;

/** The picture a video call started from, as it was stored. */
async function storedSheet(app: App, sheet: string) {
  return Buffer.from((await app.store.read(sheet, "resized"))!.bytes);
}

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
  it("makes a silent video of the length asked for, every clip from the one storyboard picture, and books the cost per second", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("bikinin video iklan 10 detik dari storyboard", sheet)));

    // Two clips, 6 s and 4 s, both starting from the same storyboard picture, each told its own part of the story.
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
    for (const [index, call] of app.videoModel.calls.entries()) {
      assert.deepEqual(Buffer.from(call.frame.bytes), await storedSheet(app, sheet));
      assert.match(call.prompt, new RegExp(directionOf(index)));
    }

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "video");
    assert.equal(ready.url, `/api/assets/${ready.assetId}`);
    assert.equal(ready.sourceAssetId, sheet);

    // The stored file is one 9:16 MP4 of about the length asked for, with the audio of the model dropped.
    const file = await app.store.read(ready.assetId, "original");
    assert.equal(file?.mediaType, "video/mp4");
    const probe = await probeVideo(file!.bytes);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);
    // The sound the clips came with (sound effects and room tone) stays: a video with no sound at all feels cheap.
    assert.equal(probe.hasAudio, true);

    const started = events.find((event) => event.type === "job_started" && event.kind === "video");
    assert.ok(started && started.type === "job_started");
    const progress = events.filter((event) => event.type === "job_progress");
    assert.equal(progress.length, 2);
    // Progress belongs to the job that was started, so the browser can follow one job.
    assert.ok(progress.every((event) => event.jobId === started.jobId));
    assert.deepEqual(events.findLast((event) => event.type === "usage_updated"), { type: "usage_updated", monthUsd: 1 });
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes 10 seconds when the seller names no length", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO" }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(videoRequest("bikinin video dong", sheet)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
  });

  it("raises a length that is shorter than the shortest clip", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 2 }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(videoRequest("video 2 detik", sheet)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [4]);
  });

  it("refuses a length the storyboard cannot cover, says the most it can, and spends nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 40 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 40 detik", sheet)));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /32 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("refuses a picture that is not a product, before anything is generated", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", isProduct: false }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });
});

/** The "Buat video" button under an approved storyboard: the length is a field of the request, never guessed from words. */
describe("video from the button of an approved storyboard", () => {
  const buttonRequest = (sheet: string | undefined, video: object, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video, ...extra });

  it("fits 10, 20 and 30 seconds with 2, 3 and 4 clips that add up to the length, all from the same picture", async () => {
    for (const [seconds, clips] of [
      [10, [6, 4]],
      [20, [8, 6, 6]],
      [30, [8, 8, 8, 6]],
    ] as const) {
      const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
      const sheet = await uploadSheet(app);

      const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds }, { confirmedUsd: 3 })));

      assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), clips, `${seconds} s`);
      for (const [index, call] of app.videoModel.calls.entries()) {
        assert.deepEqual(Buffer.from(call.frame.bytes), await storedSheet(app, sheet));
        assert.match(call.prompt, new RegExp(directionOf(index)));
      }
      assert.ok(finishedVideo(events), `${seconds} s`);
    }
  });

  it("asks the text model to share the scenes over the clips in order, and does not ask what the seller meant", async () => {
    // The router would call this message plain chat, and the request reader would find no length: the field decides.
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);
    const scenes = ["Satu di dapur", "Dua di meja", "Tiga", "Empat", "Lima", "Enam di kasir"];

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 20 }, { scenes, confirmedUsd: 2 })));

    const planned = chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.equal(planned.length, 1);
    const prompt = JSON.stringify(planned[0].prompt);
    assert.match(prompt, /Number of clips: 3/);
    assert.ok(prompt.indexOf("Satu di dapur") < prompt.indexOf("Enam di kasir"));
    // Only the product check of the picture and this plan asked the chat model anything.
    assert.equal(chat.doGenerateCalls.length, 2);
  });

  it("edits every clip like a professional editor, in the art direction the planner picked for this product", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { artDirection: ART, confirmedUsd: 1 })));

    for (const call of app.videoModel.calls) {
      assert.ok(call.prompt.includes(ART));
      assert.match(call.prompt, /professional (video )?editor/i);
      // The captions are added afterwards in the edit, so the model draws no text of its own.
      assert.match(call.prompt, /do not draw any text/i);
    }
    // The planner is asked for the choices an editor makes (camera, effects, transitions, grade, text), in that look.
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    const prompt = JSON.stringify(planned?.prompt);
    assert.ok(prompt.includes(ART));
    for (const choice of [/professional (video )?editor/i, /camera move/i, /effect/i, /transition/i, /colou?r grade/i]) {
      assert.match(prompt, choice);
    }
  });

  it("makes no video when the text model cannot plan the clips, and books nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], failVideoPlan: true }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(errorOf(events)?.type, "error");
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("makes the video from a picture that shows a person using the product, since it is the app's own picture", async () => {
    // A real run showed a smiling man holding the gamepad; the strict photo check calls that "a person" and stopped the video.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], peopleInPictures: true }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 2);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("offers 10, 20 and 30 seconds, and nothing else", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    for (const seconds of [10, 20, 30]) {
      assert.equal((await app.chat(buttonRequest(sheet, { seconds }))).status, 200, String(seconds));
    }
    for (const seconds of [0, 3, 10.5, 16, 24, 32, 40, "20", null]) {
      assert.equal((await app.chat(buttonRequest(sheet, { seconds }))).status, 400, String(seconds));
    }
    assert.equal((await app.chat(buttonRequest(sheet, { seconds: 20, voiceOver: "yes" }))).status, 400);
  });

  it("always asks for the price first, whatever the length, and spends nothing until the seller agrees", async () => {
    // A typed request under US$1 starts at once; the button never does: pressing it shows the price, and yes makes the video.
    for (const [seconds, usd] of [
      [10, 1],
      [20, 2],
      [30, 3],
    ] as const) {
      const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
      const sheet = await uploadSheet(app);

      const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds })));

      const ask = events.find((event) => event.type === "confirmation_requested");
      assert.ok(ask && ask.type === "confirmation_requested", `${seconds} s`);
      assert.equal(ask.estimatedUsd, usd);
      assert.match(ask.message, new RegExp(`${seconds} detik`));
      // The seller thinks in seconds and price; how many clips it takes is not their concern.
      assert.doesNotMatch(ask.message, /klip/);
      assert.equal(app.videoModel.calls.length, 0);
      assert.equal(finishedVideo(events), undefined);
      assert.equal((await usageOf(app)).monthUsd, 0);
    }
  });

  it("includes the narration in the price it asks for, so the seller agrees to what is booked", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);
    const scenes = ["a", "b", "c", "d"];

    // 20 seconds of video is US$2.00 and 20 seconds of narration US$0.006.
    const asked = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 20, voiceOver: true }, { scenes })));
    const ask = asked.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 2.006);

    // A yes to the price of the picture alone does not cover the narration: the question comes again.
    const short = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 20, voiceOver: true }, { scenes, confirmedUsd: 2 })));
    assert.ok(short.some((event) => event.type === "confirmation_requested"));
    assert.equal(app.videoModel.calls.length, 0);

    const agreed = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 20, voiceOver: true }, { scenes, confirmedUsd: 2.006 })));
    assert.ok(finishedVideo(agreed));
    assert.equal((await usageOf(app)).monthUsd, 2.006);
  });

  it("lays a narration over the video when the seller switched the voice-over on", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], script: "Naskah untuk iklan sepatu." }));
    const sheet = await uploadSheet(app);
    const scenes = ["Scene satu", "Scene dua", "Scene tiga", "Scene empat"];

    const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10, voiceOver: true }, { scenes, confirmedUsd: 1.003 })));

    const narration = events.find((event) => event.type === "voice_over");
    assert.ok(narration && narration.type === "voice_over");
    assert.equal(narration.script, "Naskah untuk iklan sepatu.");
    assert.equal(narration.seconds, 10);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.equal(probe.hasAudio, true);
  });

  it("makes the longest video with a voice-over however much was already spent today", async () => {
    // The 30 second video costs US$3.00 and its narration US$0.009; there is no daily limit to stop it.
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 10 });
    const sheet = await uploadSheet(app);

    const events = await readEvents(
      await app.chat(buttonRequest(sheet, { seconds: 30, voiceOver: true }, { scenes: ["a", "b", "c", "d"], confirmedUsd: 3.009 })),
    );

    assert.equal(errorOf(events), undefined);
    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 4);
  });

  it("makes a silent video when the voice-over is not asked for", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 20, voiceOver: false }, { confirmedUsd: 2 })));

    assert.equal(events.some((event) => event.type === "voice_over"), false);
    assert.equal(app.speechModel.calls.length, 0);
  });

  it("asks for the storyboard first when the button is pressed without a storyboard picture", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(await app.chat(buttonRequest(undefined, { seconds: 20 })));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /storyboard/i);
    assert.equal(app.videoModel.calls.length, 0);
  });
});

/** The sound of the video: speech on camera in sync with the mouth, or a narration, as the planner decides for this ad. */
describe("a video that sounds and moves naturally", () => {
  const DIALOGUES = ["Duh, perut keroncongan banget nih!", "Nih, burger spesial paling juara!"];
  const PROFILE = "Warm young Indonesian man, relaxed and friendly, medium pace";
  const buttonRequest = (sheet: string | undefined, video: object, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video, ...extra });
  const voiceRequest = (sheet: string) =>
    videoRequest("Buat video dari storyboard ini.", sheet, {
      video: { seconds: 10, voiceOver: true },
      scenes: ["a", "b", "c", "d", "e", "f"],
      confirmedUsd: 1.003,
    });

  it("lets the person speak on camera, in sync with the mouth, when the planner decides so: the clips keep their own sound", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoPlan: { audio: "on_camera", voice: "male", voiceProfile: PROFILE, dialogues: DIALOGUES } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    // Each clip is told the exact words to say, in Indonesian, with lip movement that matches, in the one voice.
    for (const [index, call] of app.videoModel.calls.entries()) {
      assert.ok(call.prompt.includes(DIALOGUES[index]), `clip ${index + 1} says its line`);
      assert.match(call.prompt, /lip movement that matches/i);
      assert.ok(call.prompt.includes(PROFILE), "the same voice in every clip");
    }
    // The sound the clips came with is the speech, so it stays; no separate voice is read over it.
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
    assert.equal(app.speechModel.calls.length, 0);
    assert.equal(events.some((event) => event.type === "voice_over"), false);
    // Nothing was read aloud, so only the video is billed.
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("reads a narration in the voice that suits the person when the planner decides so, and keeps the mouths closed", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoPlan: { audio: "narration", voice: "male" } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    assert.deepEqual(app.speechModel.calls.map((call) => call.voice), [VOICES.male]);
    // A voice laid over the video must not fight a mouth that moves: nobody speaks on camera.
    for (const call of app.videoModel.calls) assert.match(call.prompt, /mouths? stay closed/i);
    assert.ok(events.some((event) => event.type === "voice_over"));
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
    assert.equal((await usageOf(app)).monthUsd, 1.003);
  });

  it("writes the narration after thinking about the mood of each moment, and has it read with the delivery it directed", async () => {
    const DELIVERY = "Warm, upbeat young man; curious and playful at first, building excitement at the reveal, slowing and smiling on the call to buy.";
    const SCRIPT = "Lapar banget? <short pause> Nih, burger spesial yang bikin kamu senyum! Pesan sekarang, ya.";
    const chat = fakeChatModel({
      chunks: ["x"],
      script: SCRIPT,
      delivery: DELIVERY,
      videoPlan: { audio: "narration", voice: "male", voiceProfile: PROFILE },
    });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, {
      video: { seconds: 10, voiceOver: true },
      scenes: ["a", "b", "c", "d", "e", "f"],
      artDirection: "Warm, appetizing colour and soft light.",
      confirmedUsd: 1.003,
    })));

    // The words keep their pauses, and the speech model is told how to perform them, in the voice that suits the person.
    assert.deepEqual(app.speechModel.calls.map((call) => ({ text: call.text, voice: call.voice, instructions: call.instructions })), [
      { text: SCRIPT, voice: VOICES.male, instructions: DELIVERY },
    ]);
    // The writer thinks first, and is given what it needs to match the voice and the look of this ad.
    const written = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: voice-script]"));
    const prompt = JSON.stringify(written?.prompt);
    for (const need of [/think/i, /intonation/i, /not flat/i, /<short pause>/, /Warm, appetizing colour/]) assert.match(prompt, need);
    assert.ok(prompt.includes(PROFILE));
    // The delivery goes with the narration, so changing the voice later keeps the same way of speaking.
    const voice = events.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.delivery, DELIVERY);
  });

  it("speeds a narration up a little when it only just runs past the end of the video, so the closing line is not cut", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { speechModel: fakeSpeechModel({ seconds: 9.7 }) });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    // 9.7 s of narration for a 10 s video that must end half a second early: a small speed-up is enough, one call is made.
    assert.equal(app.speechModel.calls.length, 1);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.ok(Math.abs((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).seconds - 10) < 0.6);
  });

  it("writes a shorter narration once when it would still be cut off after a speed-up, so the closing line is read in full", async () => {
    const chat = fakeChatModel({ chunks: ["x"], script: "Naskah contoh yang cukup pendek.", delivery: "Warm and lively." });
    const app = createTestApp(chat, undefined, { speechModel: fakeSpeechModel({ seconds: 12 }) });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    const written = chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: voice-script]"));
    assert.equal(written.length, 2, "the narration is written again, once");
    assert.match(JSON.stringify(written[1].prompt), /19 to 23 spoken words/);
    assert.equal(app.speechModel.calls.length, 2);
    // Both readings are billed: 10 s of video and two narrations of 10 s.
    assert.equal((await usageOf(app)).monthUsd, 1.006);
    assert.ok(finishedVideo(events));
  });

  it("does not count the pause tags of a narration as words, so a natural script is not refused for its pauses", async () => {
    const plain = Array.from({ length: 26 }, () => "enak").join(" ");
    const tags = Array.from({ length: 8 }, () => "<short pause>").join(" ");
    const app = createTestApp(fakeChatModel({ chunks: ["x"], script: `${plain} ${tags}`, delivery: "Warm and lively." }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(voiceRequest(sheet)));

    assert.equal(app.speechModel.calls.length, 1);
  });

  it("cuts cleanly between the panels inside a clip like an editor would, instead of letting the model morph one into the next", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    // A video model that is asked to play several panels in one clip dissolves one into the next, which looks generated.
    for (const call of app.videoModel.calls) {
      assert.match(call.prompt, /hard cuts?/i);
      assert.match(call.prompt, /never morph/i);
    }
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.match(JSON.stringify(planned?.prompt), /hard cut/i);
  });

  it("keeps the picture quality of the clips when it joins them, instead of compressing it down to a soft image", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    // The clips come as 6 s and 4 s files; the joined video must not carry less detail per second than they did.
    const clipBytes = app.videoModel.calls.length > 0 ? await clipBitrate() : 0;
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const joined = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.ok(joined.videoBitrate >= clipBytes * 1.2, `joined ${joined.videoBitrate} bps against clips of ${clipBytes} bps`);
  });

  it("keeps the mouths closed when no sound was asked for, instead of leaving people talking silently", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10, voiceOver: false }, { confirmedUsd: 1 })));

    for (const call of app.videoModel.calls) assert.match(call.prompt, /mouths? stay closed/i);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    // Nobody speaks, but the sound effects of the clips are still there.
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
  });

  it("sound-designs every clip like a professional editor: effects in sync with the action, room tone, no music, no stray speech", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    for (const call of app.videoModel.calls) {
      assert.match(call.prompt, /sound effects/i);
      assert.match(call.prompt, /in sync with/i);
      assert.match(call.prompt, /room tone/i);
      assert.match(call.prompt, /no music/i);
    }
    // The planner is asked for the sound effects of each clip, not only for what is seen.
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.match(JSON.stringify(planned?.prompt), /sound effects?/i);
  });

  it("shows the planner the storyboard picture and lets it think first, so its choices fit this person and product", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(voiceRequest(sheet)));

    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    const prompt = JSON.stringify(planned?.prompt);
    assert.match(prompt, /"type":"file"/);
    assert.match(prompt, /think/i);
    // The choice it makes about the sound, and what it must decide about the voice.
    assert.match(prompt, /on_camera/);
    assert.match(prompt, /narration/);
    assert.match(prompt, /voice that suits/i);
  });

  it("directs the clips like a real shoot, so the people move naturally and do not hold a frozen pose", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    for (const call of app.videoModel.calls) {
      assert.match(call.prompt, /micro-expressions/i);
      assert.match(call.prompt, /never a frozen pose/i);
    }
  });

  it("remakes a clip of a video with speech on camera with the same words, and keeps the sound of the whole video", async () => {
    const model = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const chat = fakeChatModel({ chunks: ["x"], videoPlan: { audio: "on_camera", voice: "male", voiceProfile: PROFILE, dialogues: DIALOGUES } });
    const app = createTestApp(chat, undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const first = await readEvents(await app.chat(voiceRequest(sheet)));
    const partial = first.find((event) => event.type === "video_partial");
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.audio, "on_camera");

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          resume: {
            seconds: partial.seconds,
            clips: partial.clips,
            finished: partial.finished,
            voiceOver: partial.voiceOver,
            directions: partial.directions,
            audio: partial.audio,
            voice: partial.voice,
          },
        }),
      ),
    );

    assert.ok(app.videoModel.calls[2].prompt.includes(DIALOGUES[1]), "the remade clip says its own line");
    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
    assert.equal(app.speechModel.calls.length, 0);
  });
});

/** The finishing a professional editor does: captions in one style, added in the edit, and one colour grade over every clip. */
describe("a video that is finished like a professional edit", () => {
  const CAPTIONS = [
    [{ text: "Duh, perut keroncongan banget nih!", from: 0.5, to: 3.5 }],
    [{ text: "Yuk, pesan sekarang!", from: 0.5, to: 3 }],
  ];
  // No grain, so two videos that differ only in their captions can be compared pixel by pixel.
  const CLEAN = { grain: 0, vignette: false };
  const buttonRequest = (sheet: string | undefined, video: object, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video, ...extra });

  const voiceRequestFor = (sheet: string) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: { seconds: 10, voiceOver: true }, scenes: ["a", "b", "c", "d", "e", "f"], confirmedUsd: 1.003 });

  async function finished(videoPlan: Parameters<typeof fakeChatModel>[0]["videoPlan"], extra: object = {}) {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan }));
    const sheet = await uploadSheet(app);
    const events = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: { seconds: 10 }, confirmedUsd: 1, ...extra })));
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    return { app, sheet, events, bytes: new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes) };
  }

  it("puts the captions on the picture in the edit, only while the planner chose to show them", async () => {
    const withCaptions = await finished({ captions: CAPTIONS, grade: CLEAN });
    const without = await finished({ grade: CLEAN });

    // The first caption is on screen at 1.5 s and gone at 4.5 s; the second clip starts at 6 s, so its caption shows at 7.5 s.
    const shown = async (seconds: number) => meanDifference(await lowerThird(withCaptions.bytes, seconds), await lowerThird(without.bytes, seconds));
    assert.ok((await shown(1.5)) > 3, "the first caption is drawn");
    assert.ok((await shown(7.5)) > 3, "the caption of the second clip is drawn after the first clip");
    assert.ok((await shown(4.5)) < 0.5, "nothing is drawn between the captions");
  });

  it("draws a designed callout in the colours the planner picked, only while it shows, and no text where the planner chose none", async () => {
    const callout = [[{ text: "Anti-slip nyaman", from: 1, to: 4, kind: "callout" as const }], []];
    const palette = { bubble: "#0b1d2e", text: "#7ff6ff", accent: "#00e5ff" };
    const withCallout = await finished({ captions: callout, palette, grade: CLEAN });
    const plain = await finished({ grade: CLEAN });

    const shown = async (seconds: number) => meanDifference(await wholeFrame(withCallout.bytes, seconds), await wholeFrame(plain.bytes, seconds));
    assert.ok((await shown(2.5)) > 1.5, "the callout is drawn while it shows");
    assert.ok((await shown(5)) < 0.5, "and gone after");
    // A callout is designed, not a subtitle: the same words as a subtitle look different (a bubble, in the planner's colours).
    const asSubtitle = await finished({ captions: [[{ text: "Anti-slip nyaman", from: 1, to: 4, kind: "subtitle" as const }], []], palette, grade: CLEAN });
    assert.ok(meanDifference(await wholeFrame(withCallout.bytes, 2.5), await wholeFrame(asSubtitle.bytes, 2.5)) > 1.5, "not drawn as a subtitle");
  });

  it("holds the call to buy to the very last frame, and shows it early enough to be read, even when the planner put it too late", async () => {
    // The last clip is 4 s and starts at 6 s; the planner put the call to buy at 9.5 s, the last half second.
    const closing = [[], [{ text: "Yuk, Pesan Sekarang!", from: 3.5, to: 4, kind: "cta" as const }]];
    const withCta = await finished({ captions: closing, grade: CLEAN });
    const plain = await finished({ grade: CLEAN });

    const shown = async (seconds: number) => meanDifference(await wholeFrame(withCta.bytes, seconds), await wholeFrame(plain.bytes, seconds));
    assert.ok((await shown(8.5)) > 1.5, "it is already on screen well before the end");
    assert.ok((await shown(9.9)) > 1.5, "and it is still there on the last frame");
    assert.ok((await shown(7)) < 0.5, "but it does not start long before");
  });

  it("keeps a palette that is not a colour from breaking the edit", async () => {
    const odd = await finished({ captions: [[{ text: "Anti-slip nyaman", from: 1, to: 4, kind: "callout" as const }], []], palette: { bubble: "url(x)", text: "red; drop", accent: "nope" }, grade: CLEAN });
    const plain = await finished({ grade: CLEAN });

    assert.ok(meanDifference(await wholeFrame(odd.bytes, 2.5), await wholeFrame(plain.bytes, 2.5)) > 1.5, "a callout in the default colours");
  });

  it("asks the planner to decide whether the ad needs text at all, to prefer a few callouts and to end on a held call to buy", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    const prompt = JSON.stringify(planned?.prompt);
    for (const need of [/text is not required/i, /callouts?/, /subtitles?/, /palette/, /call to buy/i, /hold/i, /at most \d+ spoken words/]) assert.match(prompt, need);
  });

  it("keeps what is said in a clip within the seconds it has, dropping the sentences that would be cut off, and leaves room at the end", async () => {
    const long = "Pesan sekarang juga ya! Stok terbatas banget hari ini! Jangan sampai kehabisan, cepat klik tombol beli di bawah!";
    const chat = fakeChatModel({ chunks: ["x"], videoPlan: { audio: "on_camera", voice: "male", dialogues: ["Duh, perut keroncongan banget nih!", long] } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(voiceRequestFor(sheet)));

    // The last clip is 4 s with the end held: room for about five words, so only the first sentence is kept.
    assert.ok(app.videoModel.calls[1].prompt.includes("Pesan sekarang juga ya!"));
    assert.ok(!app.videoModel.calls[1].prompt.includes("Stok terbatas"), "a sentence that would be cut off is not asked for");
  });

  it("tells the model to draw no text, and asks the planner for the captions and when they show", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(buttonRequest(sheet, { seconds: 10 }, { confirmedUsd: 1 })));

    for (const call of app.videoModel.calls) assert.match(call.prompt, /do not draw any text/i);
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    const prompt = JSON.stringify(planned?.prompt);
    for (const need of [/captions/i, /from/, /seconds from the start of that clip/, /colourist/i, /grain/i, /vignette/]) assert.match(prompt, need);
  });

  it("gives every clip the one colour grade the planner chose, so the clips match", async () => {
    const vivid = await finished({ grade: { saturation: 1.2, grain: 0, vignette: false } });
    const muted = await finished({ grade: { saturation: 0.85, grain: 0, vignette: false } });

    assert.ok((await colourfulness(vivid.bytes, 1)) > (await colourfulness(muted.bytes, 1)) * 1.1, "first clip");
    assert.ok((await colourfulness(vivid.bytes, 7)) > (await colourfulness(muted.bytes, 7)) * 1.1, "second clip");
  });

  it("keeps the captions and the grade when a stopped video is remade", async () => {
    const model = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { captions: CAPTIONS, grade: CLEAN } }), undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const first = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: { seconds: 10 }, confirmedUsd: 1 })));
    const partial = first.find((event) => event.type === "video_partial");
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.captions[1][0].text, "Yuk, pesan sekarang!");

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          resume: {
            seconds: partial.seconds,
            clips: partial.clips,
            finished: partial.finished,
            voiceOver: partial.voiceOver,
            directions: partial.directions,
            audio: partial.audio,
            voice: partial.voice,
            captions: partial.captions,
            grade: partial.grade,
          },
        }),
      ),
    );

    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    const bytes = new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes);
    const plain = await finished({ grade: CLEAN });
    assert.ok(meanDifference(await lowerThird(bytes, 1.5), await lowerThird(plain.bytes, 1.5)) > 3, "caption of the kept clip");
    assert.ok(meanDifference(await lowerThird(bytes, 7.5), await lowerThird(plain.bytes, 7.5)) > 3, "caption of the remade clip");
  });
});

/** The music bed: designed by the planner for this ad, free of vocals, quiet under what is said, and part of the price. */
describe("music under the video", () => {
  const BRIEF = "Upbeat lo-fi hip hop at 92 BPM in D minor, warm Rhodes piano and soft drums, steady energy from the first beat.";
  const musicRequest = (sheet: string, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: { seconds: 10, music: true }, confirmedUsd: 1.04, ...extra });

  it("adds the music the planner designed, ends it with a fade, and books its price with the video", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: BRIEF, level: 0.2 } } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(musicRequest(sheet)));

    // The music model is asked for exactly what the planner designed, instrumental, once.
    assert.equal(app.musicModel.calls.length, 1);
    assert.ok(app.musicModel.calls[0].prompt.includes(BRIEF));
    assert.match(app.musicModel.calls[0].prompt, /instrumental only, no vocals/i);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const bytes = new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes);
    // The pitch of the fake music is in the sound of the video; without music it is not.
    assert.ok((await levelAround(bytes, 1000)) > -46, "the music is heard");
    assert.ok(Math.abs((await probeVideo(bytes)).seconds - 10) < 0.6);
    // US$1.00 of video and US$0.04 of music.
    assert.equal((await usageOf(app)).monthUsd, 1.04);
  });

  it("makes a video with no music at all when the seller did not ask for it, and does not ask the planner to design any", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: BRIEF } } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: { seconds: 10 }, confirmedUsd: 1 })));

    assert.equal(app.musicModel.calls.length, 0);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.ok((await levelAround(new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes), 1000)) < -48);
    assert.equal((await usageOf(app)).monthUsd, 1);
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.match(JSON.stringify(planned?.prompt), /did not ask for music/i);
  });

  it("includes the music in the price it asks for, so the seller agrees to what is booked", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const asked = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: { seconds: 10, music: true } })));
    const ask = asked.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 1.04);

    // A yes to the price of the picture alone does not cover the music: the question comes again.
    const short = await readEvents(await app.chat(musicRequest(sheet, { confirmedUsd: 1 })));
    assert.ok(short.some((event) => event.type === "confirmation_requested"));
    assert.equal(app.musicModel.calls.length, 0);
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("asks the planner to think about the music like an editor: fit to the product, the cuts on the beat, quiet under speech, no vocals", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(musicRequest(sheet)));

    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    const prompt = JSON.stringify(planned?.prompt);
    for (const need of [/music/i, /BPM/, /cut/i, /beat/i, /instrumental/i, /quieter/i, /6\.0 s/]) assert.match(prompt, need);
  });

  it("still gives the video when the music fails, says so, and gives the music money back", async () => {
    const failing = fakeMusicModel({ failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: BRIEF } } }), undefined, { musicModel: failing });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(musicRequest(sheet)));

    assert.ok(finishedVideo(events));
    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /musik/i);
    assert.equal((await usageOf(app)).monthUsd, 1);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("keeps the music booked when the call timed out, because it may still be billed", async () => {
    const timedOut = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: BRIEF } } }), undefined, { musicModel: fakeMusicModel({ failWith: timedOut }) });
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(musicRequest(sheet)));

    assert.equal((await usageOf(app)).monthUsd, 1.04);
  });

  it("makes the music once for a video that stopped part way, when the missing clips are remade", async () => {
    const model = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: BRIEF, level: 0.2 } } }), undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const first = await readEvents(await app.chat(musicRequest(sheet)));
    const partial = first.find((event) => event.type === "video_partial");
    assert.ok(partial && partial.type === "video_partial");
    // The music is made after the clips, so nothing was made or booked for it yet.
    assert.equal(app.musicModel.calls.length, 0);
    assert.deepEqual(partial.music, { brief: BRIEF, gain: 0.2 });

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          resume: {
            seconds: partial.seconds,
            clips: partial.clips,
            finished: partial.finished,
            voiceOver: partial.voiceOver,
            directions: partial.directions,
            audio: partial.audio,
            voice: partial.voice,
            captions: partial.captions,
            grade: partial.grade,
            palette: partial.palette,
            music: partial.music,
          },
          confirmedUsd: 1.04,
        }),
      ),
    );

    assert.equal(app.musicModel.calls.length, 1);
    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    assert.ok((await levelAround(new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes), 1000)) > -46);
  });
});

describe("confirming an expensive video", () => {
  const confirmationOf = (events: ChatEvent[]) => events.find((event) => event.type === "confirmation_requested");

  it("asks first when the video would cost more than US$1, and spends nothing until the seller agrees", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 20 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 20 detik", sheet)));

    const ask = confirmationOf(events);
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 2);
    assert.match(ask.message, /20 detik/);
    assert.match(ask.message, /US\$2\.00/);
    assert.match(ask.message, /Rp36\.400/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes the video once the same request is sent again with the seller's yes", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 20 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 20 detik", sheet, { confirmedUsd: 2 })));

    assert.equal(confirmationOf(events), undefined);
    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 3);
    assert.equal((await usageOf(app)).monthUsd, 2);
  });

  it("asks again when the video would now cost more than the price the seller said yes to", async () => {
    // The seller agreed to US$2.00, but this time the request is read as 30 seconds (US$3.00).
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 30 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 20 detik", sheet, { confirmedUsd: 2 })));

    const ask = confirmationOf(events);
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 3);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("starts straight away at US$1 or less, with no question", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    assert.equal(confirmationOf(events), undefined);
    assert.ok(finishedVideo(events));
  });
});

describe("recovering from a failed clip", () => {
  const partialOf = (events: ChatEvent[]) => events.find((event) => event.type === "video_partial");
  const rejected = Object.assign(new Error("bad request"), { statusCode: 400 });

  async function failSecondClip() {
    const model = fakeVideoModel({ failOnClip: 1, failWith: rejected });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));
    return { app, sheet, events };
  }

  it("keeps the clips that were made, saves them, and says which part failed", async () => {
    const { app, sheet, events } = await failSecondClip();

    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.seconds, 10);
    assert.deepEqual(partial.clips, [6, 4]);
    assert.deepEqual(Object.keys(partial.finished), ["0"]);
    assert.equal(partial.failedIndex, 1);
    assert.equal(partial.sourceAssetId, sheet);
    // Each direction is the planner's own, followed by what is said in that clip (here: nothing, nobody speaks).
    assert.equal(partial.directions.length, 2);
    partial.directions.forEach((direction, index) => assert.ok(direction.startsWith(directionOf(index)), direction));
    assert.equal(partial.audio, "none");
    assert.equal((await app.store.read(partial.finished[0], "original"))?.mediaType, "video/mp4");
    assert.match(errorOf(events)?.message ?? "", /klip 2 dari 2/i);
    assert.equal(finishedVideo(events), undefined);
  });

  it("never retries a clip by itself", async () => {
    const { app } = await failSecondClip();

    assert.equal(app.videoModel.calls.length, 2);
  });

  it("remakes only the failed clip when the seller asks, and finishes the video", async () => {
    const { app, sheet, events } = await failSecondClip();
    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          resume: { seconds: partial.seconds, clips: partial.clips, finished: partial.finished, directions: partial.directions },
          artDirection: ART,
        }),
      ),
    );

    // One more call in total: the 4 s clip, from the same picture and with the direction the first try gave it,
    // so the remade part still fits the clip that was kept.
    assert.equal(app.videoModel.calls.length, 3);
    assert.equal(app.videoModel.calls[2].seconds, 4);
    assert.match(app.videoModel.calls[2].prompt, new RegExp(directionOf(1)));
    assert.ok(app.videoModel.calls[2].prompt.includes(ART), "the remade clip keeps the look of the others");
    assert.deepEqual(Buffer.from(app.videoModel.calls[2].frame.bytes), await storedSheet(app, sheet));

    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);
    // The finished clip stays booked from the first try (US$0.60); the remade clip adds US$0.40.
    assert.equal((await usageOf(app)).monthUsd, 1);
    assert.deepEqual(resumed.at(-1), { type: "done" });
  });

  it("asks first when remaking the missing clips would cost more than US$1, like any expensive video", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);
    const resume = { seconds: 12, clips: [4, 4, 4], finished: {}, directions: ["a", "b", "c"] };

    const events = await readEvents(await app.chat(videoRequest("Coba ulang bagian yang gagal.", sheet, { resume })));

    const ask = events.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 1.2);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 0);

    const agreed = await readEvents(await app.chat(videoRequest("Coba ulang bagian yang gagal.", sheet, { resume, confirmedUsd: 1.2 })));
    assert.ok(finishedVideo(agreed));
    assert.equal(app.videoModel.calls.length, 3);
  });

  it("updates the usage meter after a failure, since a clip stays booked", async () => {
    const { events } = await failSecondClip();

    assert.deepEqual(events.findLast((event) => event.type === "usage_updated"), { type: "usage_updated", monthUsd: 0.6 });
  });

  it("remembers that a voice-over was asked for, and adds it when the missing clips are remade", async () => {
    const model = fakeVideoModel({ failOnClip: 1, failWith: rejected });
    const chat = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true });
    const app = createTestApp(chat, undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const first = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet, { scenes: ["A", "B"] })));
    const partial = partialOf(first);
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.voiceOver, true);

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          scenes: ["A", "B"],
          resume: {
            seconds: partial.seconds,
            clips: partial.clips,
            finished: partial.finished,
            voiceOver: partial.voiceOver,
            directions: partial.directions,
          },
        }),
      ),
    );

    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
    assert.equal(app.speechModel.calls.length, 1);
    assert.ok(resumed.some((event) => event.type === "voice_over"));
    // US$0.60 stays from the first try, the remade 4 s clip adds US$0.40 and the voice US$0.003.
    assert.equal((await usageOf(app)).monthUsd, 1.003);
  });

  it("does not add a voice-over to a resumed video that did not ask for one", async () => {
    const { app, sheet, events } = await failSecondClip();
    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.voiceOver, false);

    await app.chat(
      videoRequest("Coba ulang bagian yang gagal.", sheet, {
        resume: { seconds: 10, clips: partial.clips, finished: partial.finished, directions: partial.directions },
      }),
    );

    assert.equal(app.speechModel.calls.length, 0);
  });

  it("books only the clips still missing when it resumes", async () => {
    const { app, sheet, events } = await failSecondClip();
    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");
    // A new app starts from zero, so what it books is only what this resume made: the kept clip is not paid for again.
    const fresh = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const freshSheet = await uploadSheet(fresh);
    const keptClip = await fresh.store.saveVideo(new Uint8Array((await app.store.read(partial.finished[0], "original"))!.bytes));

    const resumed = await readEvents(
      await fresh.chat(
        videoRequest("Coba ulang bagian yang gagal.", freshSheet, {
          resume: { seconds: 10, clips: [6, 4], finished: { 0: keptClip }, directions: partial.directions },
        }),
      ),
    );

    assert.ok(finishedVideo(resumed));
    // Only the missing 4 s clip is booked (US$0.40).
    assert.equal((await usageOf(fresh)).monthUsd, 0.4);
    void sheet;
  });
});

describe("voice-over", () => {
  const SCRIPT = "Ayo cobain produk keren ini sekarang juga, kualitasnya bikin kamu jatuh cinta!";
  const SCENES = ["Scene A", "Scene B", "Scene C", "Scene D"];
  const voiceOverOf = (events: ChatEvent[]) => events.find((event) => event.type === "voice_over");

  it("lays one narration over the whole video, from a script written for its length and scenes, and shows the script", async () => {
    const chat = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, script: SCRIPT });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(
      await app.chat(videoRequest("video 10 detik pakai voice over", sheet, { scenes: SCENES })),
    );

    // The script is written once, for about 25 to 30 spoken words in 10 seconds, from the scenes.
    const written = chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: voice-script]"));
    assert.equal(written.length, 1);
    assert.match(JSON.stringify(written[0].prompt), /25 to 30 spoken words/);
    assert.match(JSON.stringify(written[0].prompt), /Scene A/);

    // It is read aloud once, with one voice, and laid over the video.
    assert.deepEqual(app.speechModel.calls.map((call) => call.text), [SCRIPT]);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.equal(probe.hasAudio, true);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);

    const voice = voiceOverOf(events);
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.script, SCRIPT);
    // The video is US$1.00 and the voice a few thousandths of a dollar, both on the meter.
    assert.equal((await usageOf(app)).monthUsd, 1.003);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes a silent video when no voice-over is asked for", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: false }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    assert.equal(app.speechModel.calls.length, 0);
    assert.equal(voiceOverOf(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("gives the voice back when a clip fails before any voice was made", async () => {
    const failing = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true }), undefined, {
      videoModel: failing,
    });
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet)));

    // Only the 6 s clip that came out stays booked, with no voice cost on top.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
    assert.equal(app.speechModel.calls.length, 0);
  });

  it("keeps the voice booked when it was made and billed but laying it over the video failed", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true }), undefined, {
      speechModel: fakeSpeechModel({ garbage: true }),
    });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet)));

    assert.ok(finishedVideo(events));
    assert.equal(app.speechModel.calls.length, 1);
    assert.equal((await usageOf(app)).monthUsd, 1.003);
  });

  it("does not read a written script aloud when it is far too long for the video, and gives the voice back", async () => {
    const stretched = Array.from({ length: 28 }, () => "a".repeat(80)).join(" ");
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, script: stretched }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet)));

    assert.ok(finishedVideo(events));
    assert.equal(app.speechModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("still gives the silent video when the voice fails, says so, and gives the voice back", async () => {
    const failing = fakeSpeechModel({ failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true }), undefined, {
      speechModel: failing,
    });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet)));

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    // The narration is missing, the sound effects of the clips are not.
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /narasi/i);
    assert.equal(voiceOverOf(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 1);
    assert.deepEqual(events.at(-1), { type: "done" });
  });
});

describe("revising the voice-over", () => {
  const SCRIPT = "Ayo cobain produk keren ini sekarang juga, kualitasnya bikin kamu jatuh cinta!";

  /** A finished video with a narration, and what a revision request needs to know about it. */
  async function narratedVideo(chatOptions: Parameters<typeof fakeChatModel>[0]) {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, script: SCRIPT }));
    const sheet = await uploadSheet(app);
    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet)));
    const voice = events.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    // The same app, but now the chat model reads a revision (a new fake model stands in for it).
    const revising = createTestApp(fakeChatModel(chatOptions), undefined, { videoModel: app.videoModel, speechModel: app.speechModel });
    const silent = await app.store.read(voice.silentAssetId, "original");
    const silentAssetId = await revising.store.saveVideo(new Uint8Array(silent!.bytes));
    return {
      app: revising,
      first: app,
      revise: { silentAssetId, seconds: voice.seconds, script: voice.script, voice: voice.voice },
    };
  }

  const reviseRequest = (text: string, revise: object) => chatRequest({ messages: [{ role: "user", text }], revise });

  it("changes the script and reads it again, without making any clip again", async () => {
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { script: "Halo semua, ini produk andalan kami!" } });
    const clipsBefore = app.videoModel.calls.length;

    const events = await readEvents(await app.chat(reviseRequest("ganti narasinya jadi: Halo semua, ini produk andalan kami!", revise)));

    assert.equal(app.videoModel.calls.length, clipsBefore);
    assert.equal(app.speechModel.calls.at(-1)?.text, "Halo semua, ini produk andalan kami!");
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.equal(probe.hasAudio, true);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);
    const voice = events.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.script, "Halo semua, ini produk andalan kami!");
    assert.equal(voice.silentAssetId, revise.silentAssetId);
    // A revision costs only the voice: US$0.003 for 10 seconds.
    assert.equal((await usageOf(app)).monthUsd, 0.003);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("keeps the way of speaking when only the voice changes", async () => {
    const DELIVERY = "Warm and lively, rising on the product, smiling at the end.";
    const first = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, script: SCRIPT, delivery: DELIVERY }));
    const sheet = await uploadSheet(first);
    const made = await readEvents(await first.chat(videoRequest("video 10 detik pakai voice over", sheet)));
    const voice = made.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    const revising = createTestApp(fakeChatModel({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { voice: "male" } }), undefined, {
      videoModel: first.videoModel,
      speechModel: first.speechModel,
    });
    const silent = await first.store.read(voice.silentAssetId, "original");
    const silentAssetId = await revising.store.saveVideo(new Uint8Array(silent!.bytes));

    await readEvents(
      await revising.chat(
        reviseRequest("pakai suara cowok", { silentAssetId, seconds: voice.seconds, script: voice.script, voice: voice.voice, delivery: voice.delivery }),
      ),
    );

    const call = revising.speechModel.calls.at(-1);
    assert.equal(call?.voice, VOICES.male);
    assert.equal(call?.instructions, DELIVERY);
  });

  it("changes only the voice and keeps the script", async () => {
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { voice: "male" } });

    const events = await readEvents(await app.chat(reviseRequest("pakai suara cowok", revise)));

    const call = app.speechModel.calls.at(-1);
    assert.equal(call?.text, SCRIPT);
    assert.equal(call?.voice, VOICES.male);
    const voice = events.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.script, SCRIPT);
    assert.equal(voice.voice, VOICES.male);
  });

  it("books the voice by the real length of the video, not by the length the request claims", async () => {
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { voice: "male" } });

    await readEvents(await app.chat(reviseRequest("pakai suara cowok", { ...revise, seconds: 1 })));

    // The video is 10 seconds long: US$0.003, not the US$0.0003 of the one second that was claimed.
    assert.equal((await usageOf(app)).monthUsd, 0.003);
  });

  it("refuses a script that is too long for the video, and spends nothing", async () => {
    const tooLong = Array.from({ length: 80 }, (_, index) => `kata${index}`).join(" ");
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { script: tooLong } });
    const speechBefore = app.speechModel.calls.length;

    const events = await readEvents(await app.chat(reviseRequest("ganti narasinya jadi yang panjang", revise)));

    assert.equal(app.speechModel.calls.length, speechBefore);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.match(events.flatMap((e) => (e.type === "assistant_text" ? [e.text] : [])).join(""), /terlalu panjang/i);
  });

  it("refuses a script that has few words but is far too long in letters, since the voice is billed by its length", async () => {
    // 30 words fit a 10 second video, but each of these is 80 letters long.
    const stretched = Array.from({ length: 30 }, () => "a".repeat(80)).join(" ");
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { script: stretched } });
    const speechBefore = app.speechModel.calls.length;

    const events = await readEvents(await app.chat(reviseRequest("ganti narasinya", revise)));

    assert.equal(app.speechModel.calls.length, speechBefore);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("asks what to change when it cannot tell, and spends nothing", async () => {
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: {} });
    const speechBefore = app.speechModel.calls.length;

    const events = await readEvents(await app.chat(reviseRequest("hmm gimana ya", revise)));

    assert.equal(app.speechModel.calls.length, speechBefore);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.match(events.flatMap((e) => (e.type === "assistant_text" ? [e.text] : [])).join(""), /narasi|suara/i);
  });
});

describe("video spending", () => {
  it("gives back the clips that were not made when one fails, and keeps the ones that were", async () => {
    const failing = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: failing });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    assert.equal(errorOf(events)?.type, "error");
    assert.equal(finishedVideo(events), undefined);
    // The 6 s clip was made (US$0.60) and is kept; the 4 s clip failed and is given back.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
  });

  it("keeps the booking of a clip that timed out, because it may still be billed", async () => {
    const timedOut = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const failing = fakeVideoModel({ failOnClip: 0, failWith: timedOut });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: failing });
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    // The first clip (6 s, US$0.60) stays booked; the clip that never started (4 s) is given back.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
  });
});
