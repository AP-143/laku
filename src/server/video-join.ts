import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { VideoGrade } from "../shared/video-plan";

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

/** Whether a video file has a sound track. */
async function hasAudioTrack(dir: string, file: string): Promise<boolean> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { cwd: dir });
  return stdout.trim() !== "";
}

/** One line of the voice-over as audio, with the second it starts at and how much it is sped up to fit its moment. */
export interface VoiceSegment {
  bytes: Uint8Array;
  start: number;
  tempo: number;
}

/**
 * Lays the lines of the voice-over over a video, each starting at its own moment, and cut to `seconds`. The picture is
 * copied as it is. The sound the video already has (effects, room tone, music) stays underneath and ducks while the
 * narrator speaks, like a professional mix; a video with no sound gets the narration alone. Needs ffmpeg on the machine.
 */
export async function addVoice(video: Uint8Array, segments: VoiceSegment[], seconds: number): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-voice-"));
  try {
    await writeFile(path.join(dir, "video.mp4"), video);
    await Promise.all(segments.map((segment, index) => writeFile(path.join(dir, `voice-${index}.audio`), segment.bytes)));
    const mixed = await hasAudioTrack(dir, "video.mp4");
    const stereo = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
    const fade = `afade=t=out:st=${Math.max(0, seconds - 0.4)}:d=0.4`;
    // Each line is sped up a little when it only just runs past its moment, then delayed to where it belongs.
    const lines = segments.map((segment, index) => {
      const pace = segment.tempo > 1.001 ? `atempo=${segment.tempo.toFixed(3)},` : "";
      return `[${index + 1}:a]${pace}${stereo},adelay=${Math.round(segment.start * 1000)}:all=1[v${index}]`;
    });
    const names = segments.map((_, index) => `[v${index}]`).join("");
    const voice = segments.length > 1 ? `${names}amix=inputs=${segments.length}:duration=longest:normalize=0[voice]` : `[v0]anull[voice]`;
    const graph = mixed
      ? `${lines.join(";")};${voice};[0:a]${stereo}[bg];[voice]asplit=2[vo1][vo2];[bg][vo1]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=300[ducked];[ducked][vo2]amix=inputs=2:duration=first:normalize=0,${fade}[a]`
      : `${lines.join(";")};${voice};[voice]${fade}[a]`;
    await run(
      "ffmpeg",
      [
        "-v", "error", "-y", "-i", "video.mp4",
        ...segments.flatMap((_, index) => ["-i", `voice-${index}.audio`]),
        "-filter_complex", graph, "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-t", String(seconds), "-movflags", "+faststart", "out.mp4",
      ],
      { cwd: dir },
    );
    return new Uint8Array(await readFile(path.join(dir, "out.mp4")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What a professional edit adds to the joined clips: one grade and a little grain. The text on screen is the video model's. */
export interface Finishing {
  grade: VideoGrade;
}

/** The ffmpeg graph of the finishing: one grade, a little grain and a vignette over the whole joined video. */
function finishingGraph({ grade }: Finishing): string {
  const steps = [`eq=contrast=${grade.contrast}:saturation=${grade.saturation}:brightness=${grade.brightness}`];
  if (Math.abs(grade.warmth) > 0.005) steps.push(`colorbalance=rm=${grade.warmth}:bm=${-grade.warmth}`);
  if (grade.grain > 0) steps.push(`noise=alls=${grade.grain}:allf=t`);
  if (grade.vignette) steps.push("vignette=a=PI/4");
  return `[0:v]${steps.join(",")}[vout]`;
}

/**
 * Lays a music bed under a video's sound, cut to `seconds` with a short fade in and a longer fade out. The music is
 * quieter by `gain` and ducks while the sound of the video is loud (speech, effects), like a professional mix; a video
 * with no sound gets the music alone. The picture is copied as it is. Needs ffmpeg on the machine.
 */
export async function addMusic(video: Uint8Array, music: Uint8Array, seconds: number, gain: number): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-music-"));
  try {
    await writeFile(path.join(dir, "video.mp4"), video);
    await writeFile(path.join(dir, "music.audio"), music);
    const mixed = await hasAudioTrack(dir, "video.mp4");
    const musicSeconds = await probeSeconds(music);
    const stereo = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
    // A clip of music is 30 seconds; a longer video gets the music to its end with the fade, not a hard stop.
    const fadeAt = Math.max(0, Math.min(seconds, musicSeconds) - 1.2);
    const bed = `[1:a]atrim=0:${seconds},asetpts=PTS-STARTPTS,${stereo},volume=${gain.toFixed(3)},afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeAt.toFixed(2)}:d=1.2`;
    const graph = mixed
      ? `[0:a]${stereo},asplit=2[fg][key];${bed}[m];[m][key]sidechaincompress=threshold=0.1:ratio=6:attack=30:release=500[md];[fg][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`
      : `${bed},alimiter=limit=0.95[a]`;
    await run(
      "ffmpeg",
      ["-v", "error", "-y", "-i", "video.mp4", "-i", "music.audio", "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-t", String(seconds), "-movflags", "+faststart", "out.mp4"],
      { cwd: dir },
    );
    return new Uint8Array(await readFile(path.join(dir, "out.mp4")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Joins clips in order into one MP4 of `seconds` (the clips can add up to a little more, which is cut off the end).
 * The sound the video model made (effects, room tone, and the speech when the person talks) is kept and levelled so
 * the clips do not jump in loudness. Needs ffmpeg on the machine.
 */
export async function joinClips(clips: Uint8Array[], seconds: number, finishing?: Finishing): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-join-"));
  try {
    const names = clips.map((_, index) => `clip-${index}.mp4`);
    await Promise.all(clips.map((bytes, index) => writeFile(path.join(dir, names[index]), bytes)));
    await writeFile(path.join(dir, "list.txt"), names.map((name) => `file '${name}'`).join("\n"));
    // Joining sound needs every clip to have it; one that does not (an old saved clip) makes the whole video silent.
    const sound = (await Promise.all(names.map((name) => hasAudioTrack(dir, name)))).every(Boolean);
    // The grade and the grain are applied in the same pass that joins the clips, so the picture is encoded once.
    const graph = finishing ? finishingGraph(finishing) : undefined;
    await run(
      "ffmpeg",
      [
        "-v", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", "list.txt",
        "-t", String(seconds),
        ...(graph ? ["-filter_complex", graph, "-map", "[vout]", ...(sound ? ["-map", "0:a"] : [])] : []),
        // Re-encoding at the default quality kept about 40% of the detail of the clips and made the picture soft and
        // plastic; CRF 17 keeps about 80% of it.
        "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p",
        // The sound ends with a short fade, so the video never stops on a click.
        ...(sound ? ["-af", `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${Math.max(0, seconds - 0.4)}:d=0.4`, "-ar", "48000", "-c:a", "aac"] : ["-an"]),
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
