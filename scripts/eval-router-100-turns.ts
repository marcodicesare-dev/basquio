/**
 * Memory v1 Brief 2 router eval against the live Anthropic API.
 *
 * Calls classifyTurn() for every turn in
 * apps/web/src/lib/workspace/__tests__/fixtures/router-eval.json (100
 * labeled FMCG/CPG analyst questions, 20 per intent), compares the
 * classifier's intents against the labeled expected intents, and reports
 * overall accuracy plus a per-intent confusion matrix.
 *
 * Acceptance gate (per spec §6 + brief): >= 85% accuracy.
 *
 * Cost: roughly $0.50-2.00 on Haiku 4.5. Run from repo root:
 *
 *   pnpm exec tsx scripts/eval-router-100-turns.ts
 *
 * Output is written to /tmp/router-eval-100.json and printed to stdout.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

const FixtureSchema = z.object({
  userMessage: z.string(),
  expectedIntents: z.array(
    z.enum(["metric", "evidence", "graph", "rule", "web"]),
  ),
  expectedEntities: z.array(z.string()).optional(),
  expectedAsOf: z.string().nullable().optional(),
  expectedNeedsWeb: z.boolean().optional(),
});
type FixtureRow = z.infer<typeof FixtureSchema>;

const ResultSchema = z.object({
  intents: z
    .array(z.enum(["metric", "evidence", "graph", "rule", "web"]))
    .min(1)
    .max(3),
  entities: z.array(z.string()),
  as_of: z.string().nullable(),
  needs_web: z.boolean(),
});

/**
 * The router uses AI SDK v6 generateObject with structuredOutputMode 'jsonTool'.
 * For this offline eval the same contract is reproduced via the raw Anthropic
 * SDK by registering a single classify_intents tool and forcing tool_choice
 * onto it. Output shape is byte-identical to what the production classifier
 * sees.
 */
const ROUTER_SYSTEM = `You classify a chat turn from a CPG/FMCG analyst into 1 to 3 intents that decide which memory tools to use.

Intents:
- metric: needs an exact number (share, ADR, count, %, trend, ROS).
- evidence: needs a quote, a passage, a source citation.
- graph: entity history, point-in-time facts, relationships.
- rule: brand rules, tone, typography, colour, compliance, editorial.
- web: explicit current external information request.

Return only the JSON. Do not explain.`;

const CLASSIFY_TOOL = {
  name: "classify_intents",
  description:
    "Emit the structured intent classification for the current chat turn.",
  input_schema: {
    type: "object" as const,
    properties: {
      intents: {
        type: "array",
        items: { type: "string", enum: ["metric", "evidence", "graph", "rule", "web"] },
        minItems: 1,
        maxItems: 3,
      },
      entities: { type: "array", items: { type: "string" } },
      as_of: { type: ["string", "null"] },
      needs_web: { type: "boolean" },
    },
    required: ["intents", "entities", "as_of", "needs_web"],
    additionalProperties: false,
  },
};

type EvalRow = {
  userMessage: string;
  expected: string[];
  actual: string[];
  exactMatch: boolean;
  partialMatch: boolean;
  containsAllExpected: boolean;
  error?: string;
};

