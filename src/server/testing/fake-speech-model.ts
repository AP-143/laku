import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MockSpeechModelV4 } from "ai/test";

const run = promisify(execFile);
let voice: Uint8Array | undefined;

/** A real 12 second WAV (a plain tone), longer than any test video, like narration that has to be cut to fit. */
async function narration(): Promise<Uint8Array> {
  if (voice) return voice;
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "laku-fake-speech-")), "voice.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-ar", "24000", "-ac", "1", file]);
  voice = new Uint8Array(readFileSync(file));
  return voice;
}

interface FakeSpeechModelOptions {
  /** Make every call fail with this error. */
  failWith?: unknown;
  /** Answer with bytes that are not audio, so laying the voice over the video fails after the voice was made. */
  garbage?: boolean;
}

/**
 * A deterministic stand-in for the speech model. It never touches the network and costs nothing.
 * `calls` records every request, so tests can tell what was read aloud and with which voice.
 */
export function fakeSpeechModel(options: FakeSpeechModelOptions = {}) {
  const calls: { text: string; voice?: string }[] = [];
  const model = new MockSpeechModelV4({
    doGenerate: async (callOptions) => {
      calls.push({ text: callOptions.text, voice: callOptions.voice });
      if (options.failWith) throw options.failWith;
      return {
        audio: options.garbage ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) : await narration(),
        warnings: [],
        response: { timestamp: new Date(), modelId: "fake-speech", headers: undefined },
      };
    },
  });
  return Object.assign(model, { calls });
}

export type FakeSpeechModel = ReturnType<typeof fakeSpeechModel>;
