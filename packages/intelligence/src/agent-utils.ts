/**
 * Safety net: stop agent if estimated cost exceeds budget.
 * Prevents runaway loops from burning API credits.
 * Returns a generic function compatible with any ToolLoopAgent stopWhen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function costBudgetExceeded(maxCostUsd: number): (options: { steps: Array<{ usage?: { inputTokens?: number; outputTokens?: number } }> }) => boolean {
  return ({ steps }: { steps: Array<{ usage?: { inputTokens?: number; outputTokens?: number } }> }) => {
    const totalUsage = steps.reduce(
      (acc, step) => ({
        inputTokens: acc.inputTokens + (step.usage?.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (step.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
    // Pricing: GPT-5.4 $2.50/$15 per MTok, Opus 4.6 $5/$25 per MTok
    // Use the more expensive rate as conservative estimate
    const costEstimate =
      (totalUsage.inputTokens * 5.0 + totalUsage.outputTokens * 25.0) / 1_000_000;
    return costEstimate > maxCostUsd;
  };
}
