import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { fakeChatModel } from "./testing/fake-models";
import { fakeSpeechModel } from "./testing/fake-speech-model";
import { fakeVideoModel } from "./testing/fake-video-model";
import { readEvents } from "./testing/events";
import { chatRequest, createTestApp } from "./testing/harness";
import { makePhoto, uploadRequest } from "./testing/photos";
import { probeVideo } from "./testing/probe-video";

/** Feature 3 through the chat API: a silent video made from the storyboard frames, with the length the seller asks for. */

type App = ReturnType<typeof createTestApp>;

async function uploadPhoto(app: App): Promise<string> {
  const [event] = await readEvents(await app.upload(uploadRequest(await makePhoto("jpeg"))));
  return event.type === "asset_ready" ? event.assetId : "";
}

/** The four storyboard frames, as the seller would have them (here, four stored images). */
async function uploadFrames(app: App): Promise<string[]> {
  return Promise.all([1, 2, 3, 4].map(() => uploadPhoto(app)));
}

const videoRequest = (text: string, frames: string[], extra: object = {}) =>
  chatRequest({ messages: [{ role: "user", text }], frames, ...extra });

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
  it("makes a silent video of the length asked for, from the frames in order, and books the cost per second", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("bikinin video iklan 10 detik dari storyboard", frames)));

    // Two clips, 6 s and 4 s, from the first two frames.
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
    for (const [index, call] of app.videoModel.calls.entries()) {
      const stored = await app.store.read(frames[index], "resized");
      assert.deepEqual(Buffer.from(call.frame.bytes), Buffer.from(stored!.bytes));
    }

    const ready = finishedVideo(events);
    assert.ok(ready && ready.type === "asset_ready");
    assert.equal(ready.role, "video");
    assert.equal(ready.url, `/api/assets/${ready.assetId}`);
    assert.equal(ready.sourceAssetId, frames[0]);

    // The stored file is one 9:16 MP4 of about the length asked for, with the audio of the model dropped.
    const file = await app.store.read(ready.assetId, "original");
    assert.equal(file?.mediaType, "video/mp4");
    const probe = await probeVideo(file!.bytes);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);
    assert.equal(probe.hasAudio, false);

    assert.equal(events.some((event) => event.type === "job_started" && event.kind === "video"), true);
    assert.equal(events.filter((event) => event.type === "job_progress").length, 2);
    assert.deepEqual(events.findLast((event) => event.type === "usage_updated"), { type: "usage_updated", monthUsd: 1, budgetUsd: 4 });
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes 10 seconds when the seller names no length", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO" }));
    const frames = await uploadFrames(app);

    await readEvents(await app.chat(videoRequest("bikinin video dong", frames)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [6, 4]);
  });

  it("raises a length that is shorter than the shortest clip", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 2 }));
    const frames = await uploadFrames(app);

    await readEvents(await app.chat(videoRequest("video 2 detik", frames)));

    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [4]);
  });

  it("works from the video shortcut chip as well as from typed words", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], videoSeconds: 4 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 4 detik", frames, { intent: "video" })));

    assert.ok(finishedVideo(events));
    assert.deepEqual(app.videoModel.calls.map((call) => call.seconds), [4]);
  });

  it("refuses a length the storyboard cannot cover, says the most it can, and spends nothing", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 40 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 40 detik", frames)));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /32 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("asks for a storyboard first when there are no frames", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"] }));

    const events = await readEvents(await app.chat(chatRequest({ messages: [{ role: "user", text: "video 10 detik" }], intent: "video" })));

    const text = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.match(text, /storyboard/i);
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("refuses frames that are not a product, before anything is generated", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", isProduct: false }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });
});

