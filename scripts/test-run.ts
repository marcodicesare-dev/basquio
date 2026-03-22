import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import pdfParse from "pdf-parse";

import { renderChartSvg, rasterizeSvgToPng } from "@basquio/render-charts";
import { runGenerationRequest } from "@basquio/workflows";

type FixtureSource = {
  fileName: string;
  mediaType: string;
  kind: "workbook" | "document" | "pptx" | "pdf" | "image" | "brand-tokens" | "unknown";
  base64: string;
};

type CliArgs = {
  fixtureDir?: string;
  runId?: string;
};

type ArtifactEntry = {
  kind: string;
  fileName: string;
  mimeType: string;
  fileBytes: number;
  storagePath: string;
  storageBucket?: string;
  checksumSha256?: string;
};

type V2ManifestRow = {
  slide_count: number;
  page_count: number;
  qa_passed: boolean;
  qa_report?: Record<string, unknown> | null;
  artifacts: ArtifactEntry[];
};

type CostTelemetry = {
  estimatedCostUsd?: number;
  durationMs?: number;
  stepBreakdown?: Array<Record<string, unknown>>;
};

type ChartRow = {
  id: string;
  chart_type: string;
  title?: string;
  thumbnail_url?: string | null;
};

function usageAndExit(): never {
  console.error("Usage: pnpm test:run <fixture-dir> | pnpm test:run --run-id <uuid>");
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0) usageAndExit();
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--run-id") {
      const next = argv[index + 1];
      if (!next) usageAndExit();
      args.runId = next;
      index += 1;
      continue;
    }
    if (!args.fixtureDir) {
      args.fixtureDir = current;
      continue;
    }
  }
  if (!args.fixtureDir && !args.runId) usageAndExit();
  return args;
}

function deterministicId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

function guessMediaType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function guessKind(fileName: string): FixtureSource["kind"] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "workbook";
  if (lower.endsWith(".pptx")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".json") || lower.endsWith(".css")) return "brand-tokens";
  return "unknown";
}

function getSupabaseCredentials(): { url: string; serviceKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function assertCredentials(): { url: string; serviceKey: string } {
  const credentials = getSupabaseCredentials();
  if (!credentials) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for persisted v2 run inspection.");
  }
  return credentials;
}

async function countPptxSlides(buffer: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
}

