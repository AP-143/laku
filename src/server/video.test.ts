import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COSTS, VOICES } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeSpeechModel } from "./testing/fake-speech-model";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";
import { probeVideo } from "./testing/probe-video";

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
    assert.equal(probe.hasAudio, false);

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
      assert.match(call.prompt, /captions? as on-screen text/i);
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

  it("fits the longest video with a voice-over, after the storyboard picture of the same day, within the daily limit", async () => {
    // The storyboard picture costs US$0.0336 (one image), the 30 second video US$3.00, its narration US$0.009.
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 0.0336 });
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
    assert.deepEqual(partial.directions, [directionOf(0), directionOf(1)]);
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
    // US$0.60 stays from the first try; room is left for exactly the 4 s clip (US$0.40) and nothing more today.
    const tight = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: COSTS.dailyBudgetUsd - 0.4 });
    const tightSheet = await uploadSheet(tight);
    const tightClip = await tight.store.saveVideo(new Uint8Array((await app.store.read(partial.finished[0], "original"))!.bytes));

    const resumed = await readEvents(
      await tight.chat(
        videoRequest("Coba ulang bagian yang gagal.", tightSheet, {
          resume: { seconds: 10, clips: [6, 4], finished: { 0: tightClip }, directions: partial.directions },
        }),
      ),
    );

    assert.ok(finishedVideo(resumed));
    // The day was left with room for exactly this clip, so it is full now.
    assert.equal((await usageOf(tight)).monthUsd, COSTS.dailyBudgetUsd);
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
    assert.match(JSON.stringify(written[0].prompt), /25 to 30 words/);
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

  it("books the voice together with the video, so a budget that covers only the video is refused", async () => {
    // Only US$1.00 is left of the day: the 10 s video (US$1.00) alone would fit it, with the voice it does not.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true }), undefined, {
      startingTodayUsd: COSTS.dailyBudgetUsd - 1,
    });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", sheet)));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, COSTS.dailyBudgetUsd - 1);
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
    assert.equal((await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes)).hasAudio, false);
    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /suara/i);
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
  it("refuses up front when the budget cannot cover the video and says how many seconds it can", async () => {
    // US$0.50 is left of the day, which is 5 seconds.
    const spent = COSTS.dailyBudgetUsd - 0.5;
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { startingTodayUsd: spent });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    const error = errorOf(events);
    assert.match(error?.message ?? "", /5 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, spent);
  });

  it("uses the daily cap message when not even the shortest clip is affordable", async () => {
    // US$0.10 is left of the day; the video (US$1.00) does not fit.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { startingTodayUsd: COSTS.dailyBudgetUsd - 0.1 });
    const sheet = await uploadSheet(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", sheet)));

    assert.equal(errorOf(events)?.code, "daily_cap_reached");
    assert.equal(app.videoModel.calls.length, 0);
  });

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
