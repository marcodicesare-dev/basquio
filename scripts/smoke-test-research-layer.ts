import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

import { runResearchPhase } from "../packages/workflows/src/research-phase";

/**
 * Live smoke-test harness for the research layer (Day 4 production-network
 * gate). Drives the full research phase against real Firecrawl + optional
 * Fiber with a real Basquio workspace, real brief, real catalog.
 *
 * NOT invoked from CI. Marco runs this once per Day 4 verification pass
 * with his Lumina or Loamly brief. Output lands in
 * docs/2026-04-23-day4-smoke-test.md for eyeball review before Week 1
 * finisher is green-lit.
 *
 * Usage:
 *   pnpm tsx scripts/smoke-test-research-layer.ts \
 *     --brief "hotel advanced AI market opportunity in EMEA Q2 2026" \
 *     --keywords "hotel,advanced AI,market opportunity,EMEA,Q2 2026" \
 *     --workspace 15cc947e-70cb-455a-b0df-d8c34b760d71 \
 *     --contact marco@lumina.com \
 *     --out docs/2026-04-23-day4-smoke-test.md
 *
 * Environment requirements:
 *   FIRECRAWL_API_KEY   required for trade-press scrapes
 *   FIBER_API_KEY       required for the optional Fiber contact lookup
 *   ANTHROPIC_API_KEY   required for the Haiku planner call
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read from
 *     apps/web/.env.local automatically)
 *
 * Safety:
 *   - Uses DAY_4_SMOKE_BUDGET (15 URLs, $0.50 total). Budget trips
 *     halt the phase with partial results.
 *   - research_runs row is persisted so any failure is auditable.
 *   - No pipeline kickoff; this is the research phase standalone.
 */

type Args = {
  brief: string;
  keywords: string[];
  workspace: string;
  contact: string | null;
  out: string;
};

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    }
  }
  if (!flags.brief) throw new Error("--brief is required");
  if (!flags.keywords) throw new Error("--keywords is required (comma-separated)");
  if (!flags.workspace) throw new Error("--workspace is required (UUID)");
  return {
    brief: flags.brief,
    keywords: flags.keywords.split(",").map((s) => s.trim()).filter(Boolean),
    workspace: flags.workspace,
    contact: flags.contact ?? null,
    out: flags.out ?? "docs/2026-04-23-day4-smoke-test.md",
  };
}

