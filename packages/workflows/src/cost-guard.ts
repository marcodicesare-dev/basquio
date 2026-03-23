import Anthropic from "@anthropic-ai/sdk";

const MODEL_PRICING: Record<string, { inputUsdPerMTok: number; outputUsdPerMTok: number }> = {
  "claude-sonnet-4-6": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  "claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  "claude-opus-4-6": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
};

export async function enforceDeckBudget(input: {
  client: Anthropic;
  model: keyof typeof MODEL_PRICING;
  betas: string[];
  body: Omit<Anthropic.Beta.MessageCountTokensParams, "model" | "betas">;
  spentUsd: number;
  outputTokenBudget: number;
  maxUsd?: number;
}) {
  const maxUsd = input.maxUsd ?? 2.75;
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
  };
}

export function estimateUsd(
  model: keyof typeof MODEL_PRICING,
  inputTokens: number,
  outputTokens: number,
) {
  const pricing = MODEL_PRICING[model];
  return roundUsd(
    (inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMTok,
  );
}

export function usageToCost(
  model: keyof typeof MODEL_PRICING,
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
) {
  return estimateUsd(model, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0);
}

export function roundUsd(value: number) {
  return Math.round(value * 1000) / 1000;
}
