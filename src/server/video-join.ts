import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The real length of a video in seconds, read from the file itself and never from what a request says. */
export async function probeSeconds(video: Uint8Array): Promise<number> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-probe-"));
  try {
    await writeFile(path.join(dir, "video.mp4"), video);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "video.mp4"], { cwd: dir });
    const seconds = Number(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("The video has no readable length.");
    return seconds;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Lays one narration over a silent video, cut to `seconds` so a narration that runs long does not extend the video.
 * The picture is copied as it is, only the sound is added. Needs ffmpeg on the machine.
 */
export async function addVoice(video: Uint8Array, voice: Uint8Array, seconds: number): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-voice-"));
  try {
    await writeFile(path.join(dir, "video.mp4"), video);
    await writeFile(path.join(dir, "voice.audio"), voice);
    await run(
      "ffmpeg",
      [
        "-v", "error", "-y",
        "-i", "video.mp4", "-i", "voice.audio",
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac",
        "-t", String(seconds),
        "-movflags", "+faststart",
        "out.mp4",
      ],
      { cwd: dir },
    );
    return new Uint8Array(await readFile(path.join(dir, "out.mp4")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Joins clips in order into one silent MP4 of `seconds` (the clips can add up to a little more, which is
 * cut off the end). The audio track the video model made is dropped, so a voice-over can be laid on later.
 * Needs ffmpeg on the machine.
 */
export async function joinClips(clips: Uint8Array[], seconds: number): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-join-"));
  try {
    const names = clips.map((_, index) => `clip-${index}.mp4`);
    await Promise.all(clips.map((bytes, index) => writeFile(path.join(dir, names[index]), bytes)));
    await writeFile(path.join(dir, "list.txt"), names.map((name) => `file '${name}'`).join("\n"));
    await run(
      "ffmpeg",
      [
        "-v", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", "list.txt",
        "-t", String(seconds),
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "out.mp4",
      ],
      { cwd: dir },
    );
    return new Uint8Array(await readFile(path.join(dir, "out.mp4")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
