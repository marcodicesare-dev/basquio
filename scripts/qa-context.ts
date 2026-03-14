import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const root = path.basename(cwd) === "Basquio" ? cwd : path.resolve(cwd, "Basquio");

const requiredFiles = [
  "README.md",
  "README.local.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  ".env.example",
  "docs/vision.md",
  "docs/architecture.md",
  "docs/research-synthesis.md",
  "docs/implementation-roadmap.md",
  "docs/stack-practices.md",
  "docs/brand-system.md",
  "docs/design-synthesis.md",
  "docs/first-generation-test.md",
  "docs/decision-log.md",
  "memory/canonical-memory.md",
  "rules/canonical-rules.md",
  "rules/prompt-contracts.md",
  "rules/qa-checklist.md",
  "agents/agents.yaml",
  "agents/graph.mmd",
  "skills/graph.md",
  "skills/basquio-foundation/SKILL.md",
  "skills/basquio-intelligence/SKILL.md",
  "skills/basquio-rendering/SKILL.md",
  "skills/basquio-stack-context/SKILL.md",
  "code/contracts.ts",
  "AGENTS.md",
  "CODEX_RULES.md",
  ".cursorrules",
  "apps/web/package.json",
  "apps/web/next.config.ts",
  "apps/web/src/app/layout.tsx",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/api/inngest/route.ts",
  "packages/core/src/index.ts",
  "packages/types/src/index.ts",
  "packages/data-ingest/src/index.ts",
  "packages/intelligence/src/index.ts",
  "packages/template-engine/src/index.ts",
  "packages/render-pptx/src/index.ts",
  "packages/render-pdf/src/index.ts",
  "packages/render-charts/src/index.ts",
  "packages/workflows/src/index.ts",
  "supabase/config.toml",
  "supabase/README.md",
  "supabase/migrations/20260314160000_initial_basquio_schema.sql",
  "scripts/run-demo-generation.ts",
];

const contentChecks: Array<{ file: string; needles: string[] }> = [
  {
    file: "docs/architecture.md",
    needles: ["Inngest", "QStash", "Browserless", "ECharts", "SlideSpec"],
  },
  {
    file: "docs/stack-practices.md",
    needles: ["Supabase", "Inngest", "Browserless", "ECharts", "SheetJS", "PptxGenJS", "pptx-automizer"],
  },
  {
    file: "docs/brand-system.md",
    needles: ["basquio.com", "Satoshi", "Amber", "Ultramarine", "apps/web/public/brand"],
  },
  {
    file: "docs/design-synthesis.md",
    needles: ["CostFigure", "Inngest", "editorial", "technical", "Basquio"],
  },
  {
    file: "memory/canonical-memory.md",
    needles: ["intelligence-first", ".pptx", ".pdf", "Supabase"],
  },
  {
    file: "rules/canonical-rules.md",
    needles: ["ChartSpec", "SlideSpec[]", "pnpm qa:basquio"],
  },
  {
    file: "CODEX_RULES.md",
    needles: ["decision-log", "contracts.ts", "qa:basquio"],
  },
  {
    file: "packages/render-pdf/src/index.ts",
    needles: ["Browserless", "pdf-lib", "renderPdfArtifact"],
  },
  {
    file: "packages/render-pptx/src/index.ts",
    needles: ["PptxGenJS", "pptx-automizer", "renderPptxArtifact"],
  },
  {
    file: "packages/workflows/src/index.ts",
    needles: ["parse input", "render pptx", "store artifacts"],
  },
  {
    file: "supabase/migrations/20260314160000_initial_basquio_schema.sql",
    needles: [
      "organizations",
      "projects",
      "source_files",
      "datasets",
      "template_profiles",
      "generation_jobs",
      "generation_job_steps",
      "artifacts",
    ],
  },
];

async function assertExists(relativeFile: string) {
  await access(path.join(root, relativeFile));
}

async function assertContent(file: string, needles: string[]) {
  const fullPath = path.join(root, file);
  const contents = await readFile(fullPath, "utf8");

  for (const needle of needles) {
    if (!contents.includes(needle)) {
      throw new Error(`${file} is missing required text: ${needle}`);
    }
  }
}

async function assertContractsLoad() {
  const contractsPath = pathToFileURL(path.join(root, "code/contracts.ts")).href;
  const contractsModule = await import(contractsPath);
  const requiredExports = [
    "datasetProfileSchema",
    "insightSpecSchema",
    "storySpecSchema",
    "chartSpecSchema",
    "slideSpecSchema",
    "templateProfileSchema",
  ];

  for (const exportName of requiredExports) {
    if (!(exportName in contractsModule)) {
      throw new Error(`Missing contract export: ${exportName}`);
    }
  }
}

async function assertWorkspaceScripts() {
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const requiredScripts = ["dev", "typecheck", "lint", "qa:basquio", "workflow:dev", "demo:generate"];

  for (const scriptName of requiredScripts) {
    if (!packageJson.scripts?.[scriptName]) {
      throw new Error(`Missing root script: ${scriptName}`);
    }
  }
}

async function main() {
  for (const file of requiredFiles) {
    await assertExists(file);
  }

  for (const check of contentChecks) {
    await assertContent(check.file, check.needles);
  }

  await assertContractsLoad();
  await assertWorkspaceScripts();

  console.log("Basquio context QA passed.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Basquio context QA failed: ${message}`);
  process.exit(1);
});
