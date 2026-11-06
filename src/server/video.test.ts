import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VOICES } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import { MAX_BRIEF_CHARS } from "../shared/storyboard";
import { fakeChatModel } from "./testing/fake-models";
import { fakeMusicModel } from "./testing/fake-music-model";
import { fakeSpeechModel } from "./testing/fake-speech-model";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";
import { colourfulness, levelAround, levelAroundBetween, probeVideo } from "./testing/probe-video";

/**
 * Feature 3 through the chat API: a video made from the one storyboard picture, with the length the planner chooses.
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

/** A request with the storyboard picture the video is made from. */
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
  it("makes a silent video of the length the planner chose, every clip from the one storyboard picture, and books the cost per second", async () => {
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

  it("makes the length the planner chose, here 10 seconds, when the seller names none", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO" }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(videoRequest("bikinin video dong", sheet)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
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

/** The "Generate" button under a storyboard picture: a flag with no options, since the planner chooses the length. */
describe("video from the button of a storyboard picture", () => {
  const buttonRequest = (sheet: string | undefined, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: true, ...extra });

  it("fits 10, 20 and 30 seconds with 2, 3 and 4 clips that add up to the length, all from the same picture", async () => {
    for (const [seconds, clips] of [
      [10, [6, 4]],
      [20, [8, 6, 6]],
      [30, [8, 8, 8, 6]],
    ] as const) {
      const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: seconds }));
      const sheet = await uploadSheet(app);

      const events = await readEvents(await app.chat(buttonRequest(sheet, { confirmedUsd: 3 })));

      assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), clips, `${seconds} s`);
      for (const [index, call] of app.videoModel.calls.entries()) {
        assert.deepEqual(Buffer.from(call.frame.bytes), await storedSheet(app, sheet));
        assert.match(call.prompt, new RegExp(directionOf(index)));
      }
      assert.ok(finishedVideo(events), `${seconds} s`);
    }
  });

  it("asks the text model to share the scenes over the clips in order, and does not ask what the seller meant", async () => {
    // The router would call this message plain chat: the button decides.
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 20 });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);
    const scenes = ["Satu di dapur", "Dua di meja", "Tiga", "Empat", "Lima", "Enam di kasir"];

    await readEvents(await app.chat(buttonRequest(sheet, { scenes, confirmedUsd: 2 })));

    const planned = chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.equal(planned.length, 1);
    const prompt = JSON.stringify(planned[0].prompt);
    assert.equal(app.videoModel.calls.length, 3);
    assert.ok(prompt.indexOf("Satu di dapur") < prompt.indexOf("Enam di kasir"));
    // Only the product check of the picture and this plan asked the chat model anything.
    assert.equal(chat.doGenerateCalls.length, 2);
  });

  it("makes no video when the text model cannot plan the clips, and books nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], failVideoPlan: true }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { confirmedUsd: 1 })));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(errorOf(events)?.type, "error");
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("makes the video from a picture that shows a person using the product, since it is the app's own picture", async () => {
    // A real run showed a smiling man holding the gamepad; the strict photo check calls that "a person" and stopped the video.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], peopleInPictures: true }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { confirmedUsd: 1 })));

    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 2);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("takes the button as a flag, and refuses a value that is neither a flag nor an object", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    for (const video of [true, {}]) {
      assert.equal((await app.chat(videoRequest("Buat video.", sheet, { video }))).status, 200, JSON.stringify(video));
    }
    for (const video of ["yes", 20, null, false]) {
      assert.equal((await app.chat(videoRequest("Buat video.", sheet, { video }))).status, 400, JSON.stringify(video));
    }
  });

  it("always asks for the price first, whatever the length, and spends nothing until the seller agrees", async () => {
    // A typed request under US$1 starts at once; the button never does: pressing it shows the price, and yes makes the video.
    for (const [seconds, usd] of [
      [10, 1],
      [20, 2],
      [30, 3],
    ] as const) {
      const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: seconds }));
      const sheet = await uploadSheet(app);

      const events = await readEvents(await app.chat(buttonRequest(sheet)));

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
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 20, voiceOver: true }));
    const sheet = await uploadSheet(app);
    const scenes = ["a", "b", "c", "d"];

    // 20 seconds of video is US$2.00 and 20 seconds of narration US$0.006.
    const asked = await readEvents(await app.chat(buttonRequest(sheet, { scenes })));
    const ask = asked.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 2.006);

    // A yes to the price of the picture alone does not cover the narration: the question comes again.
    const short = await readEvents(await app.chat(buttonRequest(sheet, { scenes, confirmedUsd: 2 })));
    assert.ok(short.some((event) => event.type === "confirmation_requested"));
    assert.equal(app.videoModel.calls.length, 0);

    const agreed = await readEvents(await app.chat(buttonRequest(sheet, { scenes, confirmedUsd: 2.006 })));
    assert.ok(finishedVideo(agreed));
    assert.equal((await usageOf(app)).monthUsd, 2.006);
  });

  it("lays the narration over the video when the planner chose a voice-over", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { narration: [{ line: "Lapar banget ya?" }, { line: "Yuk, pesan sekarang!" }] } }));
    const sheet = await uploadSheet(app);
    const scenes = ["Scene satu", "Scene dua", "Scene tiga", "Scene empat"];

    const events = await readEvents(await app.chat(buttonRequest(sheet, { scenes, confirmedUsd: 1.003 })));

    const narration = events.find((event) => event.type === "voice_over");
    assert.ok(narration && narration.type === "voice_over");
    assert.equal(narration.script, "Lapar banget ya? Yuk, pesan sekarang!");
    assert.equal(narration.seconds, 10);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.equal(probe.hasAudio, true);
  });

  it("makes the longest video with a voice-over however much was already spent today", async () => {
    // The 30 second video costs US$3.00 and its narration US$0.009; there is no daily limit to stop it.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 30, voiceOver: true }), undefined, { startingTodayUsd: 10 });
    const sheet = await uploadSheet(app);

    const events = await readEvents(
      await app.chat(buttonRequest(sheet, { scenes: ["a", "b", "c", "d"], confirmedUsd: 3.009 })),
    );

    assert.equal(errorOf(events), undefined);
    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 4);
  });

  it("makes a silent video when the planner chose no voice-over", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 20, voiceOver: false }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { confirmedUsd: 2 })));

    assert.equal(events.some((event) => event.type === "voice_over"), false);
    assert.equal(app.speechModel.calls.length, 0);
  });

  it("asks for the storyboard first when the button is pressed without a storyboard picture", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(await app.chat(buttonRequest(undefined)));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /storyboard/i);
    assert.equal(app.videoModel.calls.length, 0);
  });
});

