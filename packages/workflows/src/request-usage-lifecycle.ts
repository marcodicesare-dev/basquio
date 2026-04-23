import { patchRestRows } from "./supabase";

type WorkerConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

export type RequestUsageTerminalStatus =
  | "completed"
  | "failed"
  | "failed_transient"
  | "interrupted_shutdown"
  | "stale_timeout"
  | "superseded";

export function buildRequestUsageTerminalPayload(
  status: RequestUsageTerminalStatus,
  completedAt: string,
  note?: string,
) {
  return {
    completed_at: completedAt,
    usage: {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      status,
      ...(note ? { note } : {}),
    },
  };
}

export async function closeOpenRequestUsageRows(input: {
  config: WorkerConfig;
  attemptId: string;
  status: RequestUsageTerminalStatus;
  completedAt?: string;
  note?: string;
}) {
  const completedAt = input.completedAt ?? new Date().toISOString();
  await patchRestRows({
    supabaseUrl: input.config.supabaseUrl,
    serviceKey: input.config.serviceKey,
    table: "deck_run_request_usage",
    query: {
      attempt_id: `eq.${input.attemptId}`,
      completed_at: "is.null",
    },
    payload: buildRequestUsageTerminalPayload(input.status, completedAt, input.note),
  }).catch(() => {});
}
