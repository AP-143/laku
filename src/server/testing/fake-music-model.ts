import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MusicModel } from "../music-model";

const run = promisify(execFile);
let clip: Uint8Array | undefined;

/** A real 30 second MP3 of a 1000 Hz tone: no other sound of the tests is at that pitch, so its presence can be measured. */
async function thirtySeconds(): Promise<Uint8Array> {
  if (clip) return clip;
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "laku-fake-music-")), "music.mp3");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=30", "-ac", "2", "-ar", "44100", file]);
  clip = new Uint8Array(readFileSync(file));
  return clip;
}

interface FakeMusicModelOptions {
  /** Make every call fail with this error. */
  failWith?: unknown;
}

/**
 * A deterministic stand-in for the music model. It never touches the network and costs nothing.
 * `calls` records every request, so tests can tell what the music was asked for.
 */
export function fakeMusicModel(options: FakeMusicModelOptions = {}): MusicModel & { calls: { prompt: string }[] } {
  const calls: { prompt: string }[] = [];
  return {
    calls,
    async generate(request) {
      calls.push({ prompt: request.prompt });
      if (options.failWith) throw options.failWith;
      return thirtySeconds();
    },
  };
}

export type FakeMusicModel = ReturnType<typeof fakeMusicModel>;
