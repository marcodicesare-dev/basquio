/**
 * Credit operations for billing.
 *
 * Credit formula:
 *   Memo (Haiku): 3 flat
 *   Deck (Sonnet): 3 + first 10 slides at 1 each, then 2 each
 *   Deep-Dive (Opus): 5 + 2/slide
 *
 * Balance source of truth: credit_grants table (FIFO consumption by earliest expiry).
 * Legacy credit_ledger kept as audit trail.
 */

// ─── CREDIT CALCULATION ──────────────────────────────────────

/** Baseline credits used by Deck math and legacy pricing surfaces. */
export const BASE_CREDITS = 3;

/** Legacy/default per-slide slope for the first 10 Sonnet slides. */
export const CREDITS_PER_SLIDE = 1;

/** Free tier grant amount. Must not exceed Starter's included credits. */
export const FREE_TIER_CREDITS = 15;

export const MIN_TARGET_SLIDES = 1;
export const MAX_TARGET_SLIDES = 30;

export const DEFAULT_AUTHOR_MODEL = "claude-sonnet-4-6";

/**
 * Calculate credits required for a deck run.
 * Memo=3 flat, Deck=3+1/slide for first 10 then +2/slide, Deep-Dive=5+2/slide.
 */
export function calculateRunCredits(slideCount: number, model: string = DEFAULT_AUTHOR_MODEL): number {
  if (model === "claude-haiku-4-5") {
    return 3;
  }
  const slides = assertValidSlideCount(slideCount);
  if (model === "claude-opus-4-6") {
    return 5 + (2 * slides);
  }
  const firstTen = Math.min(slides, 10);
  const overTen = Math.max(slides - 10, 0);
  return BASE_CREDITS + firstTen + (2 * overTen);
}

export function maxAffordableSlides(balance: number, model: string = DEFAULT_AUTHOR_MODEL): number {
  for (let slides = MAX_TARGET_SLIDES; slides >= MIN_TARGET_SLIDES; slides -= 1) {
    if (calculateRunCredits(slides, model) <= balance) {
      return slides;
    }
  }
  return 0;
}

export function assertValidSlideCount(slideCount: number): number {
  if (!Number.isInteger(slideCount) || slideCount < MIN_TARGET_SLIDES || slideCount > MAX_TARGET_SLIDES) {
    throw new Error(`targetSlideCount must be an integer between ${MIN_TARGET_SLIDES} and ${MAX_TARGET_SLIDES}.`);
  }

  return slideCount;
}

// ─── TIME ESTIMATES ─────────────────────────────────────────
// Derived from production run data (100 completed runs, April 2026).
// Linear model: base_minutes + per_slide_minutes * slideCount.
// Base accounts for container setup, QA, export — fixed overhead regardless of slides.
// Outliers (stuck runs > 120 min) excluded from the regression.

const TIME_MODEL: Record<string, { baseMinutes: number; perSlideMinutes: number }> = {
  "claude-haiku-4-5":  { baseMinutes: 8,  perSlideMinutes: 0.7 },
  "claude-sonnet-4-6": { baseMinutes: 12, perSlideMinutes: 1.0 },
  "claude-opus-4-6":   { baseMinutes: 12, perSlideMinutes: 0.75 },
};

/**
 * Estimate total run time in minutes based on model and slide count.
 * Haiku is memo-only (no slides) — flat 10 min regardless of slide count.
 * Returns a round number suitable for UI display ("~22 min").
 */
export function estimateRunMinutes(slideCount: number, model: string = DEFAULT_AUTHOR_MODEL): number {
  if (model === "claude-haiku-4-5") return 10;
  const params = TIME_MODEL[model] ?? TIME_MODEL[DEFAULT_AUTHOR_MODEL];
  const raw = params.baseMinutes + params.perSlideMinutes * slideCount;
  return Math.round(raw);
}

// ─── TYPES ───────────────────────────────────────────────────

type SupabaseConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

export type CreditBalance = {
  balance: number;
  freeGrantsCount: number;
  totalRuns: number;
};

export type DetailedCreditBalance = CreditBalance & {
  subscriptionCredits: number;
  purchasedCredits: number;
  promotionalCredits: number;
  freeCredits: number;
};

export type RefundCreditResult =
  | { status: "refunded"; amount: number }
  | { status: "already_refunded"; amount: number }
  | { status: "no_debit_found"; amount: 0 };

// ─── BALANCE ─────────────────────────────────────────────────

/**
 * Get the current credit balance for a user.
 * Reads from credit_grants (source of truth) with expiry filtering.
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
 * Get detailed credit balance broken down by source.
 */
export async function getDetailedCreditBalance(
  config: SupabaseConfig & { userId: string },
): Promise<DetailedCreditBalance> {
  const grants = await queryRest<{
    source: string;
    remaining: number;
    expires_at: string;
  }>(config, "credit_grants", {
    user_id: `eq.${config.userId}`,
    remaining: "gt.0",
    expires_at: `gt.${new Date().toISOString()}`,
    select: "source,remaining,expires_at",
  });

  const basic = await getCreditBalance(config);

  return {
    ...basic,
    subscriptionCredits: grants.filter(g => g.source === "subscription").reduce((s, g) => s + g.remaining, 0),
    purchasedCredits: grants.filter(g => g.source === "purchase").reduce((s, g) => s + g.remaining, 0),
    promotionalCredits: grants.filter(g => g.source === "promotional").reduce((s, g) => s + g.remaining, 0),
    freeCredits: grants.filter(g => g.source === "free_tier").reduce((s, g) => s + g.remaining, 0),
  };
}

// ─── GRANTS ──────────────────────────────────────────────────

/**
 * Grant free tier credits if not already granted.
 * Grants the free tier credit amount once.
 * Safe to call multiple times — only grants once.
 */
export async function ensureFreeTierCredit(
  config: SupabaseConfig & { userId: string },
): Promise<boolean> {
  const result = await callRpc<boolean>(config, "grant_free_tier_credit_v2", {
    p_user_id: config.userId,
  });

  return result ?? false;
}

/**
 * Grant credits after a successful Stripe credit pack payment.
 * Creates a credit_grant with 12-month expiry + audit trail in credit_ledger.
 */
