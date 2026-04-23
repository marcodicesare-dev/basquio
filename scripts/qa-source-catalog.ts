import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/**
 * Catalog sanity-check gate. Runs against the linked Basquio remote
 * every time a seed-touching migration lands. Per Marco's Adjustment 1
 * instruction (2026-04-23): always apply migrations via supabase db
 * push then sanity-check row counts before committing downstream work.
 *
 * Invoked via `pnpm qa:catalog`.
 *
 * Exits 0 on PASS, 1 on any unexpected state. The assertions are
 * deliberately loose so they do not fail after expected catalog growth
 * (new sources added by Rossella, Veronica, Francesco), but they catch
 * drift: a missing ensure_private_workspace RPC, a knowledge_documents
 * table without the kind column, an empty source_catalog, or a team
 * workspace that lost its seed row.
 */

const TEAM_WORKSPACE_ID = "15cc947e-70cb-455a-b0df-d8c34b760d71";

function loadEnv(): { url: string; key: string } {
  const envPath = "apps/web/.env.local";
  let text: string;
  try {
    text = readFileSync(envPath, "utf-8");
  } catch {
    throw new Error(`qa:catalog requires ${envPath} to exist with SUPABASE_SERVICE_ROLE_KEY`);
  }
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("qa:catalog: NEXT_PUBLIC_SUPABASE_URL missing from apps/web/.env.local");
  if (!key) throw new Error("qa:catalog: SUPABASE_SERVICE_ROLE_KEY missing from apps/web/.env.local");
  return { url, key };
}

async function main() {
  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false } });
  const failures: string[] = [];

  // Assertion 1: ensure_private_workspace RPC exists and is reachable.
  const rpcResult = await db.rpc("ensure_private_workspace", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_user_email: null,
  });
  if (rpcResult.error) {
    if (!/foreign key|violates|row-level|p_user_id/i.test(rpcResult.error.message)) {
      failures.push(
        `ensure_private_workspace RPC not reachable: ${rpcResult.error.message}`,
      );
    }
  }

  // Assertion 2: source_catalog has at least the Day 1 + Francesco seed rows
  // for the team workspace.
  const catalogResult = await db
    .from("source_catalog")
    .select("status, trust_score, host, metadata")
    .eq("workspace_id", TEAM_WORKSPACE_ID);
  if (catalogResult.error) {
    failures.push(`source_catalog query failed: ${catalogResult.error.message}`);
  }
  const catalogRows = catalogResult.data ?? [];
  const active = catalogRows.filter((r) => r.status === "active");
  const paused = catalogRows.filter((r) => r.status === "paused");
  const counts = {
    total: catalogRows.length,
    active: active.length,
    paused: paused.length,
  };
  if (counts.total < 30) {
    failures.push(`expected >= 30 catalog rows, got ${counts.total}`);
  }
  if (counts.active < 15) {
    failures.push(`expected >= 15 active rows, got ${counts.active}`);
  }

  // Assertion 3: mark-up.it at trust 90 (post-Francesco bump).
  const markup = catalogRows.find((r) => r.host === "mark-up.it");
  if (!markup) {
    failures.push("mark-up.it missing from catalog");
  } else if (markup.trust_score !== 90) {
    failures.push(`mark-up.it trust_score expected 90, got ${markup.trust_score}`);
  }

  // Assertion 4: knowledge_documents.kind column exists and backfill
  // populated every row. A NULL here would mean the Day 1 migration
  // either did not apply or the NOT NULL default failed.
  const kdResult = await db
    .from("knowledge_documents")
    .select("kind", { count: "exact" });
  if (kdResult.error) {
    failures.push(`knowledge_documents.kind check failed: ${kdResult.error.message}`);
  } else {
    const nullKind = (kdResult.data ?? []).filter((r) => r.kind === null);
    if (nullKind.length > 0) {
      failures.push(`knowledge_documents has ${nullKind.length} rows with NULL kind`);
    }
  }

  // Assertion 5: provenance columns selectable. We do not require any
  // row to carry non-null values yet; Day 4 fetcher is the first writer.
  const provResult = await db
    .from("knowledge_documents")
    .select("source_catalog_id, source_url, source_published_at, source_trust_score")
    .limit(1);
  if (provResult.error) {
    failures.push(`knowledge_documents provenance columns check failed: ${provResult.error.message}`);
  }

  // Assertion 6: research_runs and source_catalog_scrapes tables exist.
  const rrResult = await db
    .from("research_runs")
    .select("id", { count: "exact", head: true });
  if (rrResult.error) {
    failures.push(`research_runs table check failed: ${rrResult.error.message}`);
  }
  const scResult = await db
    .from("source_catalog_scrapes")
    .select("id", { count: "exact", head: true });
  if (scResult.error) {
    failures.push(`source_catalog_scrapes table check failed: ${scResult.error.message}`);
  }

  // Report.
  console.log("source_catalog: active=" + counts.active + " paused=" + counts.paused + " total=" + counts.total);
  console.log("mark-up.it: trust=" + (markup?.trust_score ?? "missing"));
  console.log("knowledge_documents: " + (kdResult.count ?? 0) + " rows");
  console.log("research_runs: " + (rrResult.count ?? 0) + " rows");
  console.log("source_catalog_scrapes: " + (scResult.count ?? 0) + " rows");

  if (failures.length > 0) {
    console.error("\nqa:catalog FAIL");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nqa:catalog PASS");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
