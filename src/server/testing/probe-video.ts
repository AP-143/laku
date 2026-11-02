import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Reads the real length, size and tracks of an MP4 held in memory. */
export async function probeVideo(bytes: Uint8Array) {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "laku-probe-")), "video.mp4");
  writeFileSync(file, bytes);
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file,
  ]);
  const info = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] };
  const video = info.streams.find((stream) => stream.codec_type === "video");
  return {
    seconds: Number(info.format.duration),
    hasAudio: info.streams.some((stream) => stream.codec_type === "audio"),
    width: video?.width,
    height: video?.height,
  };
}
