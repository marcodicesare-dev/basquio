import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText, Output, ToolLoopAgent, stepCountIs } from "ai";
import { z } from "zod";

import {
  analysisReportSchema,
  clarifiedBriefSchema,
  storylinePlanSchema,
  type AnalysisReport,
  type ClarifiedBrief,
  type StorylinePlan,
  type EvidenceWorkspace,
} from "@basquio/types";
import { costBudgetExceeded } from "../agent-utils";

import {
  createListFilesTool,
  createDescribeTableTool,
  createSampleRowsTool,
  createQueryDataTool,
  createComputeMetricTool,
  createComputeDerivedTool,
  createReadSupportDocTool,
  type ToolContext,
} from "../tools";

// ─── ANALYST AGENT ────────────────────────────────────────────────
// Model: gpt-5.4 (best tabular reasoning, configurable reasoning effort)
// Purpose: Explore the evidence workspace, compute metrics, build understanding
// Output: AnalysisReport (structured)

export type AnalystAgentInput = {
  workspace: EvidenceWorkspace;
  runId: string;
  brief: string;
  persistNotebookEntry: ToolContext["persistNotebookEntry"];
  loadRows?: ToolContext["loadRows"];
  onStepFinish?: (event: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>;
    usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
    finishReason: string;
  }) => Promise<void>;
  modelOverride?: string;
  providerOverride?: "openai" | "anthropic";
};

export function createAnalystAgent(input: AnalystAgentInput) {
  const ctx: ToolContext = {
    workspace: input.workspace,
    runId: input.runId,
    persistNotebookEntry: input.persistNotebookEntry,
    loadRows: input.loadRows,
  };

  const provider = input.providerOverride ?? "openai";
  const modelId = input.modelOverride ?? "gpt-5.4";
  const model = provider === "openai" ? openai(modelId) : anthropic(modelId);

  const agent = new ToolLoopAgent({
    model,
    instructions: `You are a senior data analyst at a top-tier strategy consulting firm. You explore evidence workspaces — collections of uploaded files (spreadsheets, documents, PDFs) — and produce deep analytical reports that drive executive decisions.

## YOUR APPROACH

You think like a consultant, not a BI tool. You don't just compute aggregates — you look for the story in the data, the tensions, the opportunities, and the risks.

### Phase 1: Understand the data (steps 1-8)
1. List all files to understand scope
2. Describe each table — columns, types, cardinality
3. Sample rows to see actual values, formats, and patterns
4. Read any support documents for methodology, definitions, context
5. Identify: What are the key entities? What are the key dimensions? What time periods exist? What is the unit of measurement?

### Phase 2: First-order analysis (steps 9-16)
6. Compute key totals — market size, entity totals, segment sizes
7. Compute breakdowns by every important dimension
8. Compute period-over-period changes where time data exists
9. Compute rankings — who is biggest, fastest growing, most efficient

### DERIVED METRICS — ALWAYS COMPUTE THESE (use compute_derived tool)

When you find Value + Volume/Units columns in the same dataset:
- **Price per unit** = Value / Volume (formula="per_unit", numeratorColumn="Value col", denominatorColumn="Volume col")
- **Market share** = Entity Value / Total Value (formula="share", valueColumn="Value col", entityFilter="Brand = X")
- **Growth rate** for ALL major entities (formula="growth_rate", valueColumn="Value col", currentFilter="Year = 2025", priorFilter="Year = 2024")
- **Contribution to growth** for focal entity (formula="contribution")

When you have both Value and Volume shares:
- **Mix gap** = Value share - Volume share (formula="mix_gap"). Positive = premium. Negative = volume play.
- **Price index** = Entity price / Category avg price * 100 (formula="index")

DO NOT skip derived metrics. Raw columns are inputs, not insights. An executive needs "Ultima's price index is 112 vs category" — not "Ultima's value is X and volume is Y."

For every finding, include WHY it matters and WHAT to do about it.
"X grew 5%" is NOT a finding.
"X grew 5% driven by price (+7%) despite volume decline (-2%), suggesting premiumization works but penetration risk is building — recommend trial-driving investment" IS a finding.

### Phase 3: Second-order insights (steps 17-25)
10. **Share analysis**: entity value / total market. Do this per segment, not just overall. Use compute_derived with formula="share".
11. **Growth decomposition**: separate value growth from volume growth. Which is driving? Use compute_derived with formula="growth_rate" on both value and volume columns.
12. **Relative positioning**: how does the focal entity compare to the market average? To the top competitor? Use compute_derived with formula="index".
13. **Concentration**: top N entities = what % of total? Is value concentrated or distributed?
14. **Structural shifts**: what categories/segments are growing vs declining? What's the trend direction?
15. **Cross-cutting patterns**: is the focal entity strong in segment A but absent in segment B? What's the opportunity cost of that gap?
16. **Competitive dynamics**: who is gaining share? Who is losing? At whose expense?

### Phase 4: Hypothesis-driven synthesis (steps 26-30)
17. Before producing your final structured output, formulate:
    a. A **GOVERNING QUESTION** that captures what this deck must answer — the single question the audience needs resolved.
    b. **ISSUE BRANCHES** — sub-questions that decompose the governing question (e.g., "Is the focal entity growing faster than the market?", "Where are the white-space opportunities?").
    c. For each branch, **HYPOTHESES** with their evidence status: confirmed (data supports it), refuted (data contradicts it), or pending (insufficient data). Cite the evidence ref IDs that support or refute each hypothesis.
    d. **RECOMMENDATION SHAPES** — what actions emerge from the confirmed hypotheses, with quantification where possible (e.g., "Entering segment X could capture Y% share worth Z revenue").

18. Then structure your findings as:
    - **STRENGTHS**: where does the focal entity outperform the market or competitors?
    - **WEAKNESSES**: where does it underperform, have gaps, or face concentration risk?
    - **OPPORTUNITIES**: what's growing that the entity could capture? Quantify the addressable gap.
    - **THREATS**: what competitors or trends could erode the entity's position?
    - **KEY DYNAMICS**: what structural market shifts explain the current picture?

Your topFindings should map to the issue branches — each finding should address one branch of the issue tree. The businessImplication field should contain the recommendation shape for that branch.

## EVIDENCE REGISTRATION

Register EVERY important finding as a named evidence ref via compute_metric. Each evidence ref becomes citable by the presentation author. The more evidence you register, the richer the final deck.

## CRITICAL RULES

- Be thorough — an executive will make decisions based on this. Shallow analysis = bad decisions.
- Don't stop at obvious metrics. The non-obvious cross-cutting insight is where the value is.
- If a query fails, try a different approach. Data may have unexpected formats.
- Always compute RELATIVE metrics (share %, index, vs-market), not just absolute values.
- Identify the focal entity from the brief and analyze everything through their lens.`,
    tools: {
      list_files: createListFilesTool(ctx),
      describe_table: createDescribeTableTool(ctx),
      sample_rows: createSampleRowsTool(ctx),
      query_data: createQueryDataTool(ctx),
      compute_metric: createComputeMetricTool(ctx),
      compute_derived: createComputeDerivedTool(ctx),
      read_support_doc: createReadSupportDocTool(ctx),
    },
    stopWhen: stepCountIs(30),
    output: Output.object({ schema: analysisReportSchema }),
    onStepFinish: input.onStepFinish,
  });

  return agent;
}

