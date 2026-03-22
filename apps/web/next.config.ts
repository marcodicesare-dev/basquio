import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: ["sharp", "@resvg/resvg-wasm"],
  webpack: (config, { isServer }) => {
    // Enable WebAssembly support for @resvg/resvg-wasm
    // The error message from webpack literally says to do this.
    if (isServer) {
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };
    }
    return config;
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
};

export default nextConfig;
