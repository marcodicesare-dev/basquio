/**
 * Credit ledger operations for per-slide billing.
 *
 * Pricing model: 3 base credits + 1 credit per slide.
 * A 10-slide deck costs 13 credits. A 3-slide deck costs 6 credits.
 *
 * Uses Supabase RPC to call the atomic PostgreSQL functions
 * defined in 20260324100000_credit_ledger.sql.
 */

// ─── CREDIT CALCULATION ──────────────────────────────────────

/** Fixed credits per run (covers understand + QA phases) */
export const BASE_CREDITS = 3;

/** Credits per slide (covers author + potential revise per slide) */
export const CREDITS_PER_SLIDE = 1;

/** Free tier grant amount (enough for one 3-slide deck) */
export const FREE_TIER_CREDITS = 6;

/**
 * Calculate credits required for a deck run.
 */
export function calculateRunCredits(slideCount: number): number {
  return BASE_CREDITS + (CREDITS_PER_SLIDE * slideCount);
}

// ─── TYPES ───────────────────────────────────────────────────

type SupabaseConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

type CreditBalance = {
  balance: number;
  freeGrantsCount: number;
  totalRuns: number;
};

// ─── BALANCE ─────────────────────────────────────────────────

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

// ─── GRANTS ──────────────────────────────────────────────────

/**
 * Grant free tier credits if not already granted.
 * Grants FREE_TIER_CREDITS (6) — enough for one 3-slide deck.
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
 * Grant credits after a successful Stripe payment.
 */
export async function grantPurchaseCredits(
  config: SupabaseConfig & {
    userId: string;
    amount: number;
    reason: "purchase_pack";
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

// ─── DEBITS ──────────────────────────────────────────────────

/**
 * Attempt to debit credits for a deck run based on slide count.
 * Returns true if successful, false if insufficient balance, null if system unavailable.
 * Uses PostgreSQL advisory locks for atomic debit.
 */
export async function checkAndDebitCredit(
  config: SupabaseConfig & { userId: string; runId: string; slideCount: number },
): Promise<boolean | null> {
  const creditsNeeded = calculateRunCredits(config.slideCount);

  const result = await callRpc<boolean>(config, "debit_credit", {
    p_user_id: config.userId,
    p_amount: creditsNeeded,
    p_reason: "run_debit",
    p_reference_id: config.runId,
  });

  return result;
}

/**
 * Refund credits for a failed run.
 * Looks up the original debit amount from the ledger and refunds exactly that.
 */
export async function refundCredit(
  config: SupabaseConfig & { userId: string; runId: string },
): Promise<void> {
  // Find the original debit for this run
  const debits = await queryRest<{ amount: number }>(config, "credit_ledger", {
    reference_id: `eq.${config.runId}`,
    reason: "eq.run_debit",
    select: "amount",
    limit: "1",
  });

  // Amount is stored as negative in the debit, so negate it for refund
  const refundAmount = debits.length > 0 ? Math.abs(debits[0].amount) : 0;

  if (refundAmount === 0) {
    return; // No debit found — nothing to refund
  }

  await insertRow(config, "credit_ledger", {
    user_id: config.userId,
    amount: refundAmount,
    reason: "refund",
    reference_id: config.runId,
  });
}

// ─── IDEMPOTENCY ─────────────────────────────────────────────

/**
 * Check if a Stripe payment_intent has already been processed.
 * Used for webhook idempotency — prevents double-crediting on retries.
 */
export async function checkPaymentAlreadyProcessed(
  config: SupabaseConfig & { paymentIntentId: string },
): Promise<boolean> {
  const rows = await queryRest<{ id: string }>(config, "credit_ledger", {
    reference_id: `eq.${config.paymentIntentId}`,
    reason: "eq.purchase_pack",
    select: "id",
    limit: "1",
  });

  return rows.length > 0;
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

  if (serviceKey.split(".").length === 3) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}