async function classify(
  client: Anthropic,
  userMessage: string,
): Promise<z.infer<typeof ResultSchema>> {
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 400,
    system: ROUTER_SYSTEM,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
    messages: [{ role: "user", content: `User: ${userMessage}` }],
  });
  for (const block of res.content) {
    if (block.type === "tool_use" && block.name === CLASSIFY_TOOL.name) {
      return ResultSchema.parse(block.input);
    }
  }
  throw new Error("classifier returned no tool_use block");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set; eval requires live API access.");
    process.exit(1);
  }
  const fixturePath = path.join(
    process.cwd(),
    "apps/web/src/lib/workspace/__tests__/fixtures/router-eval.json",
  );
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown[];
  const rows = raw.map((r) => FixtureSchema.parse(r));
  console.log(`[router-eval] ${rows.length} fixture rows loaded.`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results: EvalRow[] = [];
  let i = 0;
  for (const row of rows) {
    i += 1;
    try {
      const out = await classify(client, row.userMessage);
      const expected = row.expectedIntents;
      const actual = out.intents;
      const expectedSet = new Set(expected);
      const actualSet = new Set(actual);
      // Exact match: same set
      const exactMatch =
        expected.length === actual.length &&
        expected.every((e) => actualSet.has(e));
      // Contains all expected: every expected intent appears in actual
      const containsAllExpected = expected.every((e) => actualSet.has(e));
      // Partial: at least one overlap
      const partialMatch = expected.some((e) => actualSet.has(e));
      results.push({
        userMessage: row.userMessage,
        expected,
        actual,
        exactMatch,
        partialMatch,
        containsAllExpected,
      });
      const flag = exactMatch ? "EXACT" : containsAllExpected ? "CONTAINS" : partialMatch ? "PARTIAL" : "MISS";
      const head = row.userMessage.slice(0, 50).padEnd(52);
      console.log(
        `[${String(i).padStart(3)}/100] ${flag.padEnd(8)} ${head} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
      );
    } catch (err) {
      results.push({
        userMessage: row.userMessage,
        expected: row.expectedIntents,
        actual: [],
        exactMatch: false,
        partialMatch: false,
        containsAllExpected: false,
        error: (err as Error).message ?? String(err),
      });
      console.error(
        `[${String(i).padStart(3)}/100] ERROR    ${row.userMessage.slice(0, 50)} ${(err as Error).message}`,
      );
    }
  }

  const total = results.length;
  const exact = results.filter((r) => r.exactMatch).length;
  const containsAll = results.filter((r) => r.containsAllExpected).length;
  const partial = results.filter((r) => r.partialMatch).length;
  const errors = results.filter((r) => r.error).length;

  console.log("\n[router-eval] RESULTS");
  console.log(`total: ${total}`);
  console.log(
    `exact match: ${exact} / ${total} = ${((exact / total) * 100).toFixed(1)}%`,
  );
  console.log(
    `contains all expected: ${containsAll} / ${total} = ${((containsAll / total) * 100).toFixed(1)}%`,
  );
  console.log(
    `partial match: ${partial} / ${total} = ${((partial / total) * 100).toFixed(1)}%`,
  );
  console.log(`errors: ${errors}`);

  const perIntent: Record<string, { tp: number; fn: number; total: number }> = {};
  for (const intent of ["metric", "evidence", "graph", "rule", "web"]) {
    perIntent[intent] = { tp: 0, fn: 0, total: 0 };
  }
  for (const r of results) {
    for (const e of r.expected) {
      perIntent[e].total += 1;
      if (r.actual.includes(e)) perIntent[e].tp += 1;
      else perIntent[e].fn += 1;
    }
  }
  console.log("\n[router-eval] per-intent recall");
  for (const [intent, m] of Object.entries(perIntent)) {
    const recall = m.total > 0 ? (m.tp / m.total) * 100 : 0;
    console.log(
      `  ${intent.padEnd(10)}: ${m.tp}/${m.total} = ${recall.toFixed(1)}% (fn=${m.fn})`,
    );
  }

  const summary = {
    total,
    exact_match: exact,
    contains_all_expected: containsAll,
    partial_match: partial,
    errors,
    accuracy_exact_pct: (exact / total) * 100,
    accuracy_contains_all_pct: (containsAll / total) * 100,
    per_intent_recall: perIntent,
    rows: results,
  };
  writeFileSync(
    "/tmp/router-eval-100.json",
    JSON.stringify(summary, null, 2),
  );
  console.log("\n[router-eval] full results -> /tmp/router-eval-100.json");

  // Acceptance gate per spec §6 + brief: 85% accuracy. Use the
  // contains-all-expected criterion (every labeled intent appears in
  // classifier output, plus optional extras) which is the practical match
  // for activeToolsForIntents gating. The exact-match bar is stricter.
  const gateFloor = 85;
  if ((containsAll / total) * 100 >= gateFloor) {
    console.log(
      `\n[router-eval] PASS (contains-all-expected = ${((containsAll / total) * 100).toFixed(1)}%, gate ${gateFloor}%)`,
    );
    process.exit(0);
  } else {
    console.error(
      `\n[router-eval] FAIL (contains-all-expected = ${((containsAll / total) * 100).toFixed(1)}%, gate ${gateFloor}%)`,
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[router-eval] threw", err);
  process.exit(2);
});
