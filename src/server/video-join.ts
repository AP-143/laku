import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { CTA_HOLD_SECONDS, readableInk, type ClipCaption, type TextPalette, type VideoGrade } from "../shared/video-plan";

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

/**
 * Lays one narration over a video, cut to `seconds` so a narration that runs long does not extend the video.
 * The picture is copied as it is. The sound the video already has (effects and room tone) stays underneath and
 * ducks while the narrator speaks, like a professional mix; a video with no sound gets the narration alone.
 * Needs ffmpeg on the machine.
 */
export async function addVoice(video: Uint8Array, voice: Uint8Array, seconds: number, tempo = 1): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laku-voice-"));
  try {
    await writeFile(path.join(dir, "video.mp4"), video);
    await writeFile(path.join(dir, "voice.audio"), voice);
    const mixed = await hasAudioTrack(dir, "video.mp4");
    const stereo = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
    // A narration that only just runs past the end is sped up a little, so its last words are not cut off.
    const pace = tempo > 1.001 ? `atempo=${tempo.toFixed(3)},` : "";
    const fade = `afade=t=out:st=${Math.max(0, seconds - 0.4)}:d=0.4`;
    const mix = mixed
      ? [
          "-filter_complex",
          `[0:a]${stereo}[bg];[1:a]${pace}${stereo},asplit=2[vo1][vo2];[bg][vo1]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=300[ducked];[ducked][vo2]amix=inputs=2:duration=first:normalize=0,${fade}[a]`,
          "-map", "0:v", "-map", "[a]",
        ]
      : ["-filter_complex", `[1:a]${pace}${stereo},${fade}[a]`, "-map", "0:v", "-map", "[a]"];
    await run(
      "ffmpeg",
      ["-v", "error", "-y", "-i", "video.mp4", "-i", "voice.audio", ...mix, "-c:v", "copy", "-c:a", "aac", "-t", String(seconds), "-movflags", "+faststart", "out.mp4"],
      { cwd: dir },
    );
    return new Uint8Array(await readFile(path.join(dir, "out.mp4")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The font of the captions, kept in the repo so they look the same on every machine. */
const CAPTION_FONT = path.resolve("src/server/fonts/Geist-Regular.ttf");
/** A caption line is broken before it gets wider than this many characters, so it fits a vertical picture. */
const CAPTION_LINE_CHARS = 22;

/** Breaks a caption into centred lines of at most `CAPTION_LINE_CHARS`; a "|" in it starts a new line. */
export function wrapCaption(text: string): string {
  return text
    .split("|")
    .flatMap((part) => {
      const lines: string[] = [];
      let line = "";
      for (const word of part.trim().split(/\s+/).filter(Boolean)) {
        if (line && (line + " " + word).length > CAPTION_LINE_CHARS) {
          lines.push(line);
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      }
      if (line) lines.push(line);
      return lines;
    })
    .join("\n");
}

/** What a professional edit adds to the joined clips: one grade, a little grain, and the text. */
export interface Finishing {
  /** The length of each clip in seconds, to know when each clip starts. */
  clipSeconds: number[];
  captions: ClipCaption[][];
  grade: VideoGrade;
  palette: TextPalette;
}

const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A designed bubble with words in it, as a picture with a transparent background: a callout (the colour of the ad,
 * outlined in its accent) or the call to buy (filled with the accent). The words are measured by the renderer, so the
 * bubble always fits them.
 */
async function renderBubble(caption: ClipCaption, palette: TextPalette, width: number, height: number): Promise<Buffer> {
  const cta = caption.kind === "cta";
  const size = Math.round(height * (cta ? 0.04 : 0.032));
  const fill = cta ? palette.accent : palette.bubble;
  const ink = readableInk(fill, cta ? palette.text : palette.text);
  const padX = Math.round(size * 0.95);
  const padY = Math.round(size * 0.55);
  const markup = `<span foreground="${ink}" weight="bold" size="${size * 1024}">${escapeMarkup(caption.text.split("|").map((line) => line.trim()).join("\n"))}</span>`;
  const text = await sharp({ text: { text: markup, font: "Geist", fontfile: CAPTION_FONT, rgba: true, dpi: 72, width: Math.round(width * 0.72) - 2 * padX, align: "center" } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const w = text.info.width + 2 * padX;
  const h = text.info.height + 2 * padY;
  const stroke = cta ? 0 : Math.max(2, Math.round(size * 0.1));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${stroke / 2}" y="${stroke / 2}" width="${w - stroke}" height="${h - stroke}" rx="${Math.min((h - stroke) / 2, size * 1.1)}" fill="${fill}"${stroke ? ` stroke="${palette.accent}" stroke-width="${stroke}"` : ""}/></svg>`,
  );
  return sharp(svg).composite([{ input: text.data, left: padX, top: padY }]).png().toBuffer();
}

/** What the finishing adds to the ffmpeg command: more inputs (the bubbles) and the graph that draws everything. */
async function finishingGraph(
  dir: string,
  size: { width: number; height: number },
  seconds: number,
  finishing: Finishing,
): Promise<{ inputs: string[]; graph: string }> {
  const { grade, captions, clipSeconds, palette } = finishing;
  const inputs: string[] = [];
  const steps: string[] = [];
  let last = "v0";
  const base = [`eq=contrast=${grade.contrast}:saturation=${grade.saturation}:brightness=${grade.brightness}`];
  if (Math.abs(grade.warmth) > 0.005) base.push(`colorbalance=rm=${grade.warmth}:bm=${-grade.warmth}`);
  steps.push(`[0:v]${base.join(",")}[v0]`);

  let font = true;
  try {
    await copyFile(CAPTION_FONT, path.join(dir, "caption.ttf"));
  } catch {
    // Without the font the video is still made, only without text.
    font = false;
  }

  let start = 0;
  let count = 0;
  const textSize = Math.round(size.height * 0.046);
  if (font) {
    for (const [index, clip] of captions.entries()) {
      for (const caption of clip) {
        let from = start + caption.from;
        const to = caption.kind === "cta" ? seconds : Math.min(start + caption.to, seconds);
        // The call to buy is on screen well before the end and holds to the last frame, wherever it was put.
        if (caption.kind === "cta") from = Math.max(start, Math.min(from, seconds - CTA_HOLD_SECONDS));
        const next = `v${++count}`;
        if (caption.kind === "subtitle") {
          const file = `caption-${count}.txt`;
          await writeFile(path.join(dir, file), wrapCaption(caption.text));
          steps.push(
            `[${last}]` +
              [
                `drawtext=fontfile=caption.ttf:textfile=${file}:fontsize=${textSize}:fontcolor=white`,
                `borderw=${Math.max(2, Math.round(textSize * 0.09))}:bordercolor=black@0.9:shadowx=0:shadowy=3:shadowcolor=black@0.45`,
                `line_spacing=${Math.round(textSize * 0.25)}:text_align=center:x=(w-text_w)/2:y=h*0.68`,
                `enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`,
                `alpha='if(lt(t,${from.toFixed(2)}+0.15),(t-${from.toFixed(2)})/0.15,if(gt(t,${to.toFixed(2)}-0.15),(${to.toFixed(2)}-t)/0.15,1))'`,
              ].join(":") +
              `[${next}]`,
          );
        } else {
          // A callout or the call to buy: a bubble picture that fades in, rises a little, and (a callout) fades out.
          const file = `bubble-${count}.png`;
          await writeFile(path.join(dir, file), await renderBubble(caption, palette, size.width, size.height));
          inputs.push("-loop", "1", "-framerate", "24", "-t", String(seconds), "-i", file);
          const bubble = `b${count}`;
          const input = inputs.filter((value) => value === "-i").length;
          const fadeOut = caption.kind === "cta" ? "" : `,fade=t=out:st=${(to - 0.2).toFixed(2)}:d=0.2:alpha=1`;
          steps.push(`[${input}:v]format=rgba,fade=t=in:st=${from.toFixed(2)}:d=0.2:alpha=1${fadeOut}[${bubble}]`);
          const y = caption.kind === "cta" ? size.height * 0.66 : size.height * 0.16;
          steps.push(
            `[${last}][${bubble}]overlay=x=(W-w)/2:y='${Math.round(y)}+max(0,1-(t-${from.toFixed(2)})/0.3)*24':enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'[${next}]`,
          );
        }
        last = next;
      }
      start += clipSeconds[index] ?? 0;
    }
  }
  const tail: string[] = [];
  if (grade.grain > 0) tail.push(`noise=alls=${grade.grain}:allf=t`);
  if (grade.vignette) tail.push("vignette=a=PI/4");
  steps.push(`[${last}]${tail.length > 0 ? tail.join(",") : "null"}[vout]`);
  return { inputs, graph: steps.join(";") };
}

/** The size of a video file in pixels. */
async function videoSize(dir: string, file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], { cwd: dir });
  const [width, height] = stdout.trim().split("x").map(Number);
  return { width: width || 720, height: height || 1280 };
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
    // The grade, the grain and the text are drawn in the same pass that joins the clips, so the picture is encoded once.
    const finish = finishing ? await finishingGraph(dir, await videoSize(dir, names[0]), seconds, finishing) : undefined;
    await run(
      "ffmpeg",
      [
        "-v", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", "list.txt",
        ...(finish?.inputs ?? []),
        "-t", String(seconds),
        ...(finish ? ["-filter_complex", finish.graph, "-map", "[vout]", ...(sound ? ["-map", "0:a"] : [])] : []),
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