function loadEnv(): Record<string, string> {
  const envText = readFileSync("apps/web/.env.local", "utf-8");
  const env: Record<string, string> = {};
  for (const line of envText.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  for (const key of ["FIRECRAWL_API_KEY", "FIBER_API_KEY", "FIBER_BASE_URL", "ANTHROPIC_API_KEY"] as const) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

async function runFiberContactCheck(apiKey: string, email: string) {
  const { createFiberClient } = await import("../packages/research/src/fiber-client");
  const client = createFiberClient({ apiKey });
  try {
    const result = await client.lookupByEmail(email);
    return {
      ok: true,
      profile: result.profile
        ? {
            full_name: result.profile.full_name ?? null,
            headline: result.profile.headline ?? null,
            current_company: result.profile.current_company ?? null,
            current_title: result.profile.current_title ?? null,
            linkedin_url: result.profile.linkedin_url ?? null,
          }
        : null,
      chargeInfo: result.chargeInfo,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase credentials in apps/web/.env.local");
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for the Haiku planner call");
  }
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? null;
  const fiberKey = env.FIBER_API_KEY ?? null;

  console.log("=== Research layer smoke test ===");
  console.log("brief:", args.brief);
  console.log("keywords:", args.keywords.join(", "));
  console.log("workspace:", args.workspace);
  console.log("contact:", args.contact ?? "(none)");
  console.log("firecrawl:", firecrawlKey ? "configured" : "MISSING");
  console.log("fiber:", fiberKey ? "configured" : "MISSING");
  console.log();

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const fakeDeckRunId = randomUUID();
  const startedAt = Date.now();

  const result = await runResearchPhase(
    {
      workspaceId: args.workspace,
      deckRunId: fakeDeckRunId,
      conversationId: null,
      briefSummary: args.brief,
      briefKeywords: args.keywords,
      workspaceContextPack: null,
      callHaiku: async ({ system, user, signal }) => {
        const response = await anthropic.messages.create(
          {
            model: "claude-haiku-4-5",
            max_tokens: 4096,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: signal ?? undefined },
        );
        return response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
      },
      graphQuery: async () => ({ hits: [] }),
    },
    {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      firecrawlApiKey: firecrawlKey,
      fiberApiKey: fiberKey,
    },
  );

  const elapsedMs = Date.now() - startedAt;

  const fiberContactCheck =
    args.contact && fiberKey ? await runFiberContactCheck(fiberKey, args.contact) : null;

  // Post-run: read the scraped rows and knowledge_documents so the
  // output doc reflects actual persisted state, not just the
  // fetcher's in-memory stats.
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: scrapeRows } = await db
    .from("source_catalog_scrapes")
    .select("url, url_hash, content_hash, title, fetcher_endpoint, fetched_at")
    .eq("workspace_id", args.workspace)
    .order("fetched_at", { ascending: false })
    .limit(25);
  const { data: kdRows } = await db
    .from("knowledge_documents")
    .select("id, kind, filename, source_url, source_trust_score")
    .eq("workspace_id", args.workspace)
    .eq("kind", "scraped_article")
    .order("created_at", { ascending: false })
    .limit(25);

  const md: string[] = [];
  md.push("# Day 4 smoke-test output");
  md.push("");
  md.push(`**Run timestamp:** ${new Date().toISOString()}`);
  md.push(`**Brief:** ${args.brief}`);
  md.push(`**Keywords:** ${args.keywords.join(", ")}`);
  md.push(`**Workspace:** ${args.workspace}`);
  md.push(`**Elapsed:** ${(elapsedMs / 1000).toFixed(1)} s`);
  md.push("");
  md.push("## Research phase result");
  md.push("");
  md.push(`- research_run id: \`${result.researchRunId}\``);
  md.push(`- degraded: ${result.degraded} ${result.degradedReason ? `(${result.degradedReason})` : ""}`);
  md.push(`- graph_coverage_score: ${result.plan.graph_coverage_score}`);
  md.push(`- queries generated: ${result.plan.queries.length}`);
  md.push(`- existingGraphRefs: ${result.plan.existingGraphRefs.length}`);
  md.push(`- final evidence refs: ${result.evidenceRefs.length}`);
  md.push("");
  md.push("## Fetcher stats");
  md.push("");
  md.push(`- queries attempted: ${result.stats.queriesAttempted}`);
  md.push(`- queries completed: ${result.stats.queriesCompleted}`);
  md.push(`- queries failed: ${result.stats.queriesFailed}`);
  md.push(`- scrapes attempted: ${result.stats.scrapesAttempted}`);
  md.push(`- scrapes cache-hit: ${result.stats.scrapesCacheHit}`);
  md.push(`- scrapes succeeded: ${result.stats.scrapesSucceeded}`);
  md.push(`- scrapes failed: ${result.stats.scrapesFailed}`);
  md.push(`- urls fetched: ${result.stats.urlsFetched}`);
  md.push(`- firecrawl USD: $${result.stats.firecrawlUsd.toFixed(4)}`);
  md.push(`- fiber USD: $${result.stats.fiberUsd.toFixed(4)}`);
  md.push(`- budget exceeded: ${result.stats.budgetExceeded}`);
  md.push("");
  md.push("## Planner queries");
  md.push("");
  if (result.plan.queries.length === 0) {
    md.push("_(none generated; graph coverage or degradation)_");
  } else {
    for (const q of result.plan.queries) {
      md.push(`- **${q.id}** \`${q.text}\` intent=${q.intent} gap=${q.gap_reason} tiers=${q.tier_mask.join(",")} lang=${q.language}`);
    }
  }
  md.push("");
  md.push("## Persisted scrape rows (top 25 newest)");
  md.push("");
  if (!scrapeRows || scrapeRows.length === 0) {
    md.push("_(none)_");
  } else {
    for (const row of scrapeRows) {
      md.push(`- [${row.title ?? "(no title)"}](${row.url}) hash=\`${row.url_hash.slice(0, 12)}\` endpoint=${row.fetcher_endpoint} fetched_at=${row.fetched_at}`);
    }
  }
  md.push("");
  md.push("## Persisted knowledge_documents (kind=scraped_article, top 25)");
  md.push("");
  if (!kdRows || kdRows.length === 0) {
    md.push("_(none)_");
  } else {
    for (const row of kdRows) {
      md.push(`- \`${row.id}\` filename=${row.filename} source=${row.source_url} trust=${row.source_trust_score}`);
    }
  }
  md.push("");
  md.push("## Evidence refs dump (first 10)");
  md.push("");
  for (const ref of result.evidenceRefs.slice(0, 10)) {
    md.push(`- id=\`${ref.id}\` source=${ref.sourceLocation} confidence=${ref.confidence.toFixed(2)}`);
    md.push(`  summary: ${ref.summary.slice(0, 160)}`);
  }
  md.push("");
  if (fiberContactCheck) {
    md.push("## Fiber contact lookup (smoke check)");
    md.push("");
    if (fiberContactCheck.ok) {
      md.push(`- email: \`${args.contact}\``);
      if (fiberContactCheck.profile) {
        md.push(`- name: ${fiberContactCheck.profile.full_name}`);
        md.push(`- headline: ${fiberContactCheck.profile.headline}`);
        md.push(`- company: ${fiberContactCheck.profile.current_company}`);
        md.push(`- title: ${fiberContactCheck.profile.current_title}`);
        md.push(`- linkedin: ${fiberContactCheck.profile.linkedin_url}`);
        md.push(
          `- charge: credits_used=${fiberContactCheck.chargeInfo?.credits_used ?? "?"} remaining=${fiberContactCheck.chargeInfo?.credits_remaining ?? "?"}`,
        );
      } else {
        md.push("- profile not found in Fiber's index");
      }
    } else {
      md.push(`- lookup FAILED: ${fiberContactCheck.error}`);
    }
    md.push("");
  }

  const output = md.join("\n");
  writeFileSync(args.out, output, "utf-8");
  console.log(`\nSmoke test output written to: ${args.out}`);
  console.log(`Refs count: ${result.evidenceRefs.length}`);
  console.log(`Scrapes succeeded: ${result.stats.scrapesSucceeded}`);
  console.log(`Cost: $${(result.stats.firecrawlUsd + result.stats.fiberUsd).toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
