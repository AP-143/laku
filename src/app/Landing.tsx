"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useInfoDialog } from "./InfoDialog";
import { PaperBackground } from "./PaperBackground";
import "./landing.css";

/** The brand word. It is split as LA | pill | KU, so it only has to be changed here. */
const BRAND = "LAKU";
const SPLIT_AT = 2;

const DURATION_MS = 2100;
const PHONE_QUERY = "(max-width: 720px)";
/** The phone pill ends at this width : height ratio. */
const PHONE_PILL_RATIO = 1.85;

type Frame = Keyframe & { offset: number };

/** Plays one property track over the whole timeline. `at` maps offsets (0 to 1) to values. */
function track(element: Element | null, property: string, at: Array<[number, string, string?]>): Animation | undefined {
  if (!element) return undefined;
  const frames: Frame[] = at.map(([offset, value, easing]) => ({ offset, [property]: value, ...(easing ? { easing } : {}) }));
  return element.animate(frames, { duration: DURATION_MS, fill: "both" });
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const hair = useRef<HTMLSpanElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const foot = useRef<HTMLElement>(null);
  const rule = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const info = useInfoDialog();

  useEffect(() => {
    const element = root.current;
    if (!element) return;

    // Reduced motion: show the finished page right away, with the video resting on its poster.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Dropping the source (instead of pausing mid-play) leaves nothing but the poster on screen.
      if (video.current) {
        video.current.removeAttribute("src");
        video.current.load();
      }
      element.classList.remove("pre");
      return;
    }

    const phone = window.matchMedia(PHONE_QUERY).matches;
    const running: Animation[] = [];
    let cancelled = false;

    // The reveal starts once fonts are ready, so the word does not jump while it plays.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      const play = (animation?: Animation) => animation && running.push(animation);

      if (phone) {
        const finalHeight = (window.innerWidth - 40) / PHONE_PILL_RATIO;
        play(
          track(pill.current, "height", [
            [0, "1.5px", "cubic-bezier(.5,0,.3,1)"],
            [0.14, "1.5px", "cubic-bezier(.45,0,.3,1)"],
            [0.3, `${finalHeight * 0.1}px`, "cubic-bezier(.4,0,.2,1)"],
            [0.58, `${finalHeight * 0.55}px`, "cubic-bezier(.4,0,.2,1)"],
            [1, `${finalHeight}px`],
          ]),
        );
        play(track(pill.current, "clipPath", [[0, "inset(0 50%)"], [0.14, "inset(0)"], [1, "inset(0)"]]));
        play(track(row.current, "gap", [[0, "0.03em"], [0.14, "0.03em"], [0.58, "0.06em"], [1, "0.1em"]]));
      } else {
        play(
          track(pill.current, "width", [
            [0, "0.012em", "cubic-bezier(.5,0,.3,1)"],
            [0.14, "0.012em", "cubic-bezier(.45,0,.3,1)"],
            [0.3, "0.16em", "cubic-bezier(.4,0,.2,1)"],
            [0.58, "1.81em", "cubic-bezier(.4,0,.2,1)"],
            [1, "3.62em"],
          ]),
        );
        play(track(pill.current, "clipPath", [[0, "inset(50% 0)"], [0.14, "inset(0)"], [1, "inset(0)"]]));
        play(track(row.current, "gap", [[0, "0.026em"], [0.14, "0.026em"], [0.58, "0.05em"], [1, "0.085em"]]));
      }

      // The grey hairline fades on its own layer, never on the video.
      play(track(hair.current, "opacity", [[0, "1"], [0.14, "1"], [0.3, "0"], [1, "0"]]));
      play(track(bg.current, "opacity", [[0, "0"], [0.45, "0"], [0.78, "1"], [1, "1"]]));
      play(
        track(nav.current, "transform", [
          [0, "translateY(-140%)"],
          [0.5, "translateY(-140%)", "cubic-bezier(.2,.8,.2,1)"],
          [0.86, "translateY(0)"],
          [1, "translateY(0)"],
        ]),
      );
      play(
        track(foot.current, "transform", [
          [0, "translateY(160%)"],
          [0.52, "translateY(160%)", "cubic-bezier(.2,.8,.2,1)"],
          [0.9, "translateY(0)"],
          [1, "translateY(0)"],
        ]),
      );
      play(track(rule.current, "transform", [[0, "scaleX(0)"], [0.4, "scaleX(0)"], [0.95, "scaleX(1)"], [1, "scaleX(1)"]]));

      // The animations now hold the first frame, so the page can show its normal (finished) styles underneath.
      element.classList.remove("pre");
    });

    // On resize the sizes change, so a running reveal just jumps to its end.
    const finish = () => running.forEach((animation) => animation.finish());
    window.addEventListener("resize", finish);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", finish);
      running.forEach((animation) => animation.cancel());
    };
  }, []);

  const left = BRAND.slice(0, SPLIT_AT);
  const right = BRAND.slice(SPLIT_AT);

  return (
    <div ref={root} className="landing pre">
      <div ref={bg} className="paper-wrap">
        <PaperBackground />
      </div>

      <nav ref={nav} className="top" aria-label="Menu utama">
        <div>
          <Link href="/">Beranda</Link>
          <a {...info.link("fitur")}>Fitur</a>
          <a {...info.link("cara-kerja")}>Cara Kerja</a>
          <a {...info.link("kontak")}>Kontak</a>
        </div>
        <Link href="/chat" className="top-cta">
          Mulai Chat
        </Link>
      </nav>

      <main className="hero">
        <h1 ref={row} className="row" aria-label={BRAND}>
          <span className="part" aria-hidden="true">
            {left}
          </span>
          <div ref={pill} className="pill" aria-hidden="true">
            <video
              ref={video}
              src="/media/landing/loop.mp4"
              poster="/media/landing/loop-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
            <span ref={hair} className="hair" />
          </div>
          <span className="part" aria-hidden="true">
            {right}
          </span>
        </h1>
      </main>

      <footer ref={foot} className="foot">
        <p>Ubah foto produk biasa jadi foto studio, storyboard, dan video iklan — semua lewat satu chat.</p>
        <div className="foot-row">
          <span ref={rule} className="rule" />
          <Link href="/chat" className="go">
            Coba Sekarang
          </Link>
        </div>
      </footer>
      {info.dialog}
    </div>
  );
}
