import "./paper.css";

/** Fifteen long white strokes sweeping up and to the right, drawn once in a 1000x600 box. */
const STROKES = Array.from({ length: 15 }, (_, i) => {
  const y = 40 + i * 42;
  const bend = 90 + ((i * 53) % 120);
  return {
    d: `M -60 ${y + 220} C 220 ${y + 220 - bend}, 420 ${y + bend}, 1060 ${y - 260}`,
    width: 1.2 + ((i * 37) % 28) / 10,
    opacity: 0.55 + ((i * 17) % 31) / 100,
  };
});

/** The soft paper with flowing white lines that both pages sit on. Its parent decides when it appears. */
export function PaperBackground({ className = "" }: { className?: string }) {
  return (
    <div className={`paper ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 1000 600" preserveAspectRatio="none">
        {STROKES.map((stroke, index) => (
          <path
            key={index}
            d={stroke.d}
            fill="none"
            stroke="#fff"
            strokeWidth={stroke.width}
            strokeOpacity={stroke.opacity}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
