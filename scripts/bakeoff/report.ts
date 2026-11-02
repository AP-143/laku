import { formatUsd } from "./pricing";

export type ErrorClass =
  | "account_blocked"
  | "rate_limit"
  | "no_credits_or_quota"
  | "unsupported_input"
  | "other";

export interface JobResult {
  kind: "image" | "video" | "speech";
  /** Model id; image candidates add the output size ("gemini-3.1-flash-image@512"). */
  modelId: string;
  /** Original photo file name the job used (video jobs record the source photo). */
  photo: string;
  /** Image jobs only. A sheet is one image holding all four storyboard scenes. */
  useCase?: "studio" | "frame" | "sheet";
  status: "ok" | "error" | "skipped";
  errorClass?: ErrorClass;
  errorMessage?: string;
  estimatedUsd: number;
  priceGuessed: boolean;
  /** Path of the saved output, relative to the run folder. */
  file?: string;
  seconds: number;
  warnings: string[];
}

export function classifyError(error: unknown): ErrorClass {
  const status = (error as { statusCode?: number; status?: number })?.statusCode ??
    (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);

  // Billing is not enabled on the key's project, whatever the model. Check this first.
  if (/credit card|add a card|valid card|billing (account|is not|must)|enable billing|free tier.*not available/i.test(message)) {
    return "account_blocked";
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(message)) return "rate_limit";
  if (
    status === 402 ||
    /insufficient|credit|quota|billing|payment|not (available|included).*(free|plan)|free tier/i.test(
      message,
    )
  ) {
    return "no_credits_or_quota";
  }
  if (/image (input|prompt)|reference|unsupported|not support|file input|input.*image/i.test(message)) {
    return "unsupported_input";
  }
  return "other";
}

const ERROR_LABELS: Record<ErrorClass, string> = {
  account_blocked: "Google project has no billing enabled for this model",
  rate_limit: "rate limit (HTTP 429)",
  no_credits_or_quota: "credits or quota",
  unsupported_input: "image input not accepted",
  other: "other error",
};

interface ModelSummary {
  modelId: string;
  kind: JobResult["kind"];
  ok: number;
  failed: number;
  failureReasons: Map<ErrorClass, number>;
  estimatedUsd: number;
}

export function summarize(results: JobResult[]): ModelSummary[] {
  const byModel = new Map<string, ModelSummary>();
  for (const result of results) {
    if (result.status === "skipped") continue;
    const key = `${result.kind}:${result.modelId}`;
    const summary =
      byModel.get(key) ??
      { modelId: result.modelId, kind: result.kind, ok: 0, failed: 0, failureReasons: new Map(), estimatedUsd: 0 };
    if (result.status === "ok") {
      summary.ok += 1;
      summary.estimatedUsd += result.estimatedUsd;
    } else {
      summary.failed += 1;
      const reason = result.errorClass ?? "other";
      summary.failureReasons.set(reason, (summary.failureReasons.get(reason) ?? 0) + 1);
    }
    byModel.set(key, summary);
  }
  return [...byModel.values()];
}