// ─── STORYLINE STRUCTURING (second model call) ──────────────────
// Separation of reasoning from structuring: the analyst explores data freely,
// then a second call structures the findings into an issue tree + storyline.

const storylineOutputSchema = z.object({
  clarifiedBrief: clarifiedBriefSchema,
  storylinePlan: storylinePlanSchema,
});

export type AnalystResult = {
  analysis: AnalysisReport;
  clarifiedBrief: ClarifiedBrief | null;
  storylinePlan: StorylinePlan | null;
};

async function structureStoryline(
  analysis: AnalysisReport,
  brief: string,
  provider: "openai" | "anthropic",
  modelId: string,
): Promise<{ clarifiedBrief: ClarifiedBrief; storylinePlan: StorylinePlan } | null> {
  const model = provider === "openai" ? openai(modelId) : anthropic(modelId);

  const findingsSummary = analysis.topFindings
    .map((f, i) => `${i + 1}. [${f.title}] ${f.claim} (confidence: ${f.confidence}, evidence: [${f.evidenceRefIds.join(", ")}]) → ${f.businessImplication}`)
    .join("\n");

  const chartSummary = analysis.recommendedChartTypes
    .map((c) => `Finding ${c.findingIndex + 1}: ${c.chartType} — ${c.rationale}`)
    .join("\n");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: storylineOutputSchema }),
      prompt: `You are a senior strategy consultant. Given an analyst's findings and the original brief, produce two structured working papers:

1. **Clarified Brief** — your interpretation of what this deck must accomplish
2. **Storyline Plan** — an issue tree that structures the narrative

ORIGINAL BRIEF:
${brief}

ANALYSIS DOMAIN: ${analysis.domain}
ANALYSIS SUMMARY: ${analysis.summary}

KEY FINDINGS:
${findingsSummary}

KEY DIMENSIONS: ${analysis.keyDimensions.join(", ")}

RECOMMENDED CHARTS:
${chartSummary}

METRICS COMPUTED: ${analysis.metricsComputed} | QUERIES EXECUTED: ${analysis.queriesExecuted} | FILES ANALYZED: ${analysis.filesAnalyzed}

INSTRUCTIONS:
- The GOVERNING QUESTION must be a single question that, if answered well, makes this deck worth the audience's time.
- Each ISSUE BRANCH should be a sub-question. Map each branch to the relevant findings above.
- For each hypothesis, set status to "confirmed" if the findings support it, "refuted" if they contradict it, "partial" if mixed, or "pending" if no data addresses it.
- RECOMMENDATION SHAPES should be actionable, quantified where possible, and linked to confirmed hypotheses.
- The TITLE READ-THROUGH is the proposed sequence of slide titles — each should be an action title (full sentence with a number) that communicates one governing thought.
- Detect the language from the brief. If the brief is in Italian, French, German, etc., set language accordingly and write all content in that language.
- requestedSlideCount: extract from the brief if mentioned (e.g., "12 slides"), otherwise null.`,
    });

    if (!result.output) return null;
    return result.output;
  } catch (error) {
    console.error("[structureStoryline] Failed to produce storyline plan:", error);
    return null;
  }
}

