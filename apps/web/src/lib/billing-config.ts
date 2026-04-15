/**
 * Billing configuration: tier mapping, plan definitions, and credit pack pricing.
 *
 * UI shows Memo/Deck/Deep-Dive. Internal code uses claude-* model names.
 * This file is the single source of truth for pricing copy and Stripe resolution.
 */

// ─── TIER CONFIG (output types) ─────────────────────────────────────

export const TIER_CONFIG = {
  memo: {
    model: "claude-haiku-4-5" as const,
    label: "Memo",
    description: "Written analysis and data workbook. No slides.",
    shortDescription: "Fast, no slides",
    estimatedTime: "~2 min",
    artifacts: ["XLSX", "MD"],
  },
  deck: {
    model: "claude-sonnet-4-6" as const,
    label: "Deck",
    description: "Full deck with real charts, written analysis, and data workbook.",
    shortDescription: "Full deck with charts",
    estimatedTime: "~15 min",
    artifacts: ["PPTX", "MD", "XLSX"],
  },
  "deep-dive": {
    model: "claude-opus-4-6" as const,
    label: "Deep-Dive",
    description: "Consulting-grade depth. The full treatment.",
    shortDescription: "Maximum analytical depth",
    estimatedTime: "~25 min",
    artifacts: ["PPTX", "MD", "XLSX"],
  },
} as const;

export type TierId = keyof typeof TIER_CONFIG;
export type AuthorModel = (typeof TIER_CONFIG)[TierId]["model"];

export function tierToModel(tier: TierId): AuthorModel {
  return TIER_CONFIG[tier].model;
}

export function modelToTier(model: string): TierId {
  for (const [id, config] of Object.entries(TIER_CONFIG)) {
    if (config.model === model) return id as TierId;
  }
  return "deck";
}

// ─── PLAN DEFINITIONS ───────────────────────────────────────

export type PlanId = "free" | "starter" | "pro" | "enterprise";
export type PackPricingTier = "free" | "starter" | "pro";

export interface PlanConfig {
  label: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  annualPrice: number;
  creditsIncluded: number;
  templateSlots: number;
  features: string[];
  highlight: boolean;
}

export const PLAN_CONFIG: Record<PlanId, PlanConfig> = {
  free: {
    label: "Free",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    annualPrice: 0,
    creditsIncluded: 0,
    templateSlots: 0,
    features: [
      "15 free credits (~1 Deck run)",
      "Basquio branding on output",
      "Community templates only",
    ],
    highlight: false,
  },
  starter: {
    label: "Starter",
    monthlyPrice: 19,
    annualMonthlyPrice: 16,
    annualPrice: 190,
    creditsIncluded: 30,
    templateSlots: 2,
    features: [
      "No branding on output",
      "30 credits/month",
      "2 custom template slots",
      "Community support",
    ],
    highlight: true,
  },
  pro: {
    label: "Pro",
    monthlyPrice: 149,
    annualMonthlyPrice: 124,
    annualPrice: 1490,
    creditsIncluded: 200,
    templateSlots: 5,
    features: [
      "No branding on output",
      "200 credits/month",
      "5 custom template slots",
      "Priority generation queue",
      "Email support",
    ],
    highlight: false,
  },
  enterprise: {
    label: "Enterprise",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    annualPrice: 0,
    creditsIncluded: 0,
    templateSlots: 0,
    features: [
      "Custom credits and billing",
      "Custom template setup",
      "Shared workspace and controls",
      "Priority support",
    ],
    highlight: false,
  },
};

export function normalizePlanId(plan: string | null | undefined): PlanId {
  if (plan === "starter" || plan === "pro" || plan === "enterprise" || plan === "free") {
    return plan;
  }
  if (plan === "team") {
    return "enterprise";
  }
  return "free";
}

export function planToCreditPackTier(plan: string | null | undefined): PackPricingTier {
  const normalized = normalizePlanId(plan);
  if (normalized === "starter") return "starter";
  if (normalized === "pro" || normalized === "enterprise") return "pro";
  return "free";
}

// ─── CREDIT PACKS ───────────────────────────────────────────

export const CREDIT_PACK_CATALOG = {
  pack_25: { credits: 25 },
  pack_50: { credits: 50 },
  pack_100: { credits: 100 },
  pack_250: { credits: 250 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACK_CATALOG;

export interface CreditPackConfig {
  credits: number;
  price: number;
  perCredit: number;
  discount: string;
}

export const CREDIT_PACKS_CONFIG: Record<PackPricingTier, Record<CreditPackId, CreditPackConfig>> = {
  free: {
    pack_25: { credits: 25, price: 22, perCredit: 0.88, discount: "standard" },
    pack_50: { credits: 50, price: 44, perCredit: 0.88, discount: "standard" },
    pack_100: { credits: 100, price: 88, perCredit: 0.88, discount: "standard" },
    pack_250: { credits: 250, price: 220, perCredit: 0.88, discount: "standard" },
  },
  starter: {
    pack_25: { credits: 25, price: 17.5, perCredit: 0.7, discount: "subscriber" },
    pack_50: { credits: 50, price: 35, perCredit: 0.7, discount: "subscriber" },
    pack_100: { credits: 100, price: 70, perCredit: 0.7, discount: "subscriber" },
    pack_250: { credits: 250, price: 175, perCredit: 0.7, discount: "subscriber" },
  },
  pro: {
    pack_25: { credits: 25, price: 12.5, perCredit: 0.5, discount: "best" },
    pack_50: { credits: 50, price: 25, perCredit: 0.5, discount: "best" },
    pack_100: { credits: 100, price: 50, perCredit: 0.5, discount: "best" },
    pack_250: { credits: 250, price: 125, perCredit: 0.5, discount: "best" },
  },
};

export function getCreditPackConfig(
  tier: PackPricingTier,
  packId: CreditPackId,
): CreditPackConfig {
  return CREDIT_PACKS_CONFIG[tier][packId];
}

// ─── PRICE ENV VAR RESOLVER ─────────────────────────────────

export function getStripePriceId(identifier: string): string {
  const envKey = `STRIPE_PRICE_${identifier.toUpperCase()}`;
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`${envKey} environment variable is required.`);
  }
  return priceId;
}

export function planPriceIdentifier(plan: Exclude<PlanId, "free" | "enterprise">, interval: "monthly" | "annual"): string {
  return `${plan}_${interval}`;
}
