import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent instructions live in CLAUDE.md; do not let `next dev` generate a second file.
  agentRules: false,
  // The chat sidebar ends at the bottom left, so the dev badge goes to the other corner.
  devIndicators: { position: "bottom-right" },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
