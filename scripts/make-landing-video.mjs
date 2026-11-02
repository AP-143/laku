// One-off: turns the supplied animated WebP (the "01 Otomasi Produk" design package) into the landing page's
// looping pill video and its poster. No AI model is involved.
//
// The source is square (1080x1080) and the pill is about 2:1, so each frame is cropped to a 1080x540 band that
// keeps the AI orb, the hologram, the hacker's head and the laptop screen in view.
//
// Usage: node scripts/make-landing-video.mjs <animated.webp>   (needs ffmpeg on the PATH)

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/make-landing-video.mjs <animated.webp>");

const WIDTH = 1080;
const BAND_HEIGHT = 540;
/** The crop's top edge in the 1080x1080 source. */
const BAND_TOP = 120;
const FPS = 20;

const { pages = 1, delay = [] } = await sharp(source).metadata();
if (pages < 2) throw new Error("The source is not animated");
if (new Set(delay).size !== 1 || 1000 / delay[0] !== FPS) throw new Error(`Expected a steady ${FPS} fps, got delays ${delay}`);

const work = mkdtempSync(path.join(os.tmpdir(), "laku-landing-"));
for (let page = 0; page < pages; page++) {
  await sharp(source, { page })
    .extract({ left: 0, top: BAND_TOP, width: WIDTH, height: BAND_HEIGHT })
    .png()
    .toFile(path.join(work, `frame-${String(page).padStart(3, "0")}.png`));
}

const outDir = path.resolve("public/media/landing");
mkdirSync(outDir, { recursive: true });
const output = path.join(outDir, "loop.mp4");

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("ffmpeg failed");
}

ffmpeg([
  "-framerate", String(FPS),
  "-i", path.join(work, "frame-%03d.png"),
  "-an",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-crf", "26",
  "-preset", "slow",
  "-movflags", "+faststart",
  output,
]);

// A poster for the first paint and for visitors who prefer reduced motion.
ffmpeg(["-i", output, "-frames:v", "1", "-q:v", "3", path.join(outDir, "loop-poster.jpg")]);
