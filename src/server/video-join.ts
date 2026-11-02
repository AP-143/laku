import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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