describe("confirming an expensive video", () => {
  const confirmationOf = (events: ChatEvent[]) => events.find((event) => event.type === "confirmation_requested");

  it("asks first when the video would cost more than US$1, and spends nothing until the seller agrees", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 20 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 20 detik", frames)));

    const ask = confirmationOf(events);
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 2);
    assert.match(ask.message, /20 detik/);
    assert.match(ask.message, /US\$2\.00/);
    assert.match(ask.message, /Rp33\.000/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 0);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("makes the video once the same request is sent again with the seller's yes", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 20 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 20 detik", frames, { confirmedUsd: 2 })));

    assert.equal(confirmationOf(events), undefined);
    assert.ok(finishedVideo(events));
    assert.equal(app.videoModel.calls.length, 4);
    assert.equal((await usageOf(app)).monthUsd, 2);
  });

  it("asks again when the video would now cost more than the price the seller said yes to", async () => {
    // The seller agreed to US$2.00, but this time the request is read as 30 seconds (US$3.00).
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 30 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 20 detik", frames, { confirmedUsd: 2 })));

    const ask = confirmationOf(events);
    assert.ok(ask && ask.type === "confirmation_requested");
    assert.equal(ask.estimatedUsd, 3);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 0);
  });

  it("starts straight away at US$1 or less, with no question", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }));
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

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
    const frames = await uploadFrames(app);
    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));
    return { app, frames, events };
  }

  it("keeps the clips that were made, saves them, and says which part failed", async () => {
    const { app, frames, events } = await failSecondClip();

    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");
    assert.equal(partial.seconds, 10);
    assert.deepEqual(partial.clips, [6, 4]);
    assert.deepEqual(Object.keys(partial.finished), ["0"]);
    assert.equal(partial.failedIndex, 1);
    assert.equal(partial.sourceAssetId, frames[0]);
    assert.equal((await app.store.read(partial.finished[0], "original"))?.mediaType, "video/mp4");
    assert.match(errorOf(events)?.message ?? "", /klip 2 dari 2/i);
    assert.equal(finishedVideo(events), undefined);
  });

  it("never retries a clip by itself", async () => {
    const { app } = await failSecondClip();

    assert.equal(app.videoModel.calls.length, 2);
  });

  it("remakes only the failed clip when the seller asks, and finishes the video", async () => {
    const { app, frames, events } = await failSecondClip();
    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");

    const resumed = await readEvents(
      await app.chat(
        videoRequest("Coba ulang bagian yang gagal.", frames, {
          resume: { seconds: partial.seconds, clips: partial.clips, finished: partial.finished },
        }),
      ),
    );

    // One more call in total: the 4 s clip, from the second frame.
    assert.equal(app.videoModel.calls.length, 3);
    assert.equal(app.videoModel.calls[2].seconds, 4);
    const stored = await app.store.read(frames[1], "resized");
    assert.deepEqual(Buffer.from(app.videoModel.calls[2].frame.bytes), Buffer.from(stored!.bytes));

    const ready = finishedVideo(resumed);
    assert.ok(ready && ready.type === "asset_ready");
    const probe = await probeVideo((await app.store.read(ready.assetId, "original"))!.bytes);
    assert.ok(Math.abs(probe.seconds - 10) < 0.6, `length was ${probe.seconds}`);
    // The finished clip stays booked from the first try (US$0.60); the remade clip adds US$0.40.
    assert.equal((await usageOf(app)).monthUsd, 1);
    assert.deepEqual(resumed.at(-1), { type: "done" });
  });

  it("books only the clips still missing when it resumes", async () => {
    const { app, frames, events } = await failSecondClip();
    const partial = partialOf(events);
    assert.ok(partial && partial.type === "video_partial");
    // US$0.60 stays from the first try; room is left for exactly the 4 s clip (US$0.40) and nothing more today.
    const tight = createTestApp(fakeChatModel({ chunks: ["x"] }), undefined, { startingTodayUsd: 1.6 });
    const tightFrames = await uploadFrames(tight);
    const tightClip = await tight.store.saveVideo(new Uint8Array((await app.store.read(partial.finished[0], "original"))!.bytes));

    const resumed = await readEvents(
      await tight.chat(videoRequest("Coba ulang bagian yang gagal.", tightFrames, { resume: { seconds: 10, clips: [6, 4], finished: { 0: tightClip } } })),
    );

    assert.ok(finishedVideo(resumed));
    assert.equal((await usageOf(tight)).monthUsd, 2);
    void frames;
  });
});