function parseStorageRef(ref: string): { bucket: string; path: string } {
  if (ref.startsWith("storage://")) {
    const withoutScheme = ref.slice("storage://".length);
    const slashIndex = withoutScheme.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid storage ref: ${ref}`);
    }
    return {
      bucket: withoutScheme.slice(0, slashIndex),
      path: withoutScheme.slice(slashIndex + 1),
    };
  }
  return { bucket: "artifacts", path: ref };
}

async function downloadStorageObject(bucket: string, storagePath: string): Promise<Buffer | null> {
  const credentials = getSupabaseCredentials();
  if (!credentials) {
    return null;
  }
  const url = new URL(`/storage/v1/object/${bucket}/${storagePath}`, credentials.url);
  const response = await fetch(url, {
    headers: {
      apikey: credentials.serviceKey,
      Authorization: `Bearer ${credentials.serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${bucket}/${storagePath}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function resolveArtifactBuffer(storagePath: string, storageBucket = "artifacts"): Promise<Buffer | null> {
  const absolutePath = path.isAbsolute(storagePath) ? storagePath : path.resolve(process.cwd(), storagePath);
  try {
    return await readFile(absolutePath);
  } catch {
    return downloadStorageObject(storageBucket, storagePath);
  }
}

async function fetchRestRows<T>(table: string, query: string): Promise<T[]> {
  const { url, serviceKey } = assertCredentials();
  const response = await fetch(
    new URL(`/rest/v1/${table}?${query}`, url),
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch ${table}: ${response.status} ${response.statusText}`);
  }
  return await response.json() as T[];
}

async function loadV2CostTelemetry(runId: string): Promise<CostTelemetry | null> {
  const rows = await fetchRestRows<{ cost_telemetry?: CostTelemetry | null }>(
    "deck_runs",
    `id=eq.${runId}&select=cost_telemetry&limit=1`,
  ).catch(() => []);
  return rows[0]?.cost_telemetry ?? null;
}

async function loadV2Manifest(runId: string): Promise<V2ManifestRow | null> {
  const rows = await fetchRestRows<V2ManifestRow>(
    "artifact_manifests_v2",
    `run_id=eq.${runId}&select=slide_count,page_count,qa_passed,qa_report,artifacts&limit=1`,
  ).catch(() => []);
  return rows[0] ?? null;
}

async function loadWorkingPaper(runId: string, paperType: string): Promise<Record<string, unknown> | null> {
  const rows = await fetchRestRows<{ content?: Record<string, unknown> | null }>(
    "working_papers",
    `run_id=eq.${runId}&paper_type=eq.${paperType}&select=content&order=version.desc&limit=1`,
  ).catch(() => []);
  return rows[0]?.content ?? null;
}

async function loadV2Charts(runId: string): Promise<ChartRow[]> {
  return fetchRestRows<ChartRow>(
    "deck_spec_v2_charts",
    `run_id=eq.${runId}&select=id,chart_type,title,thumbnail_url&order=created_at.asc&limit=200`,
  ).catch(() => []);
}

async function loadFixtureSources(fixtureDir: string): Promise<{
  brief: string;
  sourceFiles: FixtureSource[];
  styleFile?: FixtureSource;
}> {
  const entries = await readdir(fixtureDir, { withFileTypes: true });
  const briefEntry = entries.find((entry) => entry.isFile() && entry.name === "brief.txt");
  if (!briefEntry) {
    throw new Error(`Fixture ${fixtureDir} is missing brief.txt`);
  }

  const brief = await readFile(path.join(fixtureDir, briefEntry.name), "utf8");
  const sourceFiles: FixtureSource[] = [];
  let styleFile: FixtureSource | undefined;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "brief.txt") continue;
    const absolutePath = path.join(fixtureDir, entry.name);
    const buffer = await readFile(absolutePath);
    const source = {
      fileName: entry.name,
      mediaType: guessMediaType(entry.name),
      kind: guessKind(entry.name),
      base64: buffer.toString("base64"),
    } satisfies FixtureSource;

    if (entry.name === "template.pptx" || source.kind === "brand-tokens") {
      styleFile = source;
    } else {
      sourceFiles.push(source);
    }
  }

  if (sourceFiles.length === 0) {
    throw new Error(`Fixture ${fixtureDir} has no source workbook files.`);
  }

  return { brief, sourceFiles, styleFile };
}

function formatCostLine(costTelemetry: CostTelemetry | null): string {
  if (!costTelemetry || typeof costTelemetry.estimatedCostUsd !== "number") {
    return "Cost: unavailable in direct local mode";
  }
  const breakdown = Array.isArray(costTelemetry.stepBreakdown)
    ? costTelemetry.stepBreakdown
        .map((entry) => {
          const step = typeof entry.step === "string" ? entry.step : "unknown";
          const costUsd = typeof entry.costUsd === "number" ? entry.costUsd : 0;
          return `${step}: $${costUsd.toFixed(2)}`;
        })
        .join(", ")
    : "";
  return breakdown.length > 0
    ? `Cost: $${costTelemetry.estimatedCostUsd.toFixed(2)} (${breakdown})`
    : `Cost: $${costTelemetry.estimatedCostUsd.toFixed(2)}`;
}

async function writePersistedRunOutputs(runId: string, outputDir: string, chartsDir: string) {
  const manifestRow = await loadV2Manifest(runId);
  if (!manifestRow) {
    throw new Error(`No artifact_manifests_v2 row found for run ${runId}`);
  }

  const costTelemetry = await loadV2CostTelemetry(runId);
  const charts = await loadV2Charts(runId);
  const plan = await loadWorkingPaper(runId, "v1_deck_plan") ?? await loadWorkingPaper(runId, "deck_plan");
  const analysis = await loadWorkingPaper(runId, "analysis_result");

  let pptxBuffer = Buffer.alloc(0);
  let pdfBuffer = Buffer.alloc(0);
  for (const artifact of manifestRow.artifacts ?? []) {
    const buffer = await resolveArtifactBuffer(artifact.storagePath, artifact.storageBucket ?? "artifacts");
    if (!buffer) continue;
    if (artifact.kind === "pptx") {
      pptxBuffer = Buffer.from(buffer);
      await writeFile(path.join(outputDir, "deck.pptx"), buffer);
    }
    if (artifact.kind === "pdf") {
      pdfBuffer = Buffer.from(buffer);
      await writeFile(path.join(outputDir, "deck.pdf"), buffer);
    }
  }

  let chartPngCount = 0;
  for (const chart of charts) {
    if (!chart.thumbnail_url) continue;
    try {
      const { bucket, path: storagePath } = parseStorageRef(chart.thumbnail_url);
      const png = await downloadStorageObject(bucket, storagePath);
      if (!png) continue;
      await writeFile(path.join(chartsDir, `${chart.id}.png`), png);
      chartPngCount += 1;
    } catch {
      // Keep the manifest accurate but do not fail the whole harness.
    }
  }

  if (plan) {
    await writeFile(path.join(outputDir, "plan.json"), JSON.stringify(plan, null, 2));
  }
  if (analysis) {
    await writeFile(path.join(outputDir, "analysis.json"), JSON.stringify(analysis, null, 2));
  }

  const pptxSlideCount = pptxBuffer.length > 0 ? await countPptxSlides(pptxBuffer) : 0;
  const pdfPageCount = pdfBuffer.length > 0 ? ((await pdfParse(pdfBuffer)).numpages ?? 0) : 0;
  const qaReport = manifestRow.qa_report ?? {};
  const checks = Array.isArray(qaReport.checks) ? qaReport.checks : [];

  const manifest = {
    fixture: null,
    runId,
    slideCount: manifestRow.slide_count ?? 0,
    chartCount: charts.length,
    chartTypes: charts.map((chart) => chart.chart_type),
    chartImages: {
      rendered: chartPngCount,
      failed: Math.max(0, charts.length - chartPngCount),
    },
    qa: {
      passed: manifestRow.qa_passed ?? false,
      tier: typeof qaReport.tier === "string" ? qaReport.tier : null,
      checks,
      report: qaReport,
    },
    artifacts: {
      pptxSlides: pptxSlideCount,
      pdfPages: pdfPageCount,
      parity: pptxSlideCount > 0 && pptxSlideCount === pdfPageCount,
    },
    cost: {
      available: Boolean(costTelemetry),
      estimatedCostUsd: typeof costTelemetry?.estimatedCostUsd === "number" ? costTelemetry.estimatedCostUsd : null,
      stepBreakdown: Array.isArray(costTelemetry?.stepBreakdown) ? costTelemetry.stepBreakdown : [],
    },
    durationMs: typeof costTelemetry?.durationMs === "number" ? costTelemetry.durationMs : null,
  };

  await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    slideCount: manifest.slideCount,
    chartCount: manifest.chartCount,
    chartPngCount,
    chartFailures: manifest.chartImages.failed,
    pptxSlideCount,
    pdfPageCount,
    qaPassed: manifest.qa.passed,
    qaTier: manifest.qa.tier,
    qaCheckCount: checks.length,
    costTelemetry,
    durationMs: manifest.durationMs,
  };
}

async function runFixtureHarness(fixtureDir: string, outputDir: string, chartsDir: string) {
  const fixtureSlug = path.basename(fixtureDir);
  const { brief, sourceFiles, styleFile } = await loadFixtureSources(fixtureDir);
  const requestId = `test-${fixtureSlug}-${deterministicId(fixtureDir)}`;
  const startedAt = Date.now();

  const summary = await runGenerationRequest({
    jobId: requestId,
    organizationId: "basquio-test",
    projectId: fixtureSlug,
    sourceFiles,
    ...(styleFile ? { styleFile } : {}),
    brief: {
      businessContext: brief,
      client: fixtureSlug,
      audience: "Executive team",
      objective: "Generate a local end-to-end verification deck",
      thesis: brief.split("\n")[0] ?? brief.slice(0, 120),
      stakes: "Used for local pipeline verification",
    },
    businessContext: brief,
    client: fixtureSlug,
    audience: "Executive team",
    objective: "Generate a local end-to-end verification deck",
    thesis: brief.split("\n")[0] ?? brief.slice(0, 120),
    stakes: "Used for local pipeline verification",
  });

  let pptxBuffer = Buffer.alloc(0);
  let pdfBuffer = Buffer.alloc(0);

  for (const artifact of summary.artifacts) {
    if (!artifact.storagePath) continue;
    const buffer = await resolveArtifactBuffer(artifact.storagePath, "artifacts");
    if (!buffer) continue;
    if (artifact.kind === "pptx") {
      pptxBuffer = Buffer.from(buffer);
      await writeFile(path.join(outputDir, "deck.pptx"), buffer);
    }
    if (artifact.kind === "pdf") {
      pdfBuffer = Buffer.from(buffer);
      await writeFile(path.join(outputDir, "deck.pdf"), buffer);
    }
  }

  const localSummaryPath = path.resolve(process.cwd(), "output", requestId, "job-summary.json");
  try {
    await copyFile(localSummaryPath, path.join(outputDir, "job-summary.json"));
  } catch {}

  let chartPngCount = 0;
  let chartRenderFailures = 0;
  for (const chart of summary.slidePlan.charts) {
    try {
      const svg = renderChartSvg(chart, [], 1600, 900, {
        background: summary.templateProfile?.brandTokens?.palette?.background,
        surface: summary.templateProfile?.brandTokens?.palette?.surface,
        text: summary.templateProfile?.brandTokens?.palette?.text,
        accent: summary.templateProfile?.brandTokens?.palette?.accent,
        border: summary.templateProfile?.brandTokens?.palette?.border,
        headingFont: summary.templateProfile?.brandTokens?.typography?.headingFont,
        bodyFont: summary.templateProfile?.brandTokens?.typography?.bodyFont,
      });
      const png = await rasterizeSvgToPng({ svg, width: 1600, height: 900 });
      await writeFile(path.join(chartsDir, `${chart.id}.png`), png);
      chartPngCount += 1;
    } catch {
      chartRenderFailures += 1;
    }
  }

  const pptxSlideCount = pptxBuffer.length > 0 ? await countPptxSlides(pptxBuffer) : 0;
  const pdfPageCount = pdfBuffer.length > 0 ? ((await pdfParse(pdfBuffer)).numpages ?? 0) : 0;
  const costTelemetry = await loadV2CostTelemetry(requestId).catch(() => null);
  const stepBreakdown = Array.isArray(costTelemetry?.stepBreakdown) ? costTelemetry.stepBreakdown : [];

  const manifest = {
    fixture: fixtureSlug,
    runId: summary.jobId,
    slideCount: summary.slidePlan.slides.length,
    chartCount: summary.slidePlan.charts.length,
    chartTypes: summary.slidePlan.charts.map((chart) => chart.family),
    chartImages: {
      rendered: chartPngCount,
      failed: chartRenderFailures,
    },
    qa: {
      passed: summary.qualityReport?.status === "passed",
      tier: null,
      checks: summary.qualityReport?.checks ?? [],
    },
    artifacts: {
      pptxSlides: pptxSlideCount,
      pdfPages: pdfPageCount,
      parity: pptxSlideCount > 0 && pptxSlideCount === pdfPageCount,
    },
    cost: {
      available: Boolean(costTelemetry),
      estimatedCostUsd: typeof costTelemetry?.estimatedCostUsd === "number" ? costTelemetry.estimatedCostUsd : null,
      stepBreakdown,
      note: costTelemetry ? undefined : "Per-step v2 cost telemetry is only available for persisted v2 runs. Use --run-id to inspect one.",
    },
    durationMs: Date.now() - startedAt,
  };

  await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(outputDir, "plan.json"), JSON.stringify(summary.slidePlan, null, 2));
  await writeFile(path.join(outputDir, "analysis.json"), JSON.stringify({
    analyticsResult: summary.analyticsResult,
    insights: summary.insights,
    story: summary.story,
    reportOutline: summary.reportOutline,
    validationReport: summary.validationReport,
  }, null, 2));

  return {
    slideCount: manifest.slideCount,
    chartCount: manifest.chartCount,
    chartPngCount,
    chartFailures: chartRenderFailures,
    pptxSlideCount,
    pdfPageCount,
    qaPassed: manifest.qa.passed,
    qaTier: manifest.qa.tier,
    qaCheckCount: manifest.qa.checks.length,
    costTelemetry,
    durationMs: manifest.durationMs,
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const slug = cli.runId ? `run-${cli.runId.slice(0, 8)}` : path.basename(path.resolve(process.cwd(), cli.fixtureDir ?? ""));
  const outputDir = path.resolve(process.cwd(), "test-output", slug);
  const chartsDir = path.join(outputDir, "charts");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(chartsDir, { recursive: true });

  const startedAt = Date.now();
  const result = cli.runId
    ? await writePersistedRunOutputs(cli.runId, outputDir, chartsDir)
    : await runFixtureHarness(path.resolve(process.cwd(), cli.fixtureDir!), outputDir, chartsDir);

  const seconds = Math.round(((result.durationMs ?? (Date.now() - startedAt)) / 1000));
  console.log(
    `Slides: ${result.slideCount} | Charts: ${result.chartPngCount}/${result.chartCount} rendered (${result.chartFailures} failed)\n` +
    `Chart images: ${result.chartPngCount}/${result.chartCount} rendered as PNG (${result.chartFailures} unavailable)\n` +
    `Artifacts: PPTX ${result.pptxSlideCount} slides | PDF ${result.pdfPageCount} pages | Parity=${result.pptxSlideCount === result.pdfPageCount}\n` +
    `QA: passed=${result.qaPassed} | tier=${result.qaTier ?? "unknown"} | checks=${result.qaCheckCount}\n` +
    `${formatCostLine(result.costTelemetry)}\n` +
    `Time: ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`test-run failed: ${message}`);
  process.exit(1);
});
