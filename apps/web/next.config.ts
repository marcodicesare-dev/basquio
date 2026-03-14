import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
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
