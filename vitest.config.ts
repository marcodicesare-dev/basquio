import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Root Vitest config for the Basquio monorepo.
 *
 * Workspace: pnpm workspace already lives at pnpm-workspace.yaml. We
 * keep a single root Vitest config because our packages are small
 * enough that per-package vitest.config.ts would be more ceremony than
 * value. Tests can live anywhere under packages/, apps/, scripts/,
 * tests/ and Vitest will find them via the default glob.
 *
 * Path aliases mirror tsconfig.base.json so tests can import the same
 * `@basquio/*` specifiers that application code uses.
 *
 * Coverage thresholds (v8 provider): lines 75, functions 75, branches
 * 70. Set per Marco's Sub-Batch A scope. Enforced on coverage runs;
 * the default `vitest run` skips coverage for speed.
 *
 * Setup file wires env var stubs so tests that import modules reading
 * process.env do not fail on missing SUPABASE / ANTHROPIC / FIRECRAWL /
 * FIBER values. The stubs are explicit test strings, never real keys.
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    globals: false,
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "scripts/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
    ],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "packages/research/src/**/*.ts",
        "packages/workflows/src/research-phase.ts",
        "packages/intelligence/src/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@basquio/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@basquio/data-ingest": path.resolve(__dirname, "packages/data-ingest/src/index.ts"),
      "@basquio/intelligence": path.resolve(__dirname, "packages/intelligence/src/index.ts"),
      "@basquio/render-charts": path.resolve(__dirname, "packages/render-charts/src/index.ts"),
      "@basquio/render-pdf": path.resolve(__dirname, "packages/render-pdf/src/index.ts"),
      "@basquio/render-pptx": path.resolve(__dirname, "packages/render-pptx/src/index.ts"),
      "@basquio/research": path.resolve(__dirname, "packages/research/src/index.ts"),
      "@basquio/research/firecrawl": path.resolve(__dirname, "packages/research/src/firecrawl-client.ts"),
      "@basquio/research/fiber": path.resolve(__dirname, "packages/research/src/fiber-client.ts"),
      "@basquio/research/http": path.resolve(__dirname, "packages/research/src/http.ts"),
      "@basquio/template-engine": path.resolve(__dirname, "packages/template-engine/src/index.ts"),
      "@basquio/types": path.resolve(__dirname, "packages/types/src/index.ts"),
      "@basquio/workflows": path.resolve(__dirname, "packages/workflows/src/index.ts"),
      "@": path.resolve(__dirname, "apps/web/src"),
      "@/": path.resolve(__dirname, "apps/web/src/"),
      // Next.js "server-only" is a no-op module that only exists to
      // assert build-time boundaries. Under Vitest there is no such
      // boundary, so alias it to an empty shim rather than failing to
      // resolve. Same trick for "client-only" when a test ever needs
      // to import a module that declares it.
      "server-only": path.resolve(__dirname, "vitest-shims/server-only.ts"),
      "client-only": path.resolve(__dirname, "vitest-shims/server-only.ts"),
    },
  },
});
