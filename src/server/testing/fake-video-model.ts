import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AssetFile } from "../asset-store";
import type { VideoModel } from "../video-model";

const run = promisify(execFile);
const dir = mkdtempSync(path.join(os.tmpdir(), "laku-fake-video-"));
const cache = new Map<number, Uint8Array>();

/** A real, tiny MP4 of the given length with a picture and an audio track, like the real model returns. */
async function clipOf(seconds: number): Promise<Uint8Array> {
  const cached = cache.get(seconds);
  if (cached) return cached;
  const file = path.join(dir, `clip-${seconds}.mp4`);
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=160x288:rate=12",
    "-f", "lavfi", "-i", "sine=frequency=440",
    "-t", String(seconds),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    file,
  ]);
  const bytes = new Uint8Array(readFileSync(file));
  cache.set(seconds, bytes);
  return bytes;
}

interface FakeVideoModelOptions {
  /** Make the clip with this position (0 is the first) fail. */
  failOnClip?: number;
  failWith?: unknown;
}

export interface FakeVideoCall {
  prompt: string;
  frame: AssetFile;
  seconds: number;
}

/**
 * A deterministic stand-in for the video model. It never touches the network and costs nothing.
 * `calls` records every request, so tests can tell which frames and lengths the model was asked for.
 */
export function fakeVideoModel(options: FakeVideoModelOptions = {}): VideoModel & { calls: FakeVideoCall[] } {
  const calls: FakeVideoCall[] = [];
  return {
    calls,
    async generate(request) {
      const position = calls.length;
      calls.push(request);
      if (options.failOnClip === position) throw options.failWith ?? new Error("fake video failure");
      return clipOf(request.seconds);
    },
  };
}

export type FakeVideoModel = ReturnType<typeof fakeVideoModel>;