describe("voice-over", () => {
  const SCRIPT = "Ayo cobain produk keren ini sekarang juga, kualitasnya bikin kamu jatuh cinta!";
  const SCENES = ["Scene A", "Scene B", "Scene C", "Scene D"];
  const voiceOverOf = (events: ChatEvent[]) => events.find((event) => event.type === "voice_over");

  it("lays one narration over the whole video, from a script written for its length and scenes, and shows the script", async () => {
    const chat = fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true, script: SCRIPT });
    const app = createTestApp(chat);
    const frames = await uploadFrames(app);

    const events = await readEvents(
      await app.chat(videoRequest("video 10 detik pakai voice over", frames, { scenes: SCENES })),
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
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(app.speechModel.calls.length, 0);
    assert.equal(voiceOverOf(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("books the voice together with the video, so a budget that covers only the video is refused", async () => {
    // US$1.00 spent today: the 10 s video (US$1.00) alone would fit the US$2.00 day, with the voice it does not.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true }), undefined, {
      startingTodayUsd: 1,
    });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", frames)));

    assert.equal(app.videoModel.calls.length, 0);
    assert.equal(finishedVideo(events), undefined);
    assert.equal((await usageOf(app)).monthUsd, 1);
  });

  it("still gives the silent video when the voice fails, says so, and gives the voice back", async () => {
    const failing = fakeSpeechModel({ failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10, voiceOver: true }), undefined, {
      speechModel: failing,
    });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", frames)));

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
    const frames = await uploadFrames(app);
    const events = await readEvents(await app.chat(videoRequest("video 10 detik pakai voice over", frames)));
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
    assert.equal(call?.voice, "Charon");
    const voice = events.find((event) => event.type === "voice_over");
    assert.ok(voice && voice.type === "voice_over");
    assert.equal(voice.script, SCRIPT);
    assert.equal(voice.voice, "Charon");
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
    // US$1.50 spent today: US$0.50 is left of the day, which is 5 seconds.
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { startingTodayUsd: 1.5 });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    const error = errorOf(events);
    assert.match(error?.message ?? "", /5 detik/);
    assert.equal(app.videoModel.calls.length, 0);
    assert.equal((await usageOf(app)).monthUsd, 1.5);
  });

  it("uses the daily cap message when not even the shortest clip is affordable", async () => {
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { startingTodayUsd: 1.9 });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(errorOf(events)?.code, "daily_cap_reached");
    assert.equal(app.videoModel.calls.length, 0);
  });

  it("gives back the clips that were not made when one fails, and keeps the ones that were", async () => {
    const failing = fakeVideoModel({ failOnClip: 1, failWith: Object.assign(new Error("bad request"), { statusCode: 400 }) });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: failing });
    const frames = await uploadFrames(app);

    const events = await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    assert.equal(errorOf(events)?.type, "error");
    assert.equal(finishedVideo(events), undefined);
    // The 6 s clip was made (US$0.60) and is kept; the 4 s clip failed and is given back.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
  });

  it("keeps the booking of a clip that timed out, because it may still be billed", async () => {
    const timedOut = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const failing = fakeVideoModel({ failOnClip: 0, failWith: timedOut });
    const app = createTestApp(fakeChatModel({ chunks: ["x"], intent: "VIDEO", videoSeconds: 10 }), undefined, { videoModel: failing });
    const frames = await uploadFrames(app);

    await readEvents(await app.chat(videoRequest("video 10 detik", frames)));

    // The first clip (6 s, US$0.60) stays booked; the clip that never started (4 s) is given back.
    assert.equal((await usageOf(app)).monthUsd, 0.6);
  });
});
