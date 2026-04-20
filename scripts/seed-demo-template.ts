#!/usr/bin/env tsx
/**
 * Seeds the "Basquio Demo: Mulino Bianco" demo_template workspace.
 *
 * Run once per environment. Idempotent on (organization_id, slug): re-running
 * upserts the workspace and adds any missing scopes, entities, memory entries
 * without duplicating.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-demo-template.ts
 *   pnpm exec tsx scripts/seed-demo-template.ts --dry-run
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Cli = {
  dryRun: boolean;
};

function parseArgs(): Cli {
  return { dryRun: process.argv.includes("--dry-run") };
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000010";
const DEMO_SLUG = "basquio-demo-mulino-bianco";
const DEMO_NAME = "Basquio Demo: Mulino Bianco";

const SCOPES = [
  { kind: "client", name: "Mulino Bianco", slug: "mulino-bianco" },
  { kind: "client", name: "Barilla", slug: "barilla" },
  { kind: "category", name: "Biscotti", slug: "biscotti" },
  { kind: "category", name: "Snack Salati", slug: "snack-salati" },
  { kind: "function", name: "Category Management", slug: "category-management" },
  { kind: "system", name: "Workspace", slug: "workspace" },
  { kind: "system", name: "Analyst", slug: "analyst" },
];

const ENTITIES = [
  {
    type: "person",
    canonical: "Elena Bianchi",
    role: "Head of Category · Snack Salati",
    company: "Mulino Bianco",
    preferences: {
      free_text: "Prefers waterfall over bar charts for competitive decomposition. Italian first, English cross-market.",
      structured: {
        chart_preference: "waterfall over bar for competitive decomp",
        language: "Italian first, English for cross-market",
        tone: "direct, headline-first",
        deck_length: "8-12 slides for steerco",
      },
    },
    linkedScopeSlug: "mulino-bianco",
  },
  {
    type: "person",
    canonical: "Marco Rossi",
    role: "Brand Manager · Biscotti",
    company: "Mulino Bianco",
    preferences: {
      structured: {
        chart_preference: "single-metric cards + trend lines",
        language: "Italian",
        review_day: "Tuesday morning",
      },
    },
    linkedScopeSlug: "mulino-bianco",
  },
  {
    type: "brand",
    canonical: "Mulino Bianco",
    aliases: ["MB"],
  },
  {
    type: "brand",
    canonical: "Barilla",
  },
  {
    type: "category",
    canonical: "Snack Salati",
  },
  {
    type: "category",
    canonical: "Biscotti",
  },
  {
    type: "retailer",
    canonical: "Esselunga",
  },
  {
    type: "retailer",
    canonical: "Coop Italia",
    aliases: ["Coop"],
  },
];

const MEMORIES = [
  {
    scopeSlug: "mulino-bianco",
    memory_type: "procedural",
    content:
      "For Mulino Bianco decks: always lead the competitive slide with a waterfall chart. Never a bar chart. Elena Bianchi specifically dislikes bar charts for this view.",
    path: "/preferences/chart-style.md",
  },
  {
    scopeSlug: "mulino-bianco",
    memory_type: "semantic",
    content:
      "Mulino Bianco owns ~22% of the Italian biscotti market. Main competitor is Barilla's Pan di Stelle in certain SKUs, and private label in entry tiers.",
    path: "/facts/market-share.md",
  },
  {
    scopeSlug: "analyst",
    memory_type: "procedural",
    content:
      "Standard deliverable for category reviews: 10-slide deck, executive summary first, 3-to-5 insights with evidence, one clear next action. All charts must have a source note.",
    path: "/preferences/deliverable-format.md",
  },
  {
    scopeSlug: "workspace",
    memory_type: "procedural",
    content: "No em dashes in any output. No emojis. Plain language. Every number needs a citation.",
    path: "/preferences/house-style.md",
  },
];

async function upsertWorkspace(db: SupabaseClient, dryRun: boolean) {
  const { data: existing } = await db
    .from("workspaces")
    .select("id, metadata")
    .eq("organization_id", DEMO_ORG_ID)
    .eq("slug", DEMO_SLUG)
    .maybeSingle();
  if (existing) {
    console.log(`[workspace] exists id=${existing.id}`);
    return existing.id as string;
  }
  if (dryRun) {
    console.log("[workspace] would insert demo template");
    return "00000000-0000-0000-0000-000000000000";
  }
  const { data, error } = await db
    .from("workspaces")
    .insert({
      organization_id: DEMO_ORG_ID,
      name: DEMO_NAME,
      slug: DEMO_SLUG,
      kind: "demo_template",
      visibility: "shareable_with_token",
      metadata: {
        tagline: "Pre-populated CPG workspace for outreach demos.",
        seeded_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`workspace insert failed: ${error.message}`);
  console.log(`[workspace] created id=${data!.id}`);
  return data!.id as string;
}

async function upsertScopes(
  db: SupabaseClient,
  workspaceId: string,
  dryRun: boolean,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const s of SCOPES) {
    const { data: existing } = await db
      .from("workspace_scopes")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("kind", s.kind)
      .eq("slug", s.slug)
      .maybeSingle();
    if (existing) {
      result.set(s.slug, existing.id as string);
      continue;
    }
    if (dryRun) {
      console.log(`[scope] would insert ${s.kind}:${s.slug}`);
      continue;
    }
    const { data, error } = await db
      .from("workspace_scopes")
      .insert({
        workspace_id: workspaceId,
        kind: s.kind,
        name: s.name,
        slug: s.slug,
        metadata: { seeded: true },
      })
      .select("id")
      .single();
    if (error) throw new Error(`scope insert failed: ${error.message}`);
    result.set(s.slug, data!.id as string);
    console.log(`[scope] created ${s.kind}:${s.slug}`);
  }
  return result;
}

async function upsertEntities(
  db: SupabaseClient,
  workspaceId: string,
  scopeBySlug: Map<string, string>,
  dryRun: boolean,
) {
  for (const e of ENTITIES) {
    const normalized = normalize(e.canonical);
    const { data: existing } = await db
      .from("entities")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("type", e.type)
      .eq("normalized_name", normalized)
      .maybeSingle();
    if (existing) {
      continue;
    }
    if (dryRun) {
      console.log(`[entity] would insert ${e.type}:${e.canonical}`);
      continue;
    }
    const metadata: Record<string, unknown> = { seeded: true };
    if ("role" in e && e.role) metadata.role = e.role;
    if ("company" in e && e.company) metadata.company = e.company;
    if ("preferences" in e && e.preferences) metadata.preferences = e.preferences;
    if ("linkedScopeSlug" in e && e.linkedScopeSlug) {
      const scopeId = scopeBySlug.get(e.linkedScopeSlug);
      if (scopeId) metadata.linked_scope_id = scopeId;
    }
    const { error } = await db.from("entities").insert({
      workspace_id: workspaceId,
      organization_id: workspaceId,
      is_team_beta: false,
      type: e.type,
      canonical_name: e.canonical,
      normalized_name: normalized,
      aliases: ("aliases" in e && Array.isArray(e.aliases)) ? e.aliases : [],
      metadata,
    });
    if (error) throw new Error(`entity insert failed (${e.canonical}): ${error.message}`);
    console.log(`[entity] created ${e.type}:${e.canonical}`);
  }
}

async function upsertMemories(
  db: SupabaseClient,
  workspaceId: string,
  scopeBySlug: Map<string, string>,
  dryRun: boolean,
) {
  for (const m of MEMORIES) {
    const scopeId = scopeBySlug.get(m.scopeSlug);
    if (!scopeId) {
      console.warn(`[memory] skip. No scope for slug ${m.scopeSlug}`);
      continue;
    }
    const { data: existing } = await db
      .from("memory_entries")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("workspace_scope_id", scopeId)
      .eq("path", m.path)
      .maybeSingle();
    if (existing) continue;
    if (dryRun) {
      console.log(`[memory] would insert ${m.scopeSlug}${m.path}`);
      continue;
    }
    const { error } = await db.from("memory_entries").insert({
      workspace_id: workspaceId,
      organization_id: workspaceId,
      is_team_beta: false,
      workspace_scope_id: scopeId,
      scope: m.scopeSlug,
      memory_type: m.memory_type,
      path: m.path,
      content: m.content,
      metadata: { seeded: true },
    });
    if (error) throw new Error(`memory insert failed: ${error.message}`);
    console.log(`[memory] created ${m.scopeSlug}${m.path}`);
  }
}

async function main() {
  const cli = parseArgs();
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key);

  console.log(`Seeding demo template (dry-run=${cli.dryRun})`);
  const wsId = await upsertWorkspace(db, cli.dryRun);
  const scopes = await upsertScopes(db, wsId, cli.dryRun);
  await upsertEntities(db, wsId, scopes, cli.dryRun);
  await upsertMemories(db, wsId, scopes, cli.dryRun);
  console.log(
    `Done. workspace_id=${wsId}, scopes=${scopes.size}, entities=${ENTITIES.length}, memories=${MEMORIES.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
