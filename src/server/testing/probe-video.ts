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
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,bit_rate", "-of", "json", file,
  ]);
  const info = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; bit_rate?: string }[] };
  const video = info.streams.find((stream) => stream.codec_type === "video");
  return {
    seconds: Number(info.format.duration),
    hasAudio: info.streams.some((stream) => stream.codec_type === "audio"),
    /** Bits per second of the picture alone. */
    videoBitrate: Number(video?.bit_rate ?? 0),
    width: video?.width,
    height: video?.height,
  };
}

/** The raw bytes of a small picture of one moment of a video: `region` is the part to keep, as ffmpeg crop numbers. */
async function rawFrame(bytes: Uint8Array, seconds: number, filter: string): Promise<Buffer> {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "laku-frame-")), "video.mp4");
  writeFileSync(file, bytes);
  const { stdout } = await runBuffer("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", filter, "-f", "rawvideo", "-"]);
  return stdout;
}

const runBuffer = (command: string, args: string[]) => promisify(execFile)(command, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });

/** The lower third of the picture at one moment, as a small grey image, where captions are drawn. */
export async function lowerThird(bytes: Uint8Array, seconds: number): Promise<Buffer> {
  return rawFrame(bytes, seconds, "crop=iw:ih*0.34:0:ih*0.6,scale=96:-1,format=gray");
}

/** How far apart two grey images are, from 0 (the same) to 255, as an average per pixel. */
export function meanDifference(a: Buffer, b: Buffer): number {
  let total = 0;
  for (let index = 0; index < a.length; index++) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

/** How colourful the picture is at one moment: the average gap between its strongest and weakest colour channel. */
export async function colourfulness(bytes: Uint8Array, seconds: number): Promise<number> {
  const rgb = await rawFrame(bytes, seconds, "scale=48:-1,format=rgb24");
  let total = 0;
  for (let index = 0; index < rgb.length; index += 3) total += Math.max(rgb[index], rgb[index + 1], rgb[index + 2]) - Math.min(rgb[index], rgb[index + 1], rgb[index + 2]);
  return total / (rgb.length / 3);
}

/** The whole picture at one moment, as a small grey image, to see whether anything was drawn anywhere on it. */
export async function wholeFrame(bytes: Uint8Array, seconds: number): Promise<Buffer> {
  return rawFrame(bytes, seconds, "scale=96:-1,format=gray");
}

/** How loud the sound of a video is around one pitch, in dB (about -91 is silence): a narrow band is cut out and measured. */
export async function levelAround(bytes: Uint8Array, hertz: number): Promise<number> {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "laku-level-")), "video.mp4");
  writeFileSync(file, bytes);
  const { stderr } = await promisify(execFile)("ffmpeg", ["-v", "info", "-i", file, "-vn", "-af", `bandpass=f=${hertz}:width_type=h:w=30,volumedetect`, "-f", "null", "-"]).catch(
    (error: { stderr: string }) => ({ stderr: error.stderr }),
  );
  const found = /mean_volume: (-?[0-9.]+) dB/.exec(String(stderr));
  return found ? Number(found[1]) : -91;
}