export async function runAnalystAgent(input: AnalystAgentInput): Promise<AnalystResult> {
  const agent = createAnalystAgent(input);

  const fileInventorySummary = input.workspace.fileInventory
    .map((f) => `- ${f.fileName} (${f.kind}, ${f.role}, ${f.sheets.length} sheets)`)
    .join("\n");

  const result = await agent.generate({
    prompt: `Analyze this evidence workspace for the following brief:

${input.brief}

Available files:
${fileInventorySummary}

Start by listing files and describing tables. Sample rows to understand the data. Then compute metrics systematically — explore from multiple angles before concluding. Register every finding as an evidence ref.

Be thorough but efficient. An executive will make decisions based on your analysis. You have a maximum of ~20 tool calls before you must produce your final structured report. Plan your exploration accordingly — don't spend all your budget on one dimension.

IMPORTANT: Identify the focal entity from the brief above. Every metric you compute should help answer: "How is the focal entity performing, where are they strong, where are they weak, and what should they do?" Register all findings as evidence refs — the presentation author needs them.

In Phase 4, before producing your final structured output, think through:
1. What is the GOVERNING QUESTION this deck must answer?
2. What are the ISSUE BRANCHES (sub-questions)?
3. For each branch, what HYPOTHESES were confirmed or refuted by your analysis?
4. What RECOMMENDATION SHAPES emerge?

Encode this thinking into your topFindings — each finding should address one branch of the issue tree, with the businessImplication containing the recommendation.`,
  });

  let analysis: AnalysisReport;
  if (!result.output) {
    // Fallback: construct a minimal AnalysisReport from the agent's text response.
    const textSummary = result.text ?? "Analysis completed but structured output was not generated.";
    analysis = {
      summary: textSummary.slice(0, 2000),
      domain: "Market Analysis",
      topFindings: [{
        title: "Analysis Summary",
        claim: textSummary.slice(0, 200),
        evidenceRefIds: [],
        confidence: 0.5,
        businessImplication: "See full analysis text for details.",
      }],
      metricsComputed: 0,
      queriesExecuted: 0,
      filesAnalyzed: input.workspace.fileInventory.length,
      keyDimensions: [],
      recommendedChartTypes: [],
    };
  } else {
    analysis = result.output;
  }

  // Second model call: structure findings into issue tree + storyline plan
  const provider = input.providerOverride ?? "openai";
  const modelId = input.modelOverride ?? "gpt-5.4";
  const storylineResult = await structureStoryline(analysis, input.brief, provider, modelId);

  return {
    analysis,
    clarifiedBrief: storylineResult?.clarifiedBrief ?? null,
    storylinePlan: storylineResult?.storylinePlan ?? null,
  };
}
