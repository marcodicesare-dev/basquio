import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { analysisReportSchema, type AnalysisReport, type EvidenceWorkspace } from "@basquio/types";
import { costBudgetExceeded } from "../agent-utils";

import {
  createListFilesTool,
  createDescribeTableTool,
  createSampleRowsTool,
  createQueryDataTool,
  createComputeMetricTool,
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
    instructions: `You are a senior data analyst working for a strategy consulting firm. Your job is to analyze an evidence workspace — a collection of uploaded files (spreadsheets, documents, PDFs) — and produce a comprehensive analysis for a business brief.

Your approach:
1. Start by listing all files to understand what you're working with.
2. Describe each table to understand columns, types, and roles.
3. Sample rows to understand the actual data values and patterns.
4. Read any support documents (methodology guides, definitions) for context.
5. Then systematically compute metrics — explore from multiple angles:
   - Key totals and averages
   - Breakdowns by important dimensions
   - Period-over-period changes if time data exists
   - Rankings and comparisons
   - Ratios and shares
6. Query data for specific patterns and anomalies.
7. Register every important finding as an evidence ref via compute_metric.

Be thorough. An executive will make decisions based on your analysis. Don't stop at obvious metrics — look for non-obvious patterns, outliers, and relationships.

If a query or metric fails, try a different approach. The data may have unexpected formats or missing values.`,
    tools: {
      list_files: createListFilesTool(ctx),
      describe_table: createDescribeTableTool(ctx),
      sample_rows: createSampleRowsTool(ctx),
      query_data: createQueryDataTool(ctx),
      compute_metric: createComputeMetricTool(ctx),
      read_support_doc: createReadSupportDocTool(ctx),
    },
    stopWhen: [stepCountIs(25), costBudgetExceeded(1.00)],
    output: Output.object({ schema: analysisReportSchema }),
    onStepFinish: input.onStepFinish,
  });

  return agent;
}

export async function runAnalystAgent(input: AnalystAgentInput): Promise<AnalysisReport> {
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

Be thorough but efficient. An executive will make decisions based on your analysis. You have a maximum of ~20 tool calls before you must produce your final structured report. Plan your exploration accordingly — don't spend all your budget on one dimension.`,
  });

  if (!result.output) {
    // Fallback: construct a minimal AnalysisReport from the agent's text response.
    // This happens when the model hits output token limits before completing the structured JSON.
    const textSummary = result.text ?? "Analysis completed but structured output was not generated.";
    return {
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
  }

  return result.output;
}
