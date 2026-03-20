// ─── OBSERVABILITY ────────────────────────────────────────────────
// Centralized telemetry and cost tracking for Basquio v2 agents.
//
// This module provides:
// 1. Token usage aggregation per phase
// 2. Cost estimation per job
// 3. Alert thresholds for runaway agents
// 4. Structured logging for agent lifecycle events
//
// Integration points:
// - Langfuse: LLM call tracing (when LANGFUSE_SECRET_KEY is set)
// - OpenTelemetry: via AI SDK experimental_telemetry (when OTEL_EXPORTER_OTLP_ENDPOINT is set)
// - AnalysisNotebook: all tool calls persisted to Supabase (already wired in agents)

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type PhaseUsage = {
  phase: string;
  steps: number;
  usage: TokenUsage;
  toolCalls: number;
  durationMs: number;
  modelId?: string;
  provider?: string;
};

type JobCostSummary = {
  runId: string;
  phases: PhaseUsage[];
  totalUsage: TokenUsage;
  estimatedCostUsd: number;
  durationMs: number;
};

// ─── COST ESTIMATION ──────────────────────────────────────────────
// Pricing as of March 2026

const PRICING: Record<string, { input: number; output: number }> = {
  // Per million tokens
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5": { input: 2.0, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.1, output: 0.5 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export function estimateCost(modelId: string, usage: TokenUsage): number {
  const pricing = PRICING[modelId] ?? PRICING["gpt-5.4"]; // fallback
  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output
  );
}

// ─── USAGE TRACKER ────────────────────────────────────────────────

export class UsageTracker {
  private phases: PhaseUsage[] = [];
  private currentPhase: PhaseUsage | null = null;
  private phaseStartTime: number = 0;

  startPhase(phase: string, modelId?: string, provider?: string) {
    this.currentPhase = {
      phase,
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      toolCalls: 0,
      durationMs: 0,
      modelId,
      provider,
    };
    this.phaseStartTime = Date.now();
  }

  recordStep(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }, toolCallCount: number) {
    if (!this.currentPhase) return;

    this.currentPhase.steps++;
    this.currentPhase.usage.inputTokens += usage.inputTokens ?? 0;
    this.currentPhase.usage.outputTokens += usage.outputTokens ?? 0;
    this.currentPhase.usage.totalTokens += usage.totalTokens ?? 0;
    this.currentPhase.toolCalls += toolCallCount;
  }

  endPhase() {
    if (!this.currentPhase) return;

    this.currentPhase.durationMs = Date.now() - this.phaseStartTime;
    this.phases.push(this.currentPhase);
    this.currentPhase = null;
  }

  getCurrentModelId(): string | undefined {
    return this.currentPhase?.modelId;
  }

  getCurrentProvider(): string | undefined {
    return this.currentPhase?.provider;
  }

  getCurrentPhaseUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
    return this.currentPhase?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  getSummary(runId: string): JobCostSummary {
    const totalUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    let estimatedCostUsd = 0;
    let totalDurationMs = 0;

    for (const phase of this.phases) {
      totalUsage.inputTokens += phase.usage.inputTokens;
      totalUsage.outputTokens += phase.usage.outputTokens;
      totalUsage.totalTokens += phase.usage.totalTokens;
      totalDurationMs += phase.durationMs;

      if (phase.modelId) {
        estimatedCostUsd += estimateCost(phase.modelId, phase.usage);
      }
    }

    return {
      runId,
      phases: this.phases,
      totalUsage,
      estimatedCostUsd,
      durationMs: totalDurationMs,
    };
  }
}

// ─── COST ALERTS ──────────────────────────────────────────────────

const DEFAULT_COST_BUDGET_USD = 1.0; // Per deck — non-negotiable product rule

export function checkCostBudget(
  summary: JobCostSummary,
  budgetUsd: number = DEFAULT_COST_BUDGET_USD,
): { exceeded: boolean; message?: string } {
  if (summary.estimatedCostUsd > budgetUsd) {
    return {
      exceeded: true,
      message: `Job ${summary.runId} exceeded cost budget: $${summary.estimatedCostUsd.toFixed(2)} > $${budgetUsd.toFixed(2)}`,
    };
  }

  // Alert if approaching budget (>80%)
  if (summary.estimatedCostUsd > budgetUsd * 0.8) {
    return {
      exceeded: false,
      message: `Job ${summary.runId} approaching cost budget: $${summary.estimatedCostUsd.toFixed(2)} / $${budgetUsd.toFixed(2)} (${Math.round((summary.estimatedCostUsd / budgetUsd) * 100)}%)`,
    };
  }

  return { exceeded: false };
}

// ─── STRUCTURED LOGGING ───────────────────────────────────────────

export function logPhaseEvent(
  runId: string,
  phase: string,
  event: string,
  data?: Record<string, unknown>,
) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "basquio-v2",
    runId,
    phase,
    event,
    ...data,
  };

  // Structured JSON logging — compatible with any log aggregator
  console.log(JSON.stringify(entry));
}
