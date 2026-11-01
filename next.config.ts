import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent instructions live in CLAUDE.md; do not let `next dev` generate a second file.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