/** The sound of the video: the actor is silent and a narrator speaks one line for each moment of the acting. */
describe("a video that sounds and moves naturally", () => {
  const PROFILE = "Warm young Indonesian man, relaxed and friendly, medium pace";
  const buttonRequest = (sheet: string | undefined, extra: object = {}) => videoRequest("Buat video dari storyboard ini.", sheet, { video: true, ...extra });
  const voiceRequest = (sheet: string) => buttonRequest(sheet, { scenes: ["a", "b", "c", "d", "e", "f"], confirmedUsd: 1.003 });

  it("keeps the actor silent and has a narrator, in the voice that suits the actor, say what the actor feels", async () => {
    const chat = fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { voice: "male", voiceProfile: PROFILE } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(voiceRequest(sheet)));

    // The person does not speak, so there is no lip-sync to fight the narration; every line is read in the one voice.
    for (const call of app.videoModel.calls) {
      assert.match(call.prompt, /person does not speak \(a narrator is added later\)/i);
      assert.doesNotMatch(call.prompt, /lip movement|says in Indonesian/i);
    }
    assert.ok(app.speechModel.calls.length >= 1);
    assert.ok(app.speechModel.calls.every((call) => call.voice === VOICES.male));
  });

  it("reads each line of the narration with the emotion of the moment it belongs to, in the same voice", async () => {
    const LINES = [
      { line: "Duh, lapar banget nih...", delivery: "Weary and wishful, drawn-out vowels, almost a sigh", from: 0.5 },
      { line: "Nih, Burger Spesial paling juara!", delivery: "Bright and excited, rising on the reveal", from: 0.5 },
    ];
    const app = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { voice: "male", voiceProfile: PROFILE, narration: LINES } }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    // One reading for each line, in order, each told how to feel; the voice is described the same way every time.
    assert.deepEqual(
      app.speechModel.calls.map((call) => call.text),
      LINES.map((line) => line.line),
    );
    app.speechModel.calls.forEach((call, index) => {
      assert.equal(call.voice, VOICES.male);
      assert.ok(call.instructions?.includes(PROFILE), "the same voice");
      assert.ok(call.instructions?.includes(LINES[index].delivery), "the emotion of its moment");
    });
    const voice = events.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.script, LINES.map((line) => line.line).join(" "));
    assert.equal(voice.lines.length, 2);
  });

  it("places each line at the moment of its clip, and leaves the end of the video free of narration", async () => {
    // Two lines of 2 s: the first at 0.5 s of the first clip, the second at 0.5 s of the second clip, which starts at 6 s.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { narration: [{ line: "Satu dua tiga", from: 0.5 }, { line: "Empat lima enam", from: 0.5 }] } }), undefined, {
      speechModel: fakeSpeechModel({ seconds: 2 }),
    });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const bytes = new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes);
    const heard = async (start: number, length: number) => levelAroundBetween(bytes, 1500, start, length);
    assert.ok((await heard(1, 1.2)) > -45, "the first line is heard at its moment");
    assert.ok((await heard(3.3, 2.2)) < -52, "and nothing is said between the lines");
    assert.ok((await heard(7, 1.2)) > -45, "the second line is heard at its moment");
    assert.ok((await heard(8.8, 1)) < -52, "and the last second and a half of the video is free of narration");
  });

  it("speeds a line up a little and starts it earlier when it is too long for its moment, instead of cutting it off", async () => {
    // The second clip is 4 s and the video ends on a held second and a half: a line from 0.5 s has 2 s, this one is 2.5 s.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { narration: [{ line: "Satu dua", from: 0.5 }, { line: "Empat lima enam", from: 0.5 }] } }), undefined, {
      speechModel: fakeSpeechModel({ seconds: 2.5 }),
    });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(voiceRequest(sheet)));

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const bytes = new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.equal(app.speechModel.calls.length, 2);
    assert.ok((await levelAroundBetween(bytes, 1500, 7.5, 0.8)) > -45, "the line is heard");
    assert.ok((await levelAroundBetween(bytes, 1500, 8.8, 1)) < -52, "and is over before the held end of the video");
    assert.ok(Math.abs((await probeVideo(bytes)).seconds - 10) < 0.6);
  });

  it("keeps the picture quality of the clips when it joins them, instead of compressing it down to a soft image", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(buttonRequest(sheet, { confirmedUsd: 1 })));

    // The clips come as 6 s and 4 s files; the joined video must not carry less detail per second than they did.
    const clipBytes = app.videoModel.calls.length > 0 ? await clipBitrate() : 0;
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const joined = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.ok(joined.videoBitrate >= clipBytes * 1.2, `joined ${joined.videoBitrate} bps against clips of ${clipBytes} bps`);
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
    assert.match(prompt, /narrator/i);
    assert.match(prompt, /voice that suits/i);
  });

  it("remakes a stopped video with the same narration lines, which are read once the clips are made", async () => {
    const model = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const LINES = [{ line: "Duh, lapar banget nih..." }, { line: "Yuk, pesan sekarang!" }];
    const app = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { voice: "male", voiceProfile: PROFILE, narration: LINES } }), undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const first = await readEvents(await app.chat(voiceRequest(sheet)));
    const partial = first.find((event) => event.type === "video_partial");
    assert.ok(partial && partial.type === "video_partial");
    // The voice is made after the clips, so nothing was read yet, and the lines are kept for the next try.
    assert.equal(app.speechModel.calls.length, 0);
    assert.deepEqual(partial.narration.map((line) => line.text), LINES.map((line) => line.line));

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          resume: {
            seconds: partial.seconds,
            clips: partial.clips,
            finished: partial.finished,
            voiceOver: partial.voiceOver,
            directions: partial.directions,
            voice: partial.voice,
            narration: partial.narration,
          },
        }),
      ),
    );

    assert.deepEqual(app.speechModel.calls.map((call) => call.text), LINES.map((line) => line.line));
    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
  });
});

