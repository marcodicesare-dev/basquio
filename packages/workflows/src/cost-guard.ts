import Anthropic from "@anthropic-ai/sdk";

import { fetchRestRows } from "./supabase";

const MODEL_PRICING: Record<string, { inputUsdPerMTok: number; outputUsdPerMTok: number }> = {
  "claude-sonnet-4-6": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  "claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  "claude-opus-4-6": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
};

export const MODEL_BUDGET_USD: Record<keyof typeof MODEL_PRICING, {
  preFlight: number;
  hard: number;
  crossAttempt: number;
}> = {
  "claude-sonnet-4-6": { preFlight: 7.0, hard: 10.0, crossAttempt: 15.0 },
  "claude-haiku-4-5": { preFlight: 3.0, hard: 5.0, crossAttempt: 8.0 },
  "claude-opus-4-6": { preFlight: 12.0, hard: 18.0, crossAttempt: 24.0 },
};

export function getDeckBudgetCaps(model: keyof typeof MODEL_PRICING) {
  return MODEL_BUDGET_USD[model];
}

export async function enforceDeckBudget(input: {
  client: Anthropic;
  model: keyof typeof MODEL_PRICING;
  betas: string[];
  body: Omit<Anthropic.Beta.MessageCountTokensParams, "model" | "betas">;
  spentUsd: number;
  outputTokenBudget: number;
  maxUsd?: number;
}) {
  const maxUsd = input.maxUsd ?? getDeckBudgetCaps(input.model).preFlight;

  // Anthropic's token-counting endpoint rejects Files API references such as
  // `source: { type: "file", file_id }` and container uploads. Use token
  // counting only for inline-only requests and fall back to actual-usage
  // enforcement for file-backed phases.
  if (containsUncountableFileSource(input.body)) {
    const projectedUsd = input.spentUsd + estimateUsd(input.model, 0, input.outputTokenBudget);
    if (projectedUsd > maxUsd) {
      throw new Error(
        `Projected Claude cost $${projectedUsd.toFixed(3)} exceeds budget $${maxUsd.toFixed(2)}.`,
      );
    }

    return {
      inputTokens: null,
      projectedUsd,
      usedCountTokens: false,
    };
  }

  const tokenCount = await input.client.beta.messages.countTokens({
    model: input.model,
    betas: input.betas as Anthropic.Beta.AnthropicBeta[],
    ...input.body,
  });

  const projectedUsd =
    input.spentUsd +
    estimateUsd(input.model, tokenCount.input_tokens, input.outputTokenBudget);

  if (projectedUsd > maxUsd) {
    throw new Error(
      `Projected Claude cost $${projectedUsd.toFixed(3)} exceeds budget $${maxUsd.toFixed(2)}.`,
    );
  }

  return {
    inputTokens: tokenCount.input_tokens,
    projectedUsd,
    usedCountTokens: true,
  };
}

export function assertDeckSpendWithinBudget(
  spentUsd: number,
  maxUsdOrModel: number | keyof typeof MODEL_PRICING = "claude-sonnet-4-6",
) {
  const maxUsd = typeof maxUsdOrModel === "number"
    ? maxUsdOrModel
    : getDeckBudgetCaps(maxUsdOrModel).hard;
  if (spentUsd > maxUsd) {
    throw new Error(
      `Claude cost $${spentUsd.toFixed(3)} exceeded hard budget $${maxUsd.toFixed(2)}.`,
    );
  }
}

export function estimateUsd(
  model: keyof typeof MODEL_PRICING,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number = 0,
  cacheReadInputTokens: number = 0,
) {
  const pricing = MODEL_PRICING[model];
  return roundUsd(
    (inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
      (cacheCreationInputTokens / 1_000_000) * pricing.inputUsdPerMTok * 1.25 +
      (cacheReadInputTokens / 1_000_000) * pricing.inputUsdPerMTok * 0.1 +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMTok,
  );
}

export function usageToCost(
  model: keyof typeof MODEL_PRICING,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  } | null | undefined,
) {
  return estimateUsd(
    model,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    usage?.cache_creation_input_tokens ?? 0,
    usage?.cache_read_input_tokens ?? 0,
  );
}

export function roundUsd(value: number) {
  return Math.round(value * 1000) / 1000;
}

export async function getPriorAttemptsCost(input: {
  supabaseUrl: string;
  serviceKey: string;
  runId: string;
  excludeAttemptId?: string | null;
}) {
  const attempts = await fetchRestRows<{
    id: string;
    status: string;
    cost_telemetry: Record<string, unknown> | null;
  }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,status,cost_telemetry",
      run_id: `eq.${input.runId}`,
      order: "attempt_number.asc",
      limit: "50",
    },
  }).catch(() => []);

  return roundUsd(
    attempts
      .filter((row) => row.id !== input.excludeAttemptId)
      .filter((row) => row.status !== "queued" && row.status !== "running")
      .reduce((sum, row) => {
        const value = Number(row.cost_telemetry?.estimatedCostUsd ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
  );
}

function containsUncountableFileSource(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsUncountableFileSource(item));
  }

  const record = value as Record<string, unknown>;

  if (record.type === "container_upload") {
    return true;
  }

  if (record.type === "file" && typeof record.file_id === "string") {
    return true;
  }

  if (
    record.source &&
    typeof record.source === "object" &&
    (record.source as Record<string, unknown>).type === "file" &&
    typeof (record.source as Record<string, unknown>).file_id === "string"
  ) {
    return true;
  }

  return Object.values(record).some((entry) => containsUncountableFileSource(entry));
}
