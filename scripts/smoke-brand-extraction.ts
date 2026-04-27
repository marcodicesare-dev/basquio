/**
 * Memory v1 Brief 3 live extraction smoke (Phase 7b).
 *
 * Loads fixtures/brand-books/spotify.pdf, runs the BAML extract + validate
 * pipeline against the live Anthropic API, and asserts the acceptance gates
 * from spec §4. Persistence is skipped (the SECURITY DEFINER RPC is a thin
 * wrapper covered by unit tests; production persist is Phase 9).
 *
 * Usage:
 *   pnpm tsx scripts/smoke-brand-extraction.ts
 *
 * Acceptance gates:
 *   - typography count >= 8
 *   - colour count >= 12
 *   - tone count >= 5
 *   - imagery count >= 1 (light gate, the spec hints at imagery rules)
 *   - source_page on EVERY rule (zero null/zero pages)
 *   - validation confidence >= 0.85 on a clean extraction
 *   - extract+validate cost < $5
 *   - random-bytes input produces validation confidence < 0.7
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Collector } from "@boundaryml/baml";

import { b, SurfaceKind } from "../packages/workflows/baml_client";
import type { BrandGuidelineExtraction } from "../packages/workflows/baml_client";
import { parseDocument } from "../packages/workflows/src/workspace/parsing";
import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

const FIXTURE = resolve(process.cwd(), "fixtures/brand-books/spotify.pdf");

const SONNET_PRICE = { input: 3, output: 15, cachedRead: 0.3 };
const HAIKU_PRICE = { input: 1, output: 5, cachedRead: 0.1 };

function priceTokens(
  usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null },
  rates: { input: number; output: number; cachedRead: number },
): number {
  const inMt = (usage.inputTokens ?? 0) / 1_000_000;
  const outMt = (usage.outputTokens ?? 0) / 1_000_000;
  const cachedMt = (usage.cachedInputTokens ?? 0) / 1_000_000;
  return inMt * rates.input + outMt * rates.output + cachedMt * rates.cachedRead;
}

function countWithSourcePage(rules: Array<{ source_page?: number }>): { total: number; withPage: number } {
  let withPage = 0;
  for (const r of rules) {
    if (typeof r.source_page === "number" && r.source_page > 0) withPage += 1;
  }
  return { total: rules.length, withPage };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required.");
    process.exit(1);
  }

  console.log(`[smoke] reading ${FIXTURE}`);
  const buffer = await readFile(FIXTURE);
  const parsed = await parseDocument(buffer, "pdf", "application/pdf");
  const pageCount = parsed.pageCount ?? 0;
  const charCount = parsed.text.length;
  console.log(`[smoke] parsed pageCount=${pageCount} charCount=${charCount}`);
  if (charCount < 500) {
    console.error("[smoke] PDF parsed to under 500 chars; the fixture is malformed.");
    process.exit(1);
  }

  // ─── Phase 1+2 on the real fixture ────────────────────────────────
  console.log("[smoke] running ExtractBrandGuideline (Sonnet 4.6) ...");
  const extractCollector = new Collector("smoke-extract");
  const t0 = Date.now();
  const extraction: BrandGuidelineExtraction = await b.ExtractBrandGuideline(
    parsed.text,
    pageCount || 21,
    { collector: extractCollector },
  );
  const t1 = Date.now();
  console.log(`[smoke] extract done in ${(t1 - t0) / 1000}s, brand=${extraction.brand} version=${extraction.version}`);

  console.log("[smoke] running ValidateBrandGuideline (Haiku 4.5) ...");
  const validateCollector = new Collector("smoke-validate");
  const t2 = Date.now();
  const validation = await b.ValidateBrandGuideline(extraction, { collector: validateCollector });
  const t3 = Date.now();
  console.log(`[smoke] validate done in ${(t3 - t2) / 1000}s, confidence=${validation.confidence.toFixed(3)}`);
  if (validation.issues.length > 0) {
    console.log("[smoke] validation issues:");
    for (const issue of validation.issues) console.log(`  - ${issue}`);
  }

  const extractCost = priceTokens(extractCollector.usage, SONNET_PRICE);
  const validateCost = priceTokens(validateCollector.usage, HAIKU_PRICE);
  const cost = extractCost + validateCost;

  console.log("[smoke] cost breakdown:");
  console.log(
    `  extract  in=${extractCollector.usage.inputTokens} out=${extractCollector.usage.outputTokens} cachedIn=${extractCollector.usage.cachedInputTokens} cost=$${extractCost.toFixed(4)}`,
  );
  console.log(
    `  validate in=${validateCollector.usage.inputTokens} out=${validateCollector.usage.outputTokens} cachedIn=${validateCollector.usage.cachedInputTokens} cost=$${validateCost.toFixed(4)}`,
  );
  console.log(`  total cost: $${cost.toFixed(4)}`);

  const typo = countWithSourcePage(extraction.typography);
  const colour = countWithSourcePage(extraction.colour);
  const tone = countWithSourcePage(extraction.tone);
  const imagery = countWithSourcePage(extraction.imagery);

  console.log("[smoke] rule counts (total / with source_page):");
  console.log(`  typography:  ${typo.total} / ${typo.withPage}`);
  console.log(`  colour:      ${colour.total} / ${colour.withPage}`);
  console.log(`  tone:        ${tone.total} / ${tone.withPage}`);
  console.log(`  imagery:     ${imagery.total} / ${imagery.withPage}`);
  console.log(`  forbidden:           ${extraction.forbidden.length}`);
  console.log(`  layout_constraints:  ${extraction.layout_constraints.length}`);
  console.log(`  logo_rules:          ${extraction.logo_rules.length}`);
  console.log(`  language_prefs:      ${extraction.language_preferences.length}`);
  console.log(`  extraction_confidence: ${extraction.extraction_confidence.toFixed(3)}`);

  // ─── Acceptance gates ─────────────────────────────────────────────
  const failures: string[] = [];
  if (typo.total < 8) failures.push(`typography count ${typo.total} < 8`);
  if (colour.total < 12) failures.push(`colour count ${colour.total} < 12`);
  if (tone.total < 5) failures.push(`tone count ${tone.total} < 5`);
  if (typo.withPage < typo.total) failures.push(`${typo.total - typo.withPage} typography rules missing source_page`);
  if (colour.withPage < colour.total) failures.push(`${colour.total - colour.withPage} colour rules missing source_page`);
  if (tone.withPage < tone.total) failures.push(`${tone.total - tone.withPage} tone rules missing source_page`);
  if (imagery.withPage < imagery.total) failures.push(`${imagery.total - imagery.withPage} imagery rules missing source_page`);
  if (validation.confidence < 0.85) failures.push(`validation confidence ${validation.confidence.toFixed(3)} < 0.85`);
  if (cost > 5) failures.push(`cost $${cost.toFixed(2)} > $5 budget`);

  if (failures.length > 0) {
    console.error("[smoke] ACCEPTANCE FAILURES:");
    for (const f of failures) console.error(`  - ${f}`);
  } else {
    console.log("[smoke] all clean-extraction gates PASS");
  }

  // ─── Negative test: random-bytes PDF rejected by validation ───────
  console.log("\n[smoke] negative test: validating an obviously-bad extraction (random rules)...");
  const badExtraction: BrandGuidelineExtraction = {
    brand: "",
    version: "",
    typography: [
      { surface: SurfaceKind.HEADLINE, font_family: "", weight: 9000, size_px: 12, tracking: null, source_page: 0 },
    ],
    colour: [{ name: "x", hex: "not-a-hex", rgb: null, source_page: -1 }],
    tone: [
      { voice_attribute: "x", do_examples: [], dont_examples: [], sample_sentences: [], source_page: 0 },
    ],
    imagery: [
      { rule: "x", approved_examples_url: [], forbidden_examples_url: [], source_page: 0 },
    ],
    forbidden: [],
    language_preferences: [],
    layout_constraints: [],
    logo_rules: [],
    extraction_confidence: 0.99,
  };
  const negCollector = new Collector("smoke-validate-neg");
  const negValidation = await b.ValidateBrandGuideline(badExtraction, { collector: negCollector });
  console.log(`[smoke] negative validation confidence=${negValidation.confidence.toFixed(3)} (target < 0.7)`);
  console.log(`[smoke] negative reason: ${negValidation.reason}`);
  console.log(`[smoke] negative issues count: ${negValidation.issues.length}`);
  if (negValidation.confidence >= 0.7) {
    failures.push(`negative test confidence ${negValidation.confidence.toFixed(3)} >= 0.7 (validator missed obvious garbage)`);
  } else {
    console.log("[smoke] negative test PASS (validator rejected garbage)");
  }

  if (failures.length > 0) {
    console.error("\n[smoke] OVERALL: FAIL");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(2);
  }

  console.log("\n[smoke] OVERALL: PASS");
  console.log(`[smoke] total cost across both phases + negative: ${(cost + priceTokens(negCollector.usage, HAIKU_PRICE)).toFixed(4)}`);
}

main().catch((err) => {
  console.error("[smoke] unhandled error:", err);
  process.exit(3);
});
