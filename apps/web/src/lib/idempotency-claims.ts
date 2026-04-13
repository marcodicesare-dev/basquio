import { createServiceSupabaseClient } from "@/lib/supabase/admin";

type IdempotencyConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

type ClaimInput = {
  id: string;
  scope: string;
  metadata?: Record<string, unknown>;
  staleAfterSeconds?: number;
};

export async function claimServiceIdempotencyKey(
  config: IdempotencyConfig,
  input: ClaimInput,
): Promise<boolean> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const { data, error } = await supabase.rpc("claim_service_idempotency_key", {
    p_id: input.id,
    p_scope: input.scope,
    p_metadata: input.metadata ?? {},
    p_stale_after_seconds: input.staleAfterSeconds ?? 900,
  });

  if (error) {
    throw error;
  }

  return data === true;
}

export async function completeServiceIdempotencyKey(
  config: IdempotencyConfig,
  input: {
    id: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("service_idempotency_keys")
    .update({
      status: "completed",
      metadata: input.metadata ?? {},
      completed_at: now,
      updated_at: now,
    })
    .eq("id", input.id);

  if (error) {
    throw error;
  }
}

export async function releaseServiceIdempotencyKey(
  config: IdempotencyConfig,
  id: string,
): Promise<void> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const { error } = await supabase
    .from("service_idempotency_keys")
    .delete()
    .eq("id", id)
    .eq("status", "claimed");

  if (error) {
    throw error;
  }
}