export async function grantPurchaseCredits(
  config: SupabaseConfig & {
    userId: string;
    amount: number;
    reason: "purchase_pack";
    paymentIntentId: string;
  },
): Promise<void> {
  // Insert into credit_grants (source of truth) — idempotent via stripe_event_id unique index
  try {
    await insertRow(config, "credit_grants", {
      user_id: config.userId,
      source: "purchase",
      original_amount: config.amount,
      remaining: config.amount,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      stripe_event_id: config.paymentIntentId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      console.log(`[credits] purchase grant already exists for pi=${config.paymentIntentId}, skipping`);
      return;
    }
    throw err;
  }

  // Audit trail in legacy credit_ledger (best-effort — credit_grants is source of truth)
  try {
    await insertRow(config, "credit_ledger", {
      user_id: config.userId,
      amount: config.amount,
      reason: config.reason,
      reference_id: config.paymentIntentId,
    });
  } catch {
    // Duplicate from webhook redelivery — credit_grants insert is what matters
  }
}

/**
 * Grant subscription credits (monthly allocation).
 * Creates a credit_grant with expiry = period_end + 1 month (1-month rollover).
 */
export async function grantSubscriptionCredits(
  config: SupabaseConfig & {
    userId: string;
    amount: number;
    periodEnd: string; // ISO date of subscription period end
    stripeEventId: string;
  },
): Promise<void> {
  const periodEndDate = new Date(config.periodEnd);
  // Credits roll over for 1 month past the period end
  const expiresAt = new Date(periodEndDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Idempotent via stripe_event_id unique index — safe for webhook redelivery
  try {
    await insertRow(config, "credit_grants", {
      user_id: config.userId,
      source: "subscription",
      original_amount: config.amount,
      remaining: config.amount,
      expires_at: expiresAt.toISOString(),
      stripe_event_id: config.stripeEventId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      console.log(`[credits] subscription grant already exists for event=${config.stripeEventId}, skipping`);
      return;
    }
    throw err;
  }

  // Audit trail (best-effort — credit_grants is source of truth)
  try {
    await insertRow(config, "credit_ledger", {
      user_id: config.userId,
      amount: config.amount,
      reason: "subscription_grant",
      reference_id: config.stripeEventId,
    });
  } catch {
    // Duplicate or other error — credit_grants insert is what matters
  }
}

// ─── DEBITS ──────────────────────────────────────────────────

/**
 * Attempt to debit credits for a run using FIFO consumption.
 * Returns true if successful, false if insufficient balance, null if system unavailable.
 * Uses the debit_credits_fifo RPC with advisory locks.
 */
export async function checkAndDebitCredit(
  config: SupabaseConfig & { userId: string; runId: string; slideCount: number; authorModel?: string },
): Promise<boolean | null> {
  const creditsNeeded = calculateRunCredits(config.slideCount, config.authorModel);

  const result = await callRpc<Array<{ success: boolean; balance_after: number }>>(
    config,
    "debit_credits_fifo",
    {
      p_user_id: config.userId,
      p_amount: creditsNeeded,
      p_reason: "run_debit",
      p_reference_id: config.runId,
    },
  );

  if (!result || !Array.isArray(result) || result.length === 0) {
    console.error("[credits] debit_credits_fifo returned unexpected result", result);
    return null;
  }

  return result[0].success;
}

/**
 * Refund credits for a failed run.
 * Looks up the original debit amount from the ledger and refunds exactly that.
 * Creates a new credit_grant for the refund amount.
 */
export async function refundCredit(
  config: SupabaseConfig & { userId: string; runId: string },
): Promise<RefundCreditResult> {
  // Find the original debit for this run (latest first in case of retry)
  const debits = await queryRest<{ amount: number }>(config, "credit_ledger", {
    reference_id: `eq.${config.runId}`,
    reason: "eq.run_debit",
    select: "amount",
    order: "created_at.desc",
    limit: "1",
  });

  // Amount is stored as negative in the debit, so negate it for refund
  const refundAmount = debits.length > 0 ? Math.abs(debits[0].amount) : 0;

  if (refundAmount === 0) {
    return { status: "no_debit_found", amount: 0 };
  }

  try {
    // Credit_grant for the refund (never expires — user earned it back)
    await insertRow(config, "credit_grants", {
      user_id: config.userId,
      source: "promotional", // refund treated as promotional grant
      original_amount: refundAmount,
      remaining: refundAmount,
      expires_at: "2099-12-31T00:00:00Z",
      stripe_event_id: `refund_${config.runId}`,
    });

    // Audit trail
    await insertRow(config, "credit_ledger", {
      user_id: config.userId,
      amount: refundAmount,
      reason: "refund",
      reference_id: config.runId,
    });
  } catch (error) {
    // Unique constraint on (reference_id WHERE reason='refund') prevents double-refund.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return { status: "already_refunded", amount: refundAmount };
    }
    throw error;
  }

  return { status: "refunded", amount: refundAmount };
}

// ─── IDEMPOTENCY ─────────────────────────────────────────────

/**
 * Check if a Stripe event has already been processed.
 * Uses stripe_webhook_events table for idempotency.
 */
export async function checkWebhookEventProcessed(
  config: SupabaseConfig & { eventId: string },
): Promise<boolean> {
  const rows = await queryRest<{ id: string }>(config, "stripe_webhook_events", {
    id: `eq.${config.eventId}`,
    select: "id",
    limit: "1",
  });
  return rows.length > 0;
}

/**
 * Mark a Stripe webhook event as processed.
 */
export async function markWebhookEventProcessed(
  config: SupabaseConfig & { eventId: string; eventType: string },
): Promise<void> {
  try {
    await insertRow(config, "stripe_webhook_events", {
      id: config.eventId,
      type: config.eventType,
      processed: true,
    });
  } catch (error) {
    // Duplicate insert is fine — means it was already processed
    const message = error instanceof Error ? error.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return;
    }
    throw error;
  }
}

/**
 * Check if a Stripe payment_intent has already been processed (legacy check).
 */
export async function checkPaymentAlreadyProcessed(
  config: SupabaseConfig & { paymentIntentId: string },
): Promise<boolean> {
  const rows = await queryRest<{ id: string }>(config, "credit_grants", {
    stripe_event_id: `eq.${config.paymentIntentId}`,
    select: "id",
    limit: "1",
  });

  return rows.length > 0;
}

// ─── SUBSCRIPTION HELPERS ───────────────────────────────────

/**
 * Get the active subscription for a user.
 */
export async function getActiveSubscription(
  config: SupabaseConfig & { userId: string },
): Promise<{
  plan: string;
  status: string;
  billing_interval: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  credits_included: number;
  template_slots_included: number;
} | null> {
  const rows = await queryRest<{
    plan: string;
    status: string;
    billing_interval: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    credits_included: number;
    template_slots_included: number;
  }>(config, "subscriptions", {
    user_id: `eq.${config.userId}`,
    status: "in.(active,past_due)",
    select: "plan,status,billing_interval,current_period_end,cancel_at_period_end,credits_included,template_slots_included",
    order: "created_at.desc",
    limit: "1",
  });

  return rows[0] ?? null;
}

/**
 * Upsert a subscription record from Stripe webhook data.
 * Uses two-step: check if exists by stripe_subscription_id, then insert or update.
 * PostgREST merge-duplicates with auto-generated PKs is unreliable.
 */
export async function upsertSubscription(
  config: SupabaseConfig & {
    userId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    plan: string;
    billingInterval: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    creditsIncluded: number;
    templateSlotsIncluded: number;
  },
): Promise<void> {
  // Check if subscription already exists
  const existing = await queryRest<{ id: string }>(config, "subscriptions", {
    stripe_subscription_id: `eq.${config.stripeSubscriptionId}`,
    select: "id",
    limit: "1",
  });

  const now = new Date().toISOString();

  if (existing.length > 0) {
    // Update existing subscription
    const url = new URL("/rest/v1/subscriptions", config.supabaseUrl);
    url.searchParams.set("stripe_subscription_id", `eq.${config.stripeSubscriptionId}`);

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        plan: config.plan,
        billing_interval: config.billingInterval,
        status: config.status,
        current_period_start: config.currentPeriodStart,
        current_period_end: config.currentPeriodEnd,
        cancel_at_period_end: config.cancelAtPeriodEnd,
        credits_included: config.creditsIncluded,
        template_slots_included: config.templateSlotsIncluded,
        updated_at: now,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`Failed to update subscription: ${text}`);
    }
  } else {
    // Insert new subscription
    await insertRow(config, "subscriptions", {
      user_id: config.userId,
      stripe_customer_id: config.stripeCustomerId,
      stripe_subscription_id: config.stripeSubscriptionId,
      plan: config.plan,
      billing_interval: config.billingInterval,
      status: config.status,
      current_period_start: config.currentPeriodStart,
      current_period_end: config.currentPeriodEnd,
      cancel_at_period_end: config.cancelAtPeriodEnd,
      credits_included: config.creditsIncluded,
      template_slots_included: config.templateSlotsIncluded,
      updated_at: now,
    });
  }
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
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to query ${table}: ${text}`);
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
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to execute RPC ${functionName}: ${text}`);
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
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Accept", "application/json");
  return headers;
}