describe("a video that is finished like a professional edit", () => {
  const buttonRequest = (sheet: string | undefined, extra: object = {}) => videoRequest("Buat video dari storyboard ini.", sheet, { video: true, ...extra });

  const voiceRequestFor = (sheet: string) => buttonRequest(sheet, { scenes: ["a", "b", "c", "d", "e", "f"], confirmedUsd: 1.003 });

  async function finished(videoPlan: Parameters<typeof fakeChatModel>[0]["videoPlan"], extra: object = {}) {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan }));
    const sheet = await uploadSheet(app);
    const events = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1, ...extra })));
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    return { app, sheet, events, bytes: new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes) };
  }

  it("asks the planner for a colour grade like a colourist, and gives it the word limit of a narration line for every length", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    await readEvents(await app.chat(buttonRequest(await uploadSheet(app), { confirmedUsd: 1 })));

    const prompt = JSON.stringify(chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"))?.prompt);
    for (const need of [/colourist/i, /grain/i, /vignette/]) assert.match(prompt, need);
    // 10 seconds: a 6 s and a 4 s clip, so 12 and 5 words (the last clip keeps a held ending).
    assert.match(prompt, /10 seconds: 2 clips of 6, 4 seconds; a narration line of at most 12, 5 words/);
  });

  it("keeps what is said in a clip within the seconds it has, dropping the sentences that would be cut off, and leaves room at the end", async () => {
    const long = "Pesan sekarang juga ya! Stok terbatas banget hari ini! Jangan sampai kehabisan, cepat klik tombol beli di bawah!";
    const app = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true, videoPlan: { voice: "male", narration: [{ line: "Duh, perut keroncongan banget nih!" }, { line: long }] } }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(voiceRequestFor(sheet)));

    // The last clip is 4 s with the end held: room for about five words, so only the first sentence is read.
    assert.equal(app.speechModel.calls[1].text, "Pesan sekarang juga ya!");
  });

  it("gives every clip the one colour grade the planner chose, so the clips match", async () => {
    const vivid = await finished({ grade: { saturation: 1.2, grain: 0, vignette: false } });
    const muted = await finished({ grade: { saturation: 0.85, grain: 0, vignette: false } });

    assert.ok((await colourfulness(vivid.bytes, 1)) > (await colourfulness(muted.bytes, 1)) * 1.1, "first clip");
    assert.ok((await colourfulness(vivid.bytes, 7)) > (await colourfulness(muted.bytes, 7)) * 1.1, "second clip");
  });

  it("keeps the grade when a stopped video is remade", async () => {
    const model = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { grade: { saturation: 1.2, grain: 0, vignette: false } } }), undefined, { videoModel: model });
    const sheet = await uploadSheet(app);
    const first = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1 })));
    const partial = first.find((event) => event.type === "video_partial");
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.grade.saturation, 1.2);

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", sheet, {
          resume: {
            seconds: partial.seconds,
            clips: partial.clips,
            finished: partial.finished,
            voiceOver: partial.voiceOver,
            directions: partial.directions,
            voice: partial.voice,
            grade: partial.grade,
          },
        }),
      ),
    );

    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    const bytes = new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes);
    const muted = await finished({ grade: { saturation: 0.85, grain: 0, vignette: false } });
    assert.ok((await colourfulness(bytes, 1)) > (await colourfulness(muted.bytes, 1)) * 1.1, "the kept clip is graded as the first try chose");
    assert.ok((await colourfulness(bytes, 7)) > (await colourfulness(muted.bytes, 7)) * 1.1, "and so is the remade clip");
  });
});

