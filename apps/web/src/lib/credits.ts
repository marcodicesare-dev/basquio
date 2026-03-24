/**
 * Credit ledger operations for per-deck billing.
 *
 * Uses Supabase RPC to call the atomic PostgreSQL functions
 * defined in 20260324100000_credit_ledger.sql.
 */

type SupabaseConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

type CreditBalance = {
  balance: number;
  freeGrantsCount: number;
  totalRuns: number;
};

/**
 * Get the current credit balance for a user.
 */
export async function getCreditBalance(
  config: SupabaseConfig & { userId: string },
): Promise<CreditBalance> {
  const rows = await queryRest<{
    balance: number;
    free_grants_count: number;
    total_runs: number;
  }>(config, "credit_balances", {
    user_id: `eq.${config.userId}`,
    select: "balance,free_grants_count,total_runs",
    limit: "1",
  });

  if (rows.length === 0) {
    return { balance: 0, freeGrantsCount: 0, totalRuns: 0 };
  }

  return {
    balance: rows[0].balance,
    freeGrantsCount: rows[0].free_grants_count,
    totalRuns: rows[0].total_runs,
  };
}

/**
 * Grant the free tier credit (1 credit) if not already granted.
 * Safe to call multiple times — only grants once.
 */
export async function ensureFreeTierCredit(
  config: SupabaseConfig & { userId: string },
): Promise<boolean> {
  const result = await callRpc<boolean>(config, "grant_free_tier_credit", {
    p_user_id: config.userId,
  });

  return result ?? false;
}

/**
 * Attempt to debit 1 credit for a deck run.
 * Returns true if successful, false if insufficient balance.
 * Uses PostgreSQL advisory locks for atomic debit.
 */
export async function checkAndDebitCredit(
  config: SupabaseConfig & { userId: string; runId: string },
): Promise<boolean> {
  const result = await callRpc<boolean>(config, "debit_credit", {
    p_user_id: config.userId,
    p_amount: 1,
    p_reason: "run_debit",
    p_reference_id: config.runId,
  });

  return result ?? false;
}

/**
 * Grant credits after a successful Stripe payment.
 */
export async function grantPurchaseCredits(
  config: SupabaseConfig & {
    userId: string;
    amount: number;
    reason: "purchase_standard" | "purchase_pro" | "purchase_pack";
    paymentIntentId: string;
  },
): Promise<void> {
  await insertRow(config, "credit_ledger", {
    user_id: config.userId,
    amount: config.amount,
    reason: config.reason,
    reference_id: config.paymentIntentId,
  });
}

/**
 * Check if a Stripe payment_intent has already been processed.
 * Used for webhook idempotency — prevents double-crediting on retries.
 */
export async function checkPaymentAlreadyProcessed(
  config: SupabaseConfig & { paymentIntentId: string },
): Promise<boolean> {
  const rows = await queryRest<{ id: string }>(config, "credit_ledger", {
    reference_id: `eq.${config.paymentIntentId}`,
    reason: "in.(purchase_standard,purchase_pro,purchase_pack)",
    select: "id",
    limit: "1",
  });

  return rows.length > 0;
}

/**
 * Refund a credit for a failed run.
 */
export async function refundCredit(
  config: SupabaseConfig & { userId: string; runId: string },
): Promise<void> {
  await insertRow(config, "credit_ledger", {
    user_id: config.userId,
    amount: 1,
    reason: "refund",
    reference_id: config.runId,
  });
}

// ─── INTERNAL HELPERS ─────────────────────────────────────────

async function queryRest<T>(
  config: SupabaseConfig,
  table: string,
  query: Record<string, string>,
): Promise<T[]> {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: buildHeaders(config.serviceKey),
    cache: "no-store",
  });

  if (!response.ok) {
    // Table might not exist yet (migration not applied) — return empty
    return [];
  }

  return (await response.json()) as T[];
}

async function callRpc<T>(
  config: SupabaseConfig,
  functionName: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const url = new URL(`/rest/v1/rpc/${functionName}`, config.supabaseUrl);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...Object.fromEntries(buildHeaders(config.serviceKey).entries()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    cache: "no-store",
  });

  if (!response.ok) {
    // Function might not exist yet (migration not applied) — return null
    // This allows the app to work without the credit system deployed
    return null;
  }

  return (await response.json()) as T;
}

async function insertRow(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...Object.fromEntries(buildHeaders(config.serviceKey).entries()),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to insert into ${table}: ${text}`);
  }
}

function buildHeaders(serviceKey: string): Headers {
  const headers = new Headers();
  headers.set("apikey", serviceKey);
  headers.set("Accept", "application/json");

  // Support both JWT-style and secret key auth
  if (serviceKey.split(".").length === 3) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}
