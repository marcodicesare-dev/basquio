import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

import type { BrandGuideline } from "@/lib/workspace/types";

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const BRAND_GUIDELINE_SELECT =
  "id, workspace_id, brand_entity_id, brand, version, source_document_id, " +
  "typography, colour, tone, imagery, forbidden, language_preferences, " +
  "layout, logo, extraction_method, extraction_confidence, extracted_at, " +
  "approved_by, approved_at, superseded_by, metadata";

/**
 * Latest non-superseded brand_guideline row for (workspace, brand). Brief 3
 * brand-extraction populates this table; before it shipped, the table was
 * empty and this returned null gracefully.
 */
export async function getActiveBrandGuideline(
  workspaceId: string,
  brand: string,
): Promise<BrandGuideline | null> {
  const db = getDb();
  const { data, error } = await db
    .from("brand_guideline")
    .select(BRAND_GUIDELINE_SELECT)
    .eq("workspace_id", workspaceId)
    .ilike("brand", brand)
    .is("superseded_by", null)
    .order("extracted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`brand_guideline read failed: ${error.message}`);
  }
  return (data ?? null) as BrandGuideline | null;
}

export type BrandRuleType = "typography" | "colour" | "tone" | "imagery";
export type BrandSurface = "deck" | "memo" | "chart" | "all";

export type BrandRuleHit = {
  ruleType: BrandRuleType | "forbidden" | "logo" | "layout" | "language";
  brand: string;
  brandGuidelineId: string;
  version: string;
  sourcePage: number | null;
  payload: unknown;
};

export type SearchBrandRulesQuery = {
  brand?: string;
  ruleType?: BrandRuleType;
  surface?: BrandSurface;
};

/**
 * Flatten brand_guideline JSONB facets into individual BrandRuleHit rows
 * carrying source_page. Returns at most 50 hits across rule types, ordered
 * by rule_type stability (typography first, then colour, tone, imagery).
 *
 * The chat router's queryBrandRuleTool today returns the whole guideline
 * row to the model; this helper exists so Brief 5's Memory Inspector and
 * targeted retrieval paths can ask for "just the typography rules for
 * Lavazza on a deck" without reading the full pack.
 */
export async function searchBrandRules(
  workspaceId: string,
  query: SearchBrandRulesQuery = {},
): Promise<BrandRuleHit[]> {
  const db = getDb();
  let q = db
    .from("brand_guideline")
    .select(BRAND_GUIDELINE_SELECT)
    .eq("workspace_id", workspaceId)
    .is("superseded_by", null)
    .order("extracted_at", { ascending: false });
  if (query.brand) {
    q = q.ilike("brand", query.brand);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(`brand_guideline search failed: ${error.message}`);
  }
  const guidelines = (data ?? []) as unknown as BrandGuideline[];
  const hits: BrandRuleHit[] = [];
  const allow = (kind: BrandRuleType): boolean =>
    !query.ruleType || query.ruleType === kind;

  for (const g of guidelines) {
    if (allow("typography")) {
      for (const rule of asArray(g.typography)) {
        hits.push({
          ruleType: "typography",
          brand: g.brand,
          brandGuidelineId: g.id,
          version: g.version,
          sourcePage: extractSourcePage(rule),
          payload: rule,
        });
      }
    }
    if (allow("colour")) {
      for (const rule of asArray(g.colour)) {
        hits.push({
          ruleType: "colour",
          brand: g.brand,
          brandGuidelineId: g.id,
          version: g.version,
          sourcePage: extractSourcePage(rule),
          payload: rule,
        });
      }
    }
    if (allow("tone")) {
      for (const rule of asArray(g.tone)) {
        hits.push({
          ruleType: "tone",
          brand: g.brand,
          brandGuidelineId: g.id,
          version: g.version,
          sourcePage: extractSourcePage(rule),
          payload: rule,
        });
      }
    }
    if (allow("imagery")) {
      for (const rule of asArray(g.imagery)) {
        hits.push({
          ruleType: "imagery",
          brand: g.brand,
          brandGuidelineId: g.id,
          version: g.version,
          sourcePage: extractSourcePage(rule),
          payload: rule,
        });
      }
    }
  }

  // Surface filter is best-effort: rule payload may not declare a surface.
  // Today only typography rules carry a surface field, so the filter is a
  // light guard rather than a hard predicate.
  if (query.surface && query.surface !== "all") {
    return hits.filter((hit) => {
      if (hit.ruleType !== "typography") return true;
      const payload = hit.payload as { surface?: string } | null;
      const surface = payload?.surface?.toLowerCase();
      if (!surface) return true;
      return surface === query.surface || surface === query.surface?.toUpperCase();
    });
  }

  return hits.slice(0, 50);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

function extractSourcePage(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>).source_page;
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
    return Math.floor(candidate);
  }
  return null;
}