/** The music bed: designed by the planner for this ad, free of vocals, quiet under what is said, and part of the price. */
describe("music under the video", () => {
  const BRIEF = "Upbeat lo-fi hip hop at 92 BPM in D minor, warm Rhodes piano and soft drums, steady energy from the first beat.";
  const musicRequest = (sheet: string, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1.04, ...extra });

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

  it("makes a video with no music at all when the planner chose none", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1 })));

    assert.equal(app.musicModel.calls.length, 0);
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.ok((await levelAround(new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes), 1000)) < -48);
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("includes the music in the price it asks for, so the seller agrees to what is booked", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: BRIEF } } }));
    const sheet = await uploadSheet(app);

    const asked = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: true })));
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
            voice: partial.voice,
            grade: partial.grade,
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

/** The video model is given the storyboard picture as it is. The app draws no text and cleans nothing. */
describe("the storyboard picture as the reference of the video model", () => {
  const request = (sheet: string, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1, ...extra });
  it("makes every clip from the storyboard picture as it is, with no picture drawn first and none booked", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(request(sheet)));

    assert.equal(app.imageModel.calls.length, 0);
    const original = await storedSheet(app, sheet);
    assert.ok(app.videoModel.calls.length > 0);
    for (const call of app.videoModel.calls) assert.deepEqual(Buffer.from(call.frame.bytes), original);
    assert.equal(events.some((event) => event.type === "asset_ready" && event.kind === "image"), false);
    assert.ok(finishedVideo(events));
    // Only the video is booked: US$0.10 a second for 10 seconds.
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("ignores a clean copy sent by an older browser, and still starts every clip from the storyboard picture", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);
    const other = await uploadPhoto(app, "#33cc33");

    await readEvents(await app.chat(request(sheet, { cleanSheet: other })));

    const original = await storedSheet(app, sheet);
    assert.ok(app.videoModel.calls.length > 0);
    for (const call of app.videoModel.calls) assert.deepEqual(Buffer.from(call.frame.bytes), original);
  });

  it("asks for the price of the video alone, and a yes to it is enough", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    const asked = await readEvents(await app.chat(request(sheet, { confirmedUsd: undefined })));
    const ask = asked.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 1);
    assert.equal(app.videoModel.calls.length, 0);

    const agreed = await readEvents(await app.chat(request(sheet, { confirmedUsd: 1 })));
    assert.equal(agreed.some((event) => event.type === "confirmation_requested"), false);
    assert.ok(finishedVideo(agreed));
  });
});

/** The video model decides everything about how the ad looks and sounds: the app only names the part and what is added later. */
describe("the video model is given no rules of ours", () => {
  const request = (sheet: string, extra: object = {}) => videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1.04, ...extra });
  const planPrompt = (chat: ReturnType<typeof fakeChatModel>) =>
    JSON.stringify(chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"))?.prompt);
  // Every word of advice we used to give: how to move, act, sound, grade, show text, or what a storyboard sheet is.
  const OLD_RULES =
    /sound design|sound effects|room tone|micro-expression|push-in|frozen pose|something moves|colou?r grade|effects|professional|camera|emotion|text|caption|art direction|grid|panel|dissolve|never|no voice/i;

  it("says only that the picture is the storyboard of an ad and which part this clip plays, in a few words", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(request(sheet, { artDirection: ART, scenes: ["a", "b", "c", "d", "e", "f"] })));

    assert.equal(app.videoModel.calls.length, 2);
    app.videoModel.calls.forEach((call, index) => {
      assert.match(call.prompt, /storyboard of an ad/i);
      // What the picture is is information, not a rule: a plan of scenes to film, not footage to copy.
      assert.match(call.prompt, /a plan of its scenes to film, not footage/i);
      assert.ok(call.prompt.includes(directionOf(index)), `clip ${index + 1} plays its own part`);
      assert.ok(call.prompt.length < 220, `short: ${call.prompt.length} letters`);
      assert.doesNotMatch(call.prompt, OLD_RULES);
      // The look is already in the picture, so the art direction is not repeated to the video model.
      assert.equal(call.prompt.includes(ART.slice(0, 30)), false);
    });
  });

  it("gives the planner the scenes by number only, and asks each clip's direction to carry the scene's story and caption words", async () => {
    // A real run's clip drew the label "4. Opening" because the directions talked about panels and titles.
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);
    const scenes = ["a man scratches his head. Caption: \"Duh, susah!\"", "b", "c", "d", "e", "f. Caption: \"Yuk, Pesan Sekarang!\""];

    await readEvents(await app.chat(request(sheet, { artDirection: ART, scenes })));

    const prompt = planPrompt(chat);
    assert.match(prompt, /Scene 1: a man scratches his head/);
    assert.match(prompt, /Scene 6: f. Caption: \\"Yuk, Pesan Sekarang!\\"/);
    // No titles to reuse, and no talk of panels.
    assert.doesNotMatch(prompt, /Opening|Perkenalan Produk|Detail Produk|Menikmati|Keunggulan|Closing|panel/i);
    // The direction is the story in plain words, with the caption words as they were written; nothing about how the text looks.
    assert.match(prompt, /as a film scene/i);
    assert.match(prompt, /caption/i);
    assert.match(prompt, /copied as written/i);
    assert.doesNotMatch(prompt, /font|bubble|colou?r of the text|typeface/i);
  });

  it("logs the prompt of every clip, and only the prompt, so what the video model was told can be seen", async () => {
    const logged: string[] = [];
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { log: (message) => logged.push(message) });
    const sheet = await uploadSheet(app);

    await readEvents(await app.chat(request(sheet)));

    assert.equal(logged.length, app.videoModel.calls.length);
    logged.forEach((message, index) => {
      assert.equal(message, `[clip ${index + 1}/${logged.length}] prompt: ${app.videoModel.calls[index].prompt}`);
    });
  });

  it("tells the video model the person does not speak only when the planner chose a voice-over", async () => {
    const voiced = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: true }));
    await readEvents(await voiced.chat(request(await uploadSheet(voiced), { confirmedUsd: 1.003 })));
    const silent = createTestApp(fakeChatModel({ chunks: ["x"], voiceOver: false }));
    await readEvents(await silent.chat(request(await uploadSheet(silent), { confirmedUsd: 1 })));

    assert.ok(voiced.videoModel.calls.length > 0 && silent.videoModel.calls.length > 0);
    for (const call of voiced.videoModel.calls) assert.match(call.prompt, /the person does not speak \(a narrator is added later\)/i);
    for (const call of silent.videoModel.calls) assert.doesNotMatch(call.prompt, /speak|narrator/i);
  });

  it("tells the video model there is no background music only when the planner chose music", async () => {
    const withMusic = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan: { music: { brief: "Calm piano at 80 BPM." } } }));
    await readEvents(await withMusic.chat(request(await uploadSheet(withMusic))));
    const without = createTestApp(fakeChatModel({ chunks: ["x"] }));
    await readEvents(await without.chat(request(await uploadSheet(without), { confirmedUsd: 1 })));

    assert.ok(withMusic.videoModel.calls.length > 0 && without.videoModel.calls.length > 0);
    for (const call of withMusic.videoModel.calls) assert.match(call.prompt, /no background music \(it is added later\)/i);
    for (const call of without.videoModel.calls) assert.doesNotMatch(call.prompt, /music/i);
  });

  it("asks the planner only for the story each clip plays, and none of the choices the video model makes", async () => {
    const chat = fakeChatModel({ chunks: ["x"] });
    const app = createTestApp(chat);
    await readEvents(await app.chat(request(await uploadSheet(app), { confirmedUsd: 1 })));

    const prompt = planPrompt(chat);
    for (const need of [/told as a film scene/i, /none (is )?skipped/i, /think/i, /colourist/i]) assert.match(prompt, need);
    for (const gone of [/camera move/i, /push-in/i, /effects shown/i, /acting beats/i, /sound effects/i, /transition/i, /word for word/i, /never invent/i, /call to buy/i]) {
      assert.doesNotMatch(prompt, gone);
    }
  });
});

