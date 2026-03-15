import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
let root = "";

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
  "scripts/check-inngest.ts",
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
    file: "docs/vercel-env.md",
    needles: ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY", "INNGEST_SERVE_HOST", "basquio.com", "pnpm inngest:check"],
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
    needles: ["intake and profiling", "render pptx", "artifact qa and delivery"],
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
  const requiredOperationalScripts = ["inngest:check"];

  for (const scriptName of requiredScripts) {
    if (!packageJson.scripts?.[scriptName]) {
      throw new Error(`Missing root script: ${scriptName}`);
    }
  }

  for (const scriptName of requiredOperationalScripts) {
    if (!packageJson.scripts?.[scriptName]) {
      throw new Error(`Missing root script: ${scriptName}`);
    }
  }
}

function parseCreateTableColumns(sql: string, tableName: string) {
  const escapedTableName = tableName.replace(".", "\\.");
  const pattern = new RegExp(`create table if not exists ${escapedTableName} \\(([^;]+?)\\n\\);`, "is");
  const match = sql.match(pattern);

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("constraint"))
    .map((line) => line.replace(/,$/, "").split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function parseAlterTableAddedColumns(sql: string, tableName: string) {
  const escapedTableName = tableName.replace(".", "\\.");
  const pattern = new RegExp(`alter table ${escapedTableName}([\\s\\S]*?);`, "ig");
  const columns: string[] = [];

  for (const match of sql.matchAll(pattern)) {
    const statement = match[1] ?? "";

    for (const addColumnMatch of statement.matchAll(/add column if not exists\s+([a-zA-Z0-9_]+)/gi)) {
      if (addColumnMatch[1]) {
        columns.push(addColumnMatch[1]);
      }
    }
  }

  return columns;
}

function parseRestSelectCalls(contents: string) {
  const calls: Array<{ table: string; fields: string[] }> = [];
  const pattern = /table:\s*"([^"]+)"[\s\S]*?select:\s*"([^"]+)"/g;

  for (const match of contents.matchAll(pattern)) {
    const table = match[1]?.trim();
    const fields = match[2]
      ?.split(",")
      .map((field) => field.trim())
      .filter(Boolean);

    if (table && fields?.length) {
      calls.push({ table, fields });
    }
  }

  return calls;
}

async function assertRuntimeSchemaCompatibility() {
  const migrationsDir = path.join(root, "supabase", "migrations");
  const migrationEntries = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  const schemaSql = (
    await Promise.all(migrationEntries.map((entry) => readFile(path.join(migrationsDir, entry), "utf8")))
  ).join("\n\n");
  const tableSchemas = new Map<string, Set<string>>();
  const publicTables = [
    "organizations",
    "organization_memberships",
    "projects",
    "source_files",
    "datasets",
    "dataset_source_files",
    "template_profiles",
    "generation_jobs",
    "generation_job_steps",
    "artifacts",
  ];

  for (const table of publicTables) {
    tableSchemas.set(table, new Set([
      ...parseCreateTableColumns(schemaSql, `public.${table}`),
      ...parseAlterTableAddedColumns(schemaSql, `public.${table}`),
    ]));
  }

  const filesToScan = [
    "apps/web/src/lib/generation-requests.ts",
    "apps/web/src/lib/run-status.ts",
    "apps/web/src/lib/job-runs.ts",
    "apps/web/src/lib/viewer-workspace.ts",
    "apps/web/src/app/api/generate/route.ts",
    "apps/web/src/app/api/artifacts/[jobId]/[kind]/route.ts",
    "packages/workflows/src/persistence.ts",
    "packages/workflows/src/index.ts",
  ];

  for (const relativePath of filesToScan) {
    const contents = await readFile(path.join(root, relativePath), "utf8");

    for (const call of parseRestSelectCalls(contents)) {
      const columns = tableSchemas.get(call.table);
      if (!columns) {
        throw new Error(`${relativePath} selects from unsupported QA table: ${call.table}`);
      }

      for (const field of call.fields) {
        if (!columns.has(field)) {
          throw new Error(`${relativePath} selects missing ${call.table} column: ${field}`);
        }
      }
    }
  }
}

async function resolveWorkspaceRoot() {
  let current = cwd;

  for (;;) {
    try {
      await access(path.join(current, "docs", "vision.md"));
      await access(path.join(current, "package.json"));
      return current;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        throw new Error("Unable to resolve the Basquio workspace root for QA.");
      }

      current = parent;
    }
  }
}

async function main() {
  root = await resolveWorkspaceRoot();

  for (const file of requiredFiles) {
    await assertExists(file);
  }

  for (const check of contentChecks) {
    await assertContent(check.file, check.needles);
  }

  await assertContractsLoad();
  await assertWorkspaceScripts();
  await assertRuntimeSchemaCompatibility();

  console.log("Basquio context QA passed.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Basquio context QA failed: ${message}`);
  process.exit(1);
});
