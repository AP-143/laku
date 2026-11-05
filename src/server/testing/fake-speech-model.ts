import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MockSpeechModelV4 } from "ai/test";

const run = promisify(execFile);
const voices = new Map<number, Uint8Array>();

/** A real WAV of the given length (a plain tone), like a narration of that many seconds. */
async function narration(seconds: number): Promise<Uint8Array> {
  const known = voices.get(seconds);
  if (known) return known;
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "laku-fake-speech-")), "voice.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ar", "24000", "-ac", "1", file]);
  const bytes = new Uint8Array(readFileSync(file));
  voices.set(seconds, bytes);
  return bytes;
}

interface FakeSpeechModelOptions {
  /** Make every call fail with this error. */
  failWith?: unknown;
  /** Answer with bytes that are not audio, so laying the voice over the video fails after the voice was made. */
  garbage?: boolean;
  /** How long every narration is, in seconds. Defaults to 8, which fits a 10 second video. */
  seconds?: number;
}

/**
 * A deterministic stand-in for the speech model. It never touches the network and costs nothing.
 * `calls` records every request, so tests can tell what was read aloud and with which voice.
 */
export function fakeSpeechModel(options: FakeSpeechModelOptions = {}) {
  const calls: { text: string; voice?: string; instructions?: string }[] = [];
  const model = new MockSpeechModelV4({
    doGenerate: async (callOptions) => {
      calls.push({ text: callOptions.text, voice: callOptions.voice, instructions: callOptions.instructions });
      if (options.failWith) throw options.failWith;
      return {
        audio: options.garbage ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) : await narration(options.seconds ?? 8),
        warnings: [],
        response: { timestamp: new Date(), modelId: "fake-speech", headers: undefined },
      };
    },
  });
  return Object.assign(model, { calls });
}

export type FakeSpeechModel = ReturnType<typeof fakeSpeechModel>;
