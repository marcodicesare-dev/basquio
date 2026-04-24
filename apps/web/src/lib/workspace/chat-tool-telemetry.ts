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
