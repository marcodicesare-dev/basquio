import "server-only";

import { createHash } from "node:crypto";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

type ToolStatus = "success" | "error" | "timeout";

type TelemetryContext = {
  conversationId: string | null;
  userId: string;
};

export async function withChatToolTelemetry<T>(input: {
  conversationId: string;
  userId: string;
  toolName: string;
  inputHash: string;
  execute: () => Promise<T>;
}): Promise<T> {
  const startedAt = new Date();
  const startedMs = Date.now();
  try {
    const result = await input.execute();
    const errorMessage = inferReturnedError(result);
    await insertTelemetry({
      conversation_id: input.conversationId,
      user_id: input.userId,
      tool_name: input.toolName,
      input_hash: input.inputHash,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      status: errorMessage ? "error" : "success",
      error_message: errorMessage,
      result_size_bytes: measureJsonBytes(result),
    });
    return result;
  } catch (error) {
    await insertTelemetry({
      conversation_id: input.conversationId,
      user_id: input.userId,
      tool_name: input.toolName,
      input_hash: input.inputHash,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      status: "error",
      error_message: formatError(error),
      result_size_bytes: 0,
    });
    throw error;
  }
}

export function wrapChatTool<T extends object>(
  toolName: string,
  ctx: TelemetryContext,
  toolDef: T,
): T {
  const executable = toolDef as T & {
    execute?: (...args: unknown[]) => unknown;
  };
  if (typeof executable.execute !== "function") return toolDef;
  const originalExecute = executable.execute.bind(toolDef);
  return {
    ...toolDef,
    execute: (async (...args: unknown[]) => {
      const toolInput = args[0];
      try {
        return await withChatToolTelemetry({
          conversationId: ctx.conversationId ?? "no-conversation",
          userId: ctx.userId,
          toolName,
          inputHash: hashToolInput(toolInput),
          execute: async () => originalExecute(...args),
        });
      } catch (error) {
        return {
          error: `${toolName} failed: ${formatError(error)}`,
        };
      }
    }) as typeof executable.execute,
  } as T;
}

export function hashToolInput(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

async function insertTelemetry(row: {
  conversation_id: string;
  user_id: string;
  tool_name: string;
  input_hash: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: ToolStatus;
  error_message: string | null;
  result_size_bytes: number;
}): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const db = createServiceSupabaseClient(url, key);
    const { error } = await db.from("chat_tool_telemetry").insert(row);
    if (isMissingTableError(error)) return;
    if (error) {
      console.error("[chat-tool-telemetry] insert failed", error);
    }
  } catch (error) {
    console.error("[chat-tool-telemetry] insert failed", error);
  }
}

function inferReturnedError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (record.ok === false) {
    if (typeof record.reason === "string" && record.reason.trim()) return record.reason;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    return "Tool returned ok=false.";
  }
  if (record.status === "error" && typeof record.message === "string") return record.message;
  return null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function measureJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return 0;
  }
}

function stableStringify(input: unknown): string {
  return JSON.stringify(stableValue(input)) ?? "null";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableValue(record[key]);
      return acc;
    }, {});
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "PGRST205" || String(record.message ?? "").includes("schema cache");
}

/* ────────────────────────────────────────────────────────────
 * Memory v1 Brief 2: per-turn aggregate telemetry
 *
 * One row per chat turn with tool_name='__chat_turn__' carrying:
 *   - cache_creation_input_tokens, cache_read_input_tokens (Anthropic Messages
 *     API usage object)
 *   - total_input_tokens, total_output_tokens, cost_usd
 *   - intents, active_tools, classifier_entities, classifier_as_of,
 *     classifier_needs_web (router output)
 *
 * Emitted from the chat route's onFinish handler when CHAT_ROUTER_V2_ENABLED
 * is true. Existing per-tool-call rows (status='success'/'error'/'timeout',
 * tool_name=<actual>) leave the new columns NULL.
 *
 * Spec: docs/research/2026-04-25-sota-implementation-specs.md §5, §6.
 * Schema: supabase/migrations/20260428130000_chat_tool_telemetry_cache_stats.sql
 * ──────────────────────────────────────────────────────────── */

export type ChatTurnTelemetryInput = {
  conversationId: string;
  userId: string;
  startedAt: Date;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  costUsd: number | null;
  intents: string[] | null;
  activeTools: string[] | null;
  classifierEntities: string[] | null;
  classifierAsOf: string | null;
  classifierNeedsWeb: boolean | null;
  errorMessage: string | null;
};

const SONNET_INPUT_COST_PER_MTOK = 3.0;
const SONNET_OUTPUT_COST_PER_MTOK = 15.0;
const SONNET_CACHE_WRITE_5M_PER_MTOK = 3.75;
const SONNET_CACHE_WRITE_1H_PER_MTOK = 6.0;
const SONNET_CACHE_READ_PER_MTOK = 0.3;

/**
 * Compute a turn cost from the Anthropic usage breakdown. Conservative:
 * assumes Sonnet 4.6 pricing and treats every cache_creation token as 5-min
 * write (the most common path; 1-hour write is the static prompt, ~10K tokens
 * which is small relative to the rest). The chat route may pass a precomputed
 * cost when it has more granular input.
 */
export function estimateChatTurnCostUsd(input: {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  staticBlockTokens?: number;
}): number {
  const staticTokens = Math.min(
    input.staticBlockTokens ?? 0,
    input.cacheCreationInputTokens,
  );
  const fiveMinCacheWriteTokens = Math.max(
    0,
    input.cacheCreationInputTokens - staticTokens,
  );
  const oneHourCacheWriteTokens = staticTokens;

  const cost =
    (input.inputTokens / 1_000_000) * SONNET_INPUT_COST_PER_MTOK +
    (input.outputTokens / 1_000_000) * SONNET_OUTPUT_COST_PER_MTOK +
    (fiveMinCacheWriteTokens / 1_000_000) * SONNET_CACHE_WRITE_5M_PER_MTOK +
    (oneHourCacheWriteTokens / 1_000_000) * SONNET_CACHE_WRITE_1H_PER_MTOK +
    (input.cacheReadInputTokens / 1_000_000) * SONNET_CACHE_READ_PER_MTOK;
  return Math.round(cost * 10_000) / 10_000;
}

export async function recordChatTurnTelemetry(
  input: ChatTurnTelemetryInput,
): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const db = createServiceSupabaseClient(url, key);
    const completedAt = new Date();
    const { error } = await db.from("chat_tool_telemetry").insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      tool_name: "__chat_turn__",
      input_hash: null,
      started_at: input.startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - input.startedAt.getTime(),
      status: input.errorMessage ? "error" : "success",
      error_message: input.errorMessage,
      result_size_bytes: 0,
      cache_creation_input_tokens: input.cacheCreationInputTokens,
      cache_read_input_tokens: input.cacheReadInputTokens,
      total_input_tokens: input.totalInputTokens,
      total_output_tokens: input.totalOutputTokens,
      cost_usd: input.costUsd,
      intents: input.intents,
      active_tools: input.activeTools,
      classifier_entities: input.classifierEntities,
      classifier_as_of: input.classifierAsOf,
      classifier_needs_web: input.classifierNeedsWeb,
    });
    if (isMissingTableError(error)) return;
    if (error) {
      console.error("[chat-tool-telemetry] turn aggregate insert failed", error);
    }
  } catch (error) {
    console.error("[chat-tool-telemetry] turn aggregate insert threw", error);
  }
}
