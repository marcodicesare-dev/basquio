import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: [],
  outputFileTracingExcludes: {
    "/*": [
      ".next/cache/**/*",
      "../../output/**/*",
      "../../.basquio/**/*",
      "../../docs/**/*",
      "../../memory/**/*",
      "../../rules/**/*",
      "../../scripts/**/*",
      "../../README.md",
      "../../AGENTS.md",
    ],
  },
  transpilePackages: [
    "@basquio/core",
    "@basquio/data-ingest",
    "@basquio/intelligence",
    "@basquio/render-charts",
    "@basquio/render-pdf",
    "@basquio/render-pptx",
    "@basquio/template-engine",
    "@basquio/types",
    "@basquio/workflows",
  ],
};

export default nextConfig;