/** A little grain, never a lot, and no clip left silent. */
describe("texture that stays tasteful", () => {
  const CLEAN = { grain: 0, vignette: false };
  async function finished(videoPlan: Parameters<typeof fakeChatModel>[0]["videoPlan"]) {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoPlan }));
    const sheet = await uploadSheet(app);
    const events = await readEvents(await app.chat(videoRequest("Buat video dari storyboard ini.", sheet, { video: true, confirmedUsd: 1 })));
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    return { events, bytes: new Uint8Array((await app.store.read(ready.assetId, "original"))!.bytes) };
  }

  it("keeps the grain light, whatever the planner asked for, so the picture does not get noisy", async () => {
    const heavy = await finished({ grade: { grain: 8, vignette: false } });
    const light = await finished({ grade: { grain: 4, vignette: false } });
    const none = await finished({ grade: CLEAN });

    const bitrate = async (video: { bytes: Uint8Array }) => (await probeVideo(video.bytes)).videoBitrate;
    // A planner that asks for 8 gets the same grain as one that asks for 4, and both are grainier than none.
    assert.ok(Math.abs((await bitrate(heavy)) - (await bitrate(light))) / (await bitrate(light)) < 0.1, "grain above the limit is not used");
    assert.ok((await bitrate(light)) > (await bitrate(none)) * 1.05, "grain is still there");
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
    // The seller agreed to US$2.00, but this time the planner chooses 30 seconds (US$3.00); the request names no length.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 30 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("bikinin video iklan dong", sheet, { confirmedUsd: 2 })));

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

/** The "Generate" button has no options: the planner decides the length, the voice-over and the music, and the seller says yes to the price. */
describe("a video whose length, voice-over and music the AI chooses", () => {
  const button = (sheet: string, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: true, scenes: ["a", "b", "c", "d", "e", "f"], ...extra });
  const askOf = (events: ChatEvent[]) => {
    const ask = events.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    return ask;
  };
  const planCalls = (chat: ReturnType<typeof fakeChatModel>) =>
    chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
  const BRIEF = "Upbeat lo-fi hip hop at 92 BPM, warm Rhodes piano and soft drums.";

  it("asks the planner first and shows the price and what it chose, before any clip, voice or music is made", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 20, voiceOver: true, videoPlan: { music: { brief: BRIEF } } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(button(sheet)));

    const ask = askOf(events);
    // 20 seconds of video (US$2.00), 20 seconds of narration (US$0.006) and the music (US$0.04).
    assert.equal(ask.estimatedUsd, 2.046);
    assert.match(ask.message, /20 detik/);
    assert.match(ask.message, /dengan voice over/);
    assert.match(ask.message, /dengan musik/);
    assert.match(ask.message, /US\$2\.05/);
    assert.doesNotMatch(ask.message, /klip/);
    assert.deepEqual(ask.videoChoice?.clips, [8, 6, 6]);
    assert.equal(planCalls(chat).length, 1);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(app.speechModel.calls.length, 0);
    assert.equal(app.musicModel.calls.length, 0);
    assert.equal(app.imageModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("does not let the request choose the length, the voice-over or the music", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10 }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(button(sheet, { video: { seconds: 30, voiceOver: true, music: true } })));

    assert.equal(askOf(events).estimatedUsd, 1);
  });

  it("makes exactly the plan it showed when the seller says yes, without asking the planner again", async () => {
    for (const [seconds, clips] of [
      [10, [6, 4]],
      [20, [8, 6, 6]],
      [30, [8, 8, 8, 6]],
    ] as const) {
      const chat = fakeChatModel({ chunks: ["x"], videoSeconds: seconds, voiceOver: true, videoPlan: { music: { brief: BRIEF } } });
      const app = createTestApp(chat);
      const sheet = await uploadSheet(app);
      const ask = askOf(await readEvents(await app.chat(button(sheet))));

      const events = await readEvents(await app.chat(button(sheet, { videoChoice: ask.videoChoice, confirmedUsd: ask.estimatedUsd })));

      assert.equal(planCalls(chat).length, 1, `${seconds} s: one plan for the question and the yes together`);
      assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), clips, `${seconds} s`);
      app.videoModel.calls.forEach((call, index) => assert.ok(call.prompt.includes(directionOf(index))));
      assert.equal(app.musicModel.calls.length, 1);
      assert.ok(events.some((event) => event.type === "voice_over"));
      assert.ok(finishedVideo(events));
      assert.equal((await usageOf(app)).monthUsd, ask.estimatedUsd);
    }
  });

  it("asks again when the plan that comes back costs more than the yes", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 30 });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);
    const ask = askOf(await readEvents(await app.chat(button(sheet))));

    // The seller said yes to US$1.00 but sends back the plan of 30 seconds (US$3.00).
    const events = await readEvents(await app.chat(button(sheet, { videoChoice: ask.videoChoice, confirmedUsd: 1 })));

    assert.equal(askOf(events).estimatedUsd, 3);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("makes no voice and no music, and does not price them, when the planner chose neither", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 20, voiceOver: false }));
    const sheet = await uploadSheet(app);
    const ask = askOf(await readEvents(await app.chat(button(sheet))));

    assert.equal(ask.estimatedUsd, 2);
    assert.match(ask.message, /tanpa voice over/);
    assert.match(ask.message, /tanpa musik/);

    const events = await readEvents(await app.chat(button(sheet, { videoChoice: ask.videoChoice, confirmedUsd: ask.estimatedUsd })));

    assert.equal(app.speechModel.calls.length, 0);
    assert.equal(app.musicModel.calls.length, 0);
    assert.equal(events.some((event) => event.type === "voice_over"), false);
    for (const call of app.videoModel.calls) assert.doesNotMatch(call.prompt, /speak|narrator|music/i);
    assert.equal((await usageOf(app)).monthUsd, 2);
  });

  it("tells the video model about the narrator and the music only when the planner chose them", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10, voiceOver: true, videoPlan: { music: { brief: BRIEF } } }));
    const sheet = await uploadSheet(app);
    const ask = askOf(await readEvents(await app.chat(button(sheet))));

    await readEvents(await app.chat(button(sheet, { videoChoice: ask.videoChoice, confirmedUsd: ask.estimatedUsd })));

    assert.ok(app.videoModel.calls.length > 0);
    for (const call of app.videoModel.calls) {
      assert.match(call.prompt, /the person does not speak/i);
      assert.match(call.prompt, /no background music/i);
    }
  });

  it("tells the planner that it chooses the length, the voice-over and the music, and passes on what a typed request says", async () => {
    const typedChat = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 20 });
    const typedApp = createTestApp(typedChat);
    const typed = await readEvents(await typedApp.chat(videoRequest("buat video yang santai dong pakai suara", await uploadSheet(typedApp))));

    const buttonChat = fakeChatModel({ chunks: ["x"] });
    const pressed = createTestApp(buttonChat);
    await readEvents(await pressed.chat(button(await uploadSheet(pressed))));

    const prompt = JSON.stringify(planCalls(typedChat)[0].prompt);
    for (const need of [/buat video yang santai dong pakai suara/, /choose \\+"seconds/, /voiceOver/, /choose \\+"use/, /10 seconds/, /20 seconds/, /30 seconds/]) {
      assert.match(prompt, need);
    }
    // A typed request that costs more than US$1 asks, like the button.
    assert.equal(askOf(typed).estimatedUsd, 2);
    // The button has no words to pass on.
    assert.doesNotMatch(JSON.stringify(planCalls(buttonChat)[0].prompt), /The seller wrote/);
  });

  it("gives the video planner the brief of the first request, with whatever is typed with the video request", async () => {
    const BRIEF_TEXT = "A calm, premium ad video of about 10 seconds with soft music.";
    const briefChat = fakeChatModel({ chunks: ["x"], videoSeconds: 10 });
    const app = createTestApp(briefChat);
    await readEvents(await app.chat(button(await uploadSheet(app), { brief: BRIEF_TEXT })));

    const both = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 });
    const bothApp = createTestApp(both);
    await readEvents(await bothApp.chat(videoRequest("pakai suara ya", await uploadSheet(bothApp), { brief: BRIEF_TEXT })));

    const prompt = JSON.stringify(planCalls(briefChat)[0].prompt);
    assert.ok(prompt.includes(BRIEF_TEXT));
    assert.match(prompt, /first request/i);
    // The button has no typed words, so the brief is all the seller has said.
    assert.doesNotMatch(prompt, /The seller wrote/);
    const typedPrompt = JSON.stringify(planCalls(both)[0].prompt);
    assert.ok(typedPrompt.includes(BRIEF_TEXT));
    assert.ok(typedPrompt.includes("pakai suara ya"));
  });

  it("adds nothing about a brief when there is none, and rejects a brief that is not a short text", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 10 });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);
    await readEvents(await app.chat(button(sheet)));
    assert.doesNotMatch(JSON.stringify(planCalls(chat)[0].prompt), /first request/i);

    for (const bad of [42, ["a"], "x".repeat(MAX_BRIEF_CHARS + 1)]) {
      assert.equal((await app.chat(button(sheet, { brief: bad }))).status, 400, JSON.stringify(bad).slice(0, 30));
    }
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("does not ask the planner again on the yes, so the brief cannot change what was priced", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 10 });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);
    const ask = askOf(await readEvents(await app.chat(button(sheet, { brief: "About 10 seconds." }))));

    await readEvents(await app.chat(button(sheet, { brief: "About 30 seconds.", videoChoice: ask.videoChoice, confirmedUsd: ask.estimatedUsd })));

    assert.equal(planCalls(chat).length, 1);
    assert.equal(app.videoModel.calls.length, 2);
  });

  it("rejects a plan sent back that this server could not have made", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 10 }));
    const sheet = await uploadSheet(app);
    const ask = askOf(await readEvents(await app.chat(button(sheet))));
    const choice = ask.videoChoice!;

    for (const bad of [
      { ...choice, clips: [3, 3] },
      { ...choice, clips: [8, 8, 8, 8, 8] },
      { ...choice, directions: ["only one"] },
      { ...choice, seconds: 0 },
      "nonsense",
    ]) {
      assert.equal((await app.chat(button(sheet, { videoChoice: bad, confirmedUsd: 99 }))).status, 400, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("makes nothing and books nothing when the planner cannot decide", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], failVideoPlan: true }));
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(button(sheet)));

    assert.equal(errorOf(events)?.type, "error");
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 0);
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
    // Nobody was asked to speak, so there are no narration lines to remake.
    assert.deepEqual(partial.narration, []);
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
        }),
      ),
    );

    // One more call in total: the 4 s clip, from the same picture and with the direction the first try gave it,
    // so the remade part still fits the clip that was kept.
    assert.equal(app.videoModel.calls.length, 3);
    assert.equal(app.videoModel.calls[2].seconds, 4);
    assert.match(app.videoModel.calls[2].prompt, new RegExp(directionOf(1)));
    // The remade clip is asked the same way as the first try asked it: the picture and its part, with no rules added.
    assert.equal(app.videoModel.calls[2].prompt, app.videoModel.calls[0].prompt.replace(directionOf(0), directionOf(1)));
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
            voice: partial.voice,
            narration: partial.narration,
          },
        }),
      ),
    );

    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, true);
    // One reading for each of the two clips' lines.
    assert.equal(app.speechModel.calls.length, 2);
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
  const SCENES = ["Scene A", "Scene B", "Scene C", "Scene D"];
  const voiceOverOf = (events: ChatEvent[]) => events.find((event) => event.type === "voice_over");

  it("lays the narration over the whole video, one line for each moment, and shows the lines", async () => {
    const LINES = [{ line: "Ayo cobain produk keren ini!" }, { line: "Kualitasnya bikin jatuh cinta!" }];
    const chat = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, videoPlan: { narration: LINES } });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const events = await readEvents(
      await app.chat(videoRequest("video 10 detik pakai voice over", sheet, { scenes: SCENES })),
    );

    // The planner writes the lines, from the scenes and with the picture in front of it; each is read aloud once.
    const planned = chat.doGenerateCalls.find((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
    assert.match(JSON.stringify(planned?.prompt), /Scene A/);
    assert.deepEqual(app.speechModel.calls.map((call) => call.text), LINES.map((line) => line.line));
    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.equal(probe.hasAudio, true);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);

    const voice = voiceOverOf(events);
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.script, LINES.map((line) => line.line).join(" "));
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
    // Every line was read (and billed), but none could be laid over the video.
    assert.equal(app.speechModel.calls.length, 2);
    assert.equal((await usageOf(app)).monthUsd, 1.003);
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
  const LINES = [
    { line: "Duh, lapar banget nih...", delivery: "Weary and wishful, almost a sigh" },
    { line: "Ayo cobain, bikin jatuh cinta!", delivery: "Bright and excited, rising" },
  ];
  const SCRIPT = LINES.map((line) => line.line).join(" ");

  /** A finished video with a narration, and what a revision request needs to know about it. */
  async function narratedVideo(chatOptions: Parameters<typeof fakeChatModel>[0]) {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, videoPlan: { narration: LINES } }));
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
      revise: { silentAssetId, seconds: voice.seconds, script: voice.script, voice: voice.voice, lines: voice.lines },
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

  it("keeps what was said and how it was felt when only the voice changes", async () => {
    const { app, revise } = await narratedVideo({ chunks: ["x"], intent: "REVISE_VOICE", voiceRevision: { voice: "male" } });
    const before = app.speechModel.calls.length;

    const events = await readEvents(await app.chat(reviseRequest("pakai suara cowok", revise)));

    // Every line is read again in the new voice, each with the emotion it had.
    const again = app.speechModel.calls.slice(before);
    assert.deepEqual(again.map((call) => call.text), LINES.map((line) => line.line));
    again.forEach((call, index) => {
      assert.equal(call.voice, VOICES.male);
      assert.ok(call.instructions?.includes(LINES[index].delivery));
    });
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

/** What the seller wrote in the first request is kept as it was written, and a length they named is the length of the video. */
describe("a video of the length the seller asked for", () => {
  const FIRST = "buatkan storyboard dan video 10 detik";
  const button = (sheet: string, extra: object = {}) =>
    videoRequest("Buat video dari storyboard ini.", sheet, { video: true, scenes: ["a", "b", "c", "d", "e", "f"], ...extra });
  const askOf = (events: ChatEvent[]) => {
    const ask = events.find((event) => event.type === "confirmation_requested");
    assert.ok(ask && ask.type === "confirmation_requested");
    return ask;
  };
  const planCalls = (chat: ReturnType<typeof fakeChatModel>) =>
    chat.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("[task: video-plan]"));
  const promptOf = (chat: ReturnType<typeof fakeChatModel>, call = 0) => JSON.stringify(planCalls(chat)[call].prompt);

  it("tells the planner the seller's own words and that the length they named is the length", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 10 });
    const app = createTestApp(chat);

    const ask = askOf(await readEvents(await app.chat(button(await uploadSheet(app), { brief: FIRST }))));

    const prompt = promptOf(chat);
    assert.ok(prompt.includes(FIRST));
    assert.match(prompt, /must be exactly 10/);
    assert.equal(planCalls(chat).length, 1);
    assert.match(ask.message, /10 detik/);
  });

  it("asks the planner once more when it chose another length, and the price is for the length the seller asked for", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: [20, 10] });
    const app = createTestApp(chat);

    const ask = askOf(await readEvents(await app.chat(button(await uploadSheet(app), { brief: FIRST }))));

    assert.equal(planCalls(chat).length, 2);
    // The second try is told what went wrong.
    assert.match(promptOf(chat, 1), /20 seconds/);
    assert.match(ask.message, /10 detik/);
    assert.equal(ask.estimatedUsd, 1);
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("makes the video the length the seller asked for even when the planner keeps choosing another, and never asks it a third time", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 20 });
    const app = createTestApp(chat);
    const sheet = await uploadSheet(app);

    const ask = askOf(await readEvents(await app.chat(button(sheet, { brief: FIRST }))));

    assert.equal(planCalls(chat).length, 2);
    assert.match(ask.message, /10 detik/);
    assert.equal(ask.estimatedUsd, 1);
    assert.equal(ask.videoChoice?.seconds, 10);
    assert.equal(ask.videoChoice?.directions.length, ask.videoChoice?.clips.length);

    const events = await readEvents(await app.chat(button(sheet, { brief: FIRST, videoChoice: ask.videoChoice, confirmedUsd: ask.estimatedUsd })));
    assert.equal(planCalls(chat).length, 2);
    assert.equal(app.videoModel.calls.length, ask.videoChoice?.clips.length);
    assert.ok(finishedVideo(events));
  });

  it("takes a number between the options as the nearest one that is not longer, and ignores a time that is not a video length", async () => {
    for (const [said, pinned] of [
      ["video 15 detik", 10],
      ["video 25 detik ya", 20],
      ["video 35 detik", 30],
      ["video 30s", 30],
      ["iklan 20 sec", 20],
    ] as const) {
      const chat = fakeChatModel({ chunks: ["x"], videoSeconds: pinned });
      const app = createTestApp(chat);
      await readEvents(await app.chat(button(await uploadSheet(app), { brief: said })));
      assert.match(promptOf(chat), new RegExp(`must be exactly ${pinned}\\b`), said);
    }
    for (const said of ["teks muncul 3 detik", "video yang santai", "pakai 20 gambar"]) {
      const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 20 });
      const app = createTestApp(chat);
      const ask = askOf(await readEvents(await app.chat(button(await uploadSheet(app), { brief: said }))));
      assert.doesNotMatch(promptOf(chat), /must be exactly/, said);
      assert.equal(planCalls(chat).length, 1, said);
      // The planner is free: what it chose stands.
      assert.match(ask.message, /20 detik/, said);
    }
  });

  it("leaves the planner free when the first request says nothing about a length or any extra", async () => {
    const chat = fakeChatModel({ chunks: ["x"], videoSeconds: 20 });
    const app = createTestApp(chat);

    await readEvents(await app.chat(button(await uploadSheet(app))));

    assert.doesNotMatch(promptOf(chat), /must be exactly/);
    assert.doesNotMatch(promptOf(chat), /first request/i);
    assert.match(promptOf(chat), /everything is yours to decide/);
  });

  it("follows what is typed with the video request over the first request", async () => {
    const chat = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 30 });
    const app = createTestApp(chat);

    const ask = askOf(
      await readEvents(await app.chat(videoRequest("bikin 30 detik ya", await uploadSheet(app), { brief: FIRST, scenes: ["a", "b", "c", "d", "e", "f"] }))),
    );

    assert.match(promptOf(chat), /must be exactly 30/);
    assert.doesNotMatch(promptOf(chat), /must be exactly 10/);
    assert.match(ask.message, /30 detik/);
  });
});