export function formatSummary(results: JobResult[]): string {
  const lines: string[] = ["", "=== Bake-off summary ==="];
  const summaries = summarize(results);

  for (const kind of ["image", "video", "speech"] as const) {
    const rows = summaries.filter((summary) => summary.kind === kind);
    if (rows.length === 0) continue;
    lines.push("", { image: "Image models", video: "Video models", speech: "Speech models" }[kind]);
    for (const row of rows) {
      const reasons = [...row.failureReasons.entries()]
        .map(([reason, count]) => `${count}x ${ERROR_LABELS[reason]}`)
        .join(", ");
      lines.push(
        `  ${row.modelId}: ${row.ok} ok, ${row.failed} failed` +
          (reasons ? ` (${reasons})` : "") +
          `, estimated cost of successes ${formatUsd(row.estimatedUsd)}`,
      );
    }
  }

  const charged = results
    .filter((result) => result.status === "ok")
    .reduce((sum, result) => sum + result.estimatedUsd, 0);
  lines.push("", `Total estimated spend (successful calls): ${formatUsd(charged)}`);

  lines.push("The real spend is the drop in your Google AI Studio balance: note it before and after this run.");

  const attempted = results.filter((result) => result.status !== "skipped");
  if (attempted.length > 0 && attempted.every((result) => result.errorClass === "account_blocked")) {
    lines.push(
      "",
      "NOTHING WAS TESTED: Google rejected every call because the key's project has no billing for these models.",
      "This says nothing about the models. Check that the key in .env.local belongs to the project you topped up.",
    );
    return lines.join("\n");
  }

  const videoRuns = results.filter((result) => result.kind === "video" && result.status !== "skipped");
  if (videoRuns.length > 0 && !videoRuns.some((result) => result.status === "ok")) {
    lines.push(
      "",
      "VIDEO PRODUCED NOTHING: check the error reason above (a 400 usually means a request field the API rejects).",
    );
  }

  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A static page for judging outputs by eye: the original next to every model's result. */
export function buildViewerHtml(results: JobResult[], photos: string[], videoSourceNote: string): string {
  const imageModels = [...new Set(results.filter((r) => r.kind === "image").map((r) => r.modelId))];
  const cell = (result: JobResult | undefined) => {
    if (!result) return "<td>-</td>";
    if (result.status === "ok" && result.file) {
      return `<td><img src="${escapeHtml(result.file)}" loading="lazy"><small>${formatUsd(result.estimatedUsd)}, ${result.seconds.toFixed(1)}s</small></td>`;
    }
    return `<td class="fail">${escapeHtml(result.errorClass ?? result.status)}<small>${escapeHtml((result.errorMessage ?? "").slice(0, 160))}</small></td>`;
  };

  const titles = {
    studio: "Studio photo (clean white background)",
    frame: "Storyboard frame (lifestyle scene, 9:16)",
    sheet: "Storyboard sheet (4 scenes in one image)",
  } as const;
  const usedCases = (["studio", "frame", "sheet"] as const).filter((useCase) =>
    results.some((r) => r.kind === "image" && r.useCase === useCase),
  );
  const sections = usedCases.map((useCase) => {
    const head = `<tr><th>Original</th>${imageModels.map((m) => `<th>${escapeHtml(m)}</th>`).join("")}</tr>`;
    const rows = photos
      .map((photo) => {
        const cells = imageModels
          .map((modelId) =>
            cell(results.find((r) => r.kind === "image" && r.modelId === modelId && r.photo === photo && r.useCase === useCase)),
          )
          .join("");
        return `<tr><td><img src="originals/${escapeHtml(photo)}.jpg" loading="lazy"><small>${escapeHtml(photo)}</small></td>${cells}</tr>`;
      })
      .join("");
    return `<h2>${titles[useCase]}</h2><table>${head}${rows}</table>`;
  });

  const media = (kind: "video" | "speech") =>
    results
      .filter((r) => r.kind === kind)
      .map((r) => {
        if (r.status !== "ok" || !r.file) {
          return `<figure class="fail"><figcaption>${escapeHtml(r.modelId)}: ${escapeHtml(r.errorClass ?? r.status)}<br><small>${escapeHtml((r.errorMessage ?? "").slice(0, 200))}</small></figcaption></figure>`;
        }
        const player =
          kind === "video"
            ? `<video src="${escapeHtml(r.file)}" controls loop playsinline></video>`
            : `<audio src="${escapeHtml(r.file)}" controls></audio>`;
        const notes = r.warnings.map((warning) => `<br><small>${escapeHtml(warning)}</small>`).join("");
        return `<figure>${player}<figcaption>${escapeHtml(r.modelId)} (${formatUsd(r.estimatedUsd)}, ${r.seconds.toFixed(0)}s to make)${notes}</figcaption></figure>`;
      })
      .join("");
  const videos = media("video");
  const speech = media("speech");

  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>LAKU bake-off</title>
<style>
body{font:14px system-ui;margin:24px;background:#111;color:#eee}
table{border-collapse:collapse;margin-bottom:32px}
th,td{border:1px solid #333;padding:6px;vertical-align:top;text-align:center}
img{max-width:220px;max-height:300px;display:block;margin:0 auto 4px}
small{display:block;color:#999;max-width:220px;word-break:break-word}
.fail{color:#f88}
figure{display:inline-block;margin:0 16px 16px 0}
video{max-width:240px;display:block}
</style>
<h1>LAKU model bake-off</h1>
${sections.join("")}
<h2>Video (${escapeHtml(videoSourceNote)})</h2>
${videos || "<p>No video jobs ran.</p>"}
<h2>Voice-over sample</h2>
${speech || "<p>No speech jobs ran.</p>"}
</html>`;
}
