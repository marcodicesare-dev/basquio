#!/usr/bin/env tsx
/**
 * Entity resolution benchmark.
 *
 * Loads the 200-case fixture at scripts/data/entity-resolution-bench.json,
 * runs the cascade resolver against a fixed candidate pool, and reports
 * precision, recall, F1, per-stage breakdown, and confusion samples.
 *
 * Usage:
 *   pnpm exec tsx scripts/bench-entity-resolution.ts [--verbose]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  normalizeEntityName,
  resolveEntity,
  type Candidate,
} from "../apps/web/src/lib/workspace/entity-resolution";

type Fixture = {
  candidates: Array<{ id: string; canonical_name: string; aliases?: string[] }>;
  cases: Array<{
    query: string;
    expected_id: string | null;
    label: "same" | "different";
    note?: string;
  }>;
};

function loadFixture(): Fixture {
  const path = resolve(process.cwd(), "scripts/data/entity-resolution-bench.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as Fixture;
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const fixture = loadFixture();

  const candidates: Candidate[] = fixture.candidates.map((c) => ({
    id: c.id,
    canonical_name: c.canonical_name,
    normalized_name: normalizeEntityName(c.canonical_name),
    aliases: c.aliases ?? [],
  }));

  const perMethod: Record<string, { correct: number; wrong: number }> = {};
  function bump(method: string, correct: boolean) {
    const row = perMethod[method] ?? { correct: 0, wrong: 0 };
    if (correct) row.correct += 1;
    else row.wrong += 1;
    perMethod[method] = row;
  }

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const falsePositives: Array<{ query: string; picked: string; method: string; confidence: number }> = [];
  const falseNegatives: Array<{ query: string; expected: string; confidence: number }> = [];

  for (const c of fixture.cases) {
    const result = await resolveEntity({ name: c.query, candidates });
    const correct =
      c.label === "same"
        ? result.entity_id !== null && result.entity_id === c.expected_id
        : result.entity_id === null;

    bump(result.method, correct);

    if (c.label === "same") {
      if (result.entity_id === c.expected_id) tp += 1;
      else {
        fn += 1;
        const expectedName =
          fixture.candidates.find((x) => x.id === c.expected_id)?.canonical_name ?? "?";
        falseNegatives.push({ query: c.query, expected: expectedName, confidence: result.confidence });
      }
    } else {
      if (result.entity_id === null) tn += 1;
      else {
        fp += 1;
        const pickedName =
          fixture.candidates.find((x) => x.id === result.entity_id)?.canonical_name ?? "?";
        falsePositives.push({
          query: c.query,
          picked: pickedName,
          method: result.method,
          confidence: result.confidence,
        });
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = (tp + tn) / fixture.cases.length;

  const pad = (s: string, w: number) => s.padEnd(w);

  console.log("");
  console.log("Entity resolution benchmark");
  console.log("═".repeat(62));
  console.log(`  Candidates:   ${fixture.candidates.length}`);
  console.log(`  Test cases:   ${fixture.cases.length}`);
  console.log("");
  console.log("Overall");
  console.log(`  Accuracy:   ${fmt(accuracy)}    (target: n/a)`);
  console.log(`  Precision:  ${fmt(precision)}    (target: ≥ 0.90)`);
  console.log(`  Recall:     ${fmt(recall)}    (target: ≥ 0.85)`);
  console.log(`  F1:         ${fmt(f1)}`);
  console.log("");
  console.log("Confusion");
  console.log(`  TP: ${tp}   FP: ${fp}   TN: ${tn}   FN: ${fn}`);
  console.log("");
  console.log("Per-stage hits");
  for (const method of ["exact", "alias", "metaphone", "similarity", "haiku", "none"]) {
    const row = perMethod[method] ?? { correct: 0, wrong: 0 };
    const total = row.correct + row.wrong;
    if (total === 0) continue;
    console.log(
      `  ${pad(method, 11)}  ${pad(`${row.correct}/${total}`, 10)}` +
        `  correct: ${fmt(row.correct / Math.max(1, total))}`,
    );
  }

  if (verbose || falsePositives.length > 0) {
    console.log("");
    console.log(`False positives (${falsePositives.length})`);
    for (const fp of falsePositives.slice(0, 10)) {
      console.log(
        `  · "${fp.query}" → "${fp.picked}"  [${fp.method} @ ${fp.confidence.toFixed(2)}]`,
      );
    }
    if (falsePositives.length > 10) console.log(`  … and ${falsePositives.length - 10} more`);
  }

  if (verbose || falseNegatives.length > 0) {
    console.log("");
    console.log(`False negatives (${falseNegatives.length})`);
    for (const fn of falseNegatives.slice(0, 10)) {
      console.log(`  · "${fn.query}" should match "${fn.expected}"  [top ${fn.confidence.toFixed(2)}]`);
    }
    if (falseNegatives.length > 10) console.log(`  … and ${falseNegatives.length - 10} more`);
  }

  console.log("");

  const passPrecision = precision >= 0.9;
  const passRecall = recall >= 0.85;
  if (!passPrecision || !passRecall) {
    console.log(
      `RESULT: below target (precision ${passPrecision ? "ok" : "FAIL"}, recall ${passRecall ? "ok" : "FAIL"}).`,
    );
    process.exit(1);
  }
  console.log("RESULT: pass.");
  process.exit(0);
}

function fmt(n: number): string {
  return (Math.round(n * 10000) / 100).toFixed(2).padStart(5, " ") + "%";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
