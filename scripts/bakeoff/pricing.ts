/**
 * Cost estimation from the live gateway catalogue. Prices change often, so they are read at run
 * time instead of being copied into the code.
 */

const CATALOGUE_URL = "https://ai-gateway.vercel.sh/v1/models";

/** Planning price used when a model's price cannot be read (for example token-priced video). */
export const UNKNOWN_PRICE_FALLBACK_USD = 0.25;

interface CatalogueEntry {
  id: string;
  type: string;
  pricing?: Record<string, unknown>;
}

export type Catalogue = Map<string, CatalogueEntry>;

export interface Estimate {
  usd: number;
  /** True when the catalogue had no readable price and the fallback was used. */
  guessed: boolean;
}

export async function fetchCatalogue(): Promise<Catalogue> {
  const response = await fetch(CATALOGUE_URL);
  if (!response.ok) {
    throw new Error(`Could not fetch the model catalogue (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { data: CatalogueEntry[] };
  return new Map(body.data.map((entry) => [entry.id, entry]));
}

function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Estimated price of one generated image (about 1K resolution). */
export function estimateImageCost(catalogue: Catalogue, modelId: string): Estimate {
  const pricing = catalogue.get(modelId)?.pricing ?? {};

  const tiers = pricing.image_dimension_quality_pricing;
  if (Array.isArray(tiers)) {
    const sizeTiers = tiers.filter(
      (tier): tier is { size: string; cost: string } =>
        typeof tier === "object" && tier !== null && "size" in tier && "cost" in tier,
    );
    const preferred =
      sizeTiers.find((tier) => ["1024x1024", "1K", "default"].includes(tier.size)) ?? sizeTiers[0];
    const cost = toNumber(preferred?.cost);
    if (cost !== undefined) return { usd: cost, guessed: false };
  }

  const flat = toNumber(pricing.image);
  if (flat !== undefined) return { usd: flat, guessed: false };

  return { usd: UNKNOWN_PRICE_FALLBACK_USD, guessed: true };
}

/** Estimated price of a clip: the cheapest no-audio per-second rate at the wanted tier, times the duration. */
export function estimateVideoCost(
  catalogue: Catalogue,
  modelId: string,
  tier: string,
  seconds: number,
): Estimate {
  const pricing = catalogue.get(modelId)?.pricing ?? {};
  const rates = pricing.video_duration_pricing;

  if (Array.isArray(rates)) {
    const candidates = rates.filter(
      (rate): rate is { resolution?: string; audio?: boolean; cost_per_second: string } =>
        typeof rate === "object" && rate !== null && "cost_per_second" in rate && rate.audio !== true,
    );
    const atTier = candidates.filter((rate) => rate.resolution === tier);
    const pool = atTier.length > 0 ? atTier : candidates;
    const perSecond = pool
      .map((rate) => toNumber(rate.cost_per_second))
      .filter((value): value is number => value !== undefined);
    if (perSecond.length > 0) return { usd: Math.min(...perSecond) * seconds, guessed: false };
  }

  return { usd: UNKNOWN_PRICE_FALLBACK_USD, guessed: true };
}

export function formatUsd(amount: number): string {
  return `US$${amount.toFixed(3)}`;
}
