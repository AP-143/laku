import { formatUsd } from "./pricing";

export type ErrorClass =
  | "account_blocked"
  | "rate_limit"
  | "no_credits_or_quota"
  | "unsupported_input"
  | "other";

export interface JobResult {
  kind: "image" | "video";
  modelId: string;
  /** Original photo file name the job used (video jobs record the source photo). */
  photo: string;
  /** Image jobs only. */
  useCase?: "studio" | "frame";
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

  // The gateway refuses every call until a card is on file, whatever the model. Check this first.
  if (/credit card|add a card|valid card/i.test(message)) return "account_blocked";
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
  account_blocked: "gateway account needs a credit card on file",
  rate_limit: "rate limit (HTTP 429)",
  no_credits_or_quota: "credits or quota",
  unsupported_input: "image input not accepted",
  other: "other error",
};

interface ModelSummary {
  modelId: string;
  kind: "image" | "video";
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

export function formatSummary(results: JobResult[], balanceBefore?: string, balanceAfter?: string): string {
  const lines: string[] = ["", "=== Bake-off summary ==="];
  const summaries = summarize(results);

  for (const kind of ["image", "video"] as const) {
    const rows = summaries.filter((summary) => summary.kind === kind);
    if (rows.length === 0) continue;
    lines.push("", kind === "image" ? "Image models" : "Video models");
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

  if (balanceBefore !== undefined && balanceAfter !== undefined) {
    const used = Number(balanceBefore) - Number(balanceAfter);
    lines.push(
      `Gateway balance: ${balanceBefore} before, ${balanceAfter} after (actual drop ${formatUsd(used)}).`,
    );
  }

  const attempted = results.filter((result) => result.status !== "skipped");
  if (attempted.length > 0 && attempted.every((result) => result.errorClass === "account_blocked")) {
    lines.push(
      "",
      "NOTHING WAS TESTED: the gateway rejected every call because the account has no credit card on file.",
      "This says nothing about the image or video models. Add a card to unlock the free credit, then run again.",
    );
    return lines.join("\n");
  }

  const videoRuns = results.filter((result) => result.kind === "video" && result.status !== "skipped");
  if (videoRuns.length > 0) {
    const anyOk = videoRuns.some((result) => result.status === "ok");
    const allCreditProblems = videoRuns.every(
      (result) => result.status === "error" && result.errorClass === "no_credits_or_quota",
    );
    lines.push("");
    if (anyOk) {
      lines.push("Video: at least one candidate produced a clip through the gateway with the current credit.");
    } else if (allCreditProblems) {
      lines.push(
        "VIDEO IS NOT COVERED BY THE FREE CREDIT: every video candidate failed on credits or quota.",
        "Recommendation: defer feature 3 (video) and ship features 1 and 2 first.",
      );
    } else {
      lines.push(
        "VIDEO PRODUCED NOTHING: no video candidate succeeded. Check the error reasons above and the viewer;",
        "if the reason is credits or quota, defer feature 3 (video).",
      );
    }
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

  const sections = (["studio", "frame"] as const).map((useCase) => {
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
    return `<h2>${useCase === "studio" ? "Studio photo (clean white background)" : "Storyboard frame (lifestyle scene, 9:16)"}</h2><table>${head}${rows}</table>`;
  });

  const videos = results
    .filter((r) => r.kind === "video")
    .map((r) =>
      r.status === "ok" && r.file
        ? `<figure><video src="${escapeHtml(r.file)}" controls muted loop playsinline></video><figcaption>${escapeHtml(r.modelId)} (${formatUsd(r.estimatedUsd)}, ${r.seconds.toFixed(0)}s)</figcaption></figure>`
        : `<figure class="fail"><figcaption>${escapeHtml(r.modelId)}: ${escapeHtml(r.errorClass ?? r.status)}<br><small>${escapeHtml((r.errorMessage ?? "").slice(0, 200))}</small></figcaption></figure>`,
    )
    .join("");

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
</html>`;
}
