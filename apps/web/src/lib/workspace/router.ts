import "server-only";

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

/**
 * Memory v1 Brief 2 router. Given a user turn, return the intents the agent
 * should service, the entities mentioned, an optional point-in-time anchor,
 * and a needs_web flag. Backed by Haiku 4.5 (fast, cheap, structurally good
 * at intent classification). Adds ~280ms p50 to the turn but tighter
 * downstream retrieval saves more than that.
 *
 * Spec: docs/research/2026-04-25-sota-implementation-specs.md §6.
 */

export const ROUTER_INTENTS = [
  "metric",
  "evidence",
  "graph",
  "rule",
  "web",
] as const;

export type RouterIntent = (typeof ROUTER_INTENTS)[number];

export const IntentSchema = z.object({
  intents: z
    .array(z.enum(ROUTER_INTENTS))
    .min(1)
    .max(3)
    .describe(
      "1-3 intents that classify what the user wants. Pick only intents the user actually requests.",
    ),
  entities: z
    .array(z.string())
    .describe(
      "Named brands, retailers, people, products, scopes mentioned verbatim in the user message.",
    ),
  as_of: z
    .string()
    .nullable()
    .describe(
      "ISO date (YYYY-MM-DD) if the user references a point in time, else null.",
    ),
  needs_web: z
    .boolean()
    .describe(
      "True only when the user explicitly asks for current external information not yet in the workspace.",
    ),
});

export type TurnIntent = z.infer<typeof IntentSchema>;

const ROUTER_SYSTEM_PROMPT = `You classify a chat turn from a CPG/FMCG analyst into 1 to 3 intents that decide which memory tools the agent should reach for.

Intents:
- metric: the user wants an exact number (share, ADR, count, %, trend, ROS).
- evidence: the user wants a quote, a passage, a source citation from the workspace.
- graph: the user wants entity history, point-in-time facts, who-knows-whom, or a relationship across people/brands/categories.
- rule: the user is asking about brand rules, tone, typography, colour, compliance, editorial preferences.
- web: the user explicitly wants current external information not yet in the workspace.

entities: extract any named brand, retailer, person, hotel, product, category, scope mentioned verbatim. Do not invent.
as_of: ISO date (YYYY-MM-DD) if the user references a past point in time ("at end of Q4", "in March 2025"), else null.
needs_web: true only when the user explicitly asks for current external info ("today's news", "this week's market", "what is X saying").

Return only the JSON. Do not explain.`;

// Spec §6 specifies Haiku 4.5 for cost. The Anthropic Messages API does not
// yet accept the `output_config.format` parameter that @ai-sdk/anthropic
// emits by default for `generateObject`; both Haiku and Sonnet return HTTP
// 404 when that field is present. The provider exposes
// `structuredOutputMode: 'jsonTool'` to fall back to tool-emulated structured
// output, which Haiku does support.
export const ROUTER_MODEL_ID = "claude-haiku-4-5";

export type ClassifyTurnInput = {
  userMessage: string;
  recentTurns?: string;
  workspaceContext?: string;
};

export async function classifyTurn(input: ClassifyTurnInput): Promise<TurnIntent> {
  const { object } = await generateObject({
    model: anthropic(ROUTER_MODEL_ID),
    schema: IntentSchema,
    system: ROUTER_SYSTEM_PROMPT,
    prompt: buildClassifierPrompt(input),
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" },
    },
  });
  return object;
}

export function buildClassifierPrompt(input: ClassifyTurnInput): string {
  const parts: string[] = [];
  if (input.workspaceContext) {
    parts.push(`Workspace: ${input.workspaceContext.slice(0, 600)}`);
  }
  if (input.recentTurns) {
    parts.push(`Recent: ${input.recentTurns.slice(0, 1200)}`);
  }
  parts.push(`User: ${input.userMessage.slice(0, 4000)}`);
  return parts.join("\n\n");
}

/**
 * Map intents (and the needs_web flag) to the set of tool names the chat
 * agent should keep active for this turn. Always includes the write tools
 * (teachRule, editRule, saveFromPaste, scrapeUrl) and the file/UI tools
 * (analystCommentary, analyzeAttachedFile, listConversationFiles,
 * showStakeholderCard) so they remain available regardless of intent. These
 * tools are gated by user phrasing, not by retrieval intent.
 *
 * The 30-day deprecation fallback `retrieveContext` is included only when no
 * intent gates a typed retrieval tool, so a borderline classification still
 * has a path to evidence.
 */
export function activeToolsForIntents(
  intent: TurnIntent,
  options: { includeFallback: boolean } = { includeFallback: true },
): string[] {
  const tools = new Set<string>();

  if (intent.intents.includes("metric")) {
    tools.add("queryStructuredMetric");
    tools.add("showMetricCard");
  }
  if (intent.intents.includes("rule")) {
    tools.add("queryBrandRule");
  }
  if (intent.intents.includes("graph")) {
    tools.add("queryEntityFact");
  }
  if (intent.intents.includes("evidence")) {
    tools.add("searchEvidence");
  }
  if (intent.needs_web || intent.intents.includes("web")) {
    tools.add("webSearch");
  }

  // Always-on read/write/UI tools regardless of classifier output.
  for (const t of [
    "teachRule",
    "editRule",
    "saveFromPaste",
    "scrapeUrl",
    "analystCommentary",
    "analyzeAttachedFile",
    "listConversationFiles",
    "showStakeholderCard",
    "editStakeholder",
    "createStakeholder",
    "draftBrief",
    "explainBasquio",
    "suggestServices",
    "memory",
  ]) {
    tools.add(t);
  }

  if (options.includeFallback) {
    const hasTypedRetrieval =
      tools.has("queryStructuredMetric") ||
      tools.has("queryBrandRule") ||
      tools.has("queryEntityFact") ||
      tools.has("searchEvidence");
    if (!hasTypedRetrieval) tools.add("retrieveContext");
  }

  return Array.from(tools);
}
