import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // @boundaryml/baml ships native bindings (.node binaries) that Webpack
  // tries to bundle by default and fails with "Unexpected character" parse
  // errors. Externalize so Vercel runtime resolves it from node_modules
  // at request time. Same pattern as sharp / @resvg/resvg-js. See Brief 3
  // PUSH 2 + memory/canonical-memory.md for the canonical recipe.
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "@boundaryml/baml"],
  images: {
    qualities: [75, 95],
  },
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
  async redirects() {
    return [
      {
        source: "/trust",
        destination: "/security",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
