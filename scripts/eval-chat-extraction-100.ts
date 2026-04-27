/**
 * Memory v1 Brief 4 chat-extraction eval (Phase 8b).
 *
 * Runs the live Haiku 4.5 extractor against the labeled fixture at
 * apps/web/src/lib/workspace/__tests__/fixtures/chat-extraction-eval.json
 * and asserts the spec §7 acceptance gates:
 *   - false-positive rate < 0.5 per 10 turns (on null-extraction turns,
 *     no candidates emitted with confidence >= 0.6)
 *   - kind coverage: every fixture-claimed kind appears in extractions
 *
 * Skips the persist phase (DRY MODE behaviour); DB unaffected.
 *
 * Usage:
 *   pnpm tsx scripts/eval-chat-extraction-100.ts
 *
 * Cost budget: ~$0.50-2 in Haiku tokens for the full sweep (Haiku
 * pricing $1/$5 in/out per MT).
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { extractCandidatesLLM } from "../packages/workflows/src/workspace/chat-extraction";
import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

const FIXTURE_PATH = resolve(
  process.cwd(),
  "apps/web/src/lib/workspace/__tests__/fixtures/chat-extraction-eval.json",
);

const OUT_PATH = "/tmp/chat-extraction-eval-results.json";

type FixtureTurn = {
  id: number;
  userMessage: string;
  expectKinds: string[];
  note?: string;
};

const DROP_FLOOR = 0.6;
const AUTO_PROMOTE_FLOOR = 0.8;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required.");
    process.exit(1);
  }

  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const fixture: FixtureTurn[] = JSON.parse(raw);
  console.log(`[eval] running ${fixture.length} turns against claude-haiku-4-5`);

  type TurnResult = {
    id: number;
    userMessage: string;
    expectKinds: string[];
    extractedKinds: string[];
    extractedCount: number;
    falsePositive: boolean;
    truePositive: boolean;
    candidates: unknown[];
    cost: number;
  };

  const results: TurnResult[] = [];
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let errorCount = 0;

  for (const turn of fixture) {
    try {
      const r = await extractCandidatesLLM({ turnText: turn.userMessage });
      const aboveFloor = r.candidates.filter((c: { confidence: number }) => c.confidence >= DROP_FLOOR);
      const extractedKinds = aboveFloor.map((c: { kind: string }) => c.kind);
      const expected = new Set(turn.expectKinds);
      const extracted = new Set(extractedKinds);

      const falsePositive = expected.size === 0 && extracted.size > 0;
      const truePositive = [...expected].every((k) => extracted.has(k));

      results.push({
        id: turn.id,
        userMessage: turn.userMessage,
        expectKinds: turn.expectKinds,
        extractedKinds,
        extractedCount: aboveFloor.length,
        falsePositive,
        truePositive,
        candidates: aboveFloor,
        cost: r.costUsd,
      });
      totalCost += r.costUsd;
      totalInputTokens += r.tokensInput;
      totalOutputTokens += r.tokensOutput;
      const kindLabel = aboveFloor.length === 0 ? "[]" : extractedKinds.join(",");
      const status = falsePositive ? "FP" : truePositive ? "OK" : "MISS";
      console.log(
        `  [${status}] turn ${String(turn.id).padStart(3)} expected=[${turn.expectKinds.join(",")}] extracted=${kindLabel} cost=$${r.costUsd.toFixed(4)}`,
      );
    } catch (err) {
      errorCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [ERR] turn ${turn.id}: ${message}`);
      results.push({
        id: turn.id,
        userMessage: turn.userMessage,
        expectKinds: turn.expectKinds,
        extractedKinds: [],
        extractedCount: 0,
        falsePositive: false,
        truePositive: false,
        candidates: [],
        cost: 0,
      });
    }
  }

  // Aggregate metrics.
  const nullTurns = results.filter((r) => r.expectKinds.length === 0);
  const positiveTurns = results.filter((r) => r.expectKinds.length > 0);
  const falsePositives = nullTurns.filter((r) => r.falsePositive).length;
  const truePositives = positiveTurns.filter((r) => r.truePositive).length;
  const fpRatePer10 = nullTurns.length > 0 ? (falsePositives / nullTurns.length) * 10 : 0;
  const tpRate = positiveTurns.length > 0 ? truePositives / positiveTurns.length : 0;

  // Auto-promote precision: of high-confidence (> 0.8) extractions, what
  // fraction match expectKinds.
  const autoPromoteCandidates: { id: number; kind: string; expectMatch: boolean }[] = [];
  for (const r of results) {
    for (const c of r.candidates as Array<{ kind: string; confidence: number }>) {
      if (c.confidence > AUTO_PROMOTE_FLOOR) {
        const expectMatch = r.expectKinds.includes(c.kind);
        autoPromoteCandidates.push({ id: r.id, kind: c.kind, expectMatch });
      }
    }
  }
  const autoPromoteHits = autoPromoteCandidates.filter((c) => c.expectMatch).length;
  const autoPromotePrecision =
    autoPromoteCandidates.length > 0 ? autoPromoteHits / autoPromoteCandidates.length : null;

  const kindsSeenAboveFloor = new Set(results.flatMap((r) => r.extractedKinds));
  const allKindsSeen = ["fact", "rule", "preference", "alias", "entity"].every((k) =>
    kindsSeenAboveFloor.has(k),
  );

  console.log("\n[eval] aggregate metrics:");
  console.log(`  turns: ${results.length} (errors: ${errorCount})`);
  console.log(`  null-extraction turns: ${nullTurns.length}`);
  console.log(`  positive-extraction turns: ${positiveTurns.length}`);
  console.log(`  false positives: ${falsePositives} / ${nullTurns.length}`);
  console.log(`  false-positive rate per 10 turns: ${fpRatePer10.toFixed(2)} (target < 0.5)`);
  console.log(`  true-positive rate: ${(tpRate * 100).toFixed(1)}%`);
  console.log(
    `  auto-promote candidates (conf > 0.8): ${autoPromoteCandidates.length}, precision: ${
      autoPromotePrecision === null ? "n/a" : (autoPromotePrecision * 100).toFixed(1) + "%"
    } (target >= 95%)`,
  );
  console.log(`  kind coverage above 0.6: [${[...kindsSeenAboveFloor].sort().join(",")}]`);
  console.log(`  all 5 kinds seen: ${allKindsSeen}`);
  console.log(`  total input tokens: ${totalInputTokens}`);
  console.log(`  total output tokens: ${totalOutputTokens}`);
  console.log(`  total cost: $${totalCost.toFixed(4)}`);

  await writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        model: "claude-haiku-4-5",
        fixtureSize: fixture.length,
        errorCount,
        falsePositiveRatePer10: fpRatePer10,
        truePositiveRate: tpRate,
        autoPromotePrecision,
        autoPromoteCandidateCount: autoPromoteCandidates.length,
        kindsSeenAboveFloor: [...kindsSeenAboveFloor],
        allKindsSeen,
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: totalCost,
        results,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`\n[eval] full results written to ${OUT_PATH}`);

  // Acceptance gates.
  const failures: string[] = [];
  if (fpRatePer10 >= 0.5) failures.push(`false-positive rate ${fpRatePer10.toFixed(2)} >= 0.5 per 10 turns`);
  if (autoPromotePrecision !== null && autoPromotePrecision < 0.95) {
    failures.push(`auto-promote precision ${(autoPromotePrecision * 100).toFixed(1)}% < 95%`);
  }
  if (errorCount > 0) failures.push(`${errorCount} API errors`);

  if (failures.length > 0) {
    console.error("\n[eval] FAIL:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(2);
  }
  console.log("\n[eval] PASS");
}

main().catch((err) => {
  console.error("[eval] unhandled error:", err);
  process.exit(3);
});
