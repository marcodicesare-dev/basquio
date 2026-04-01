"use client";

import { useState } from "react";
import Link from "next/link";

import { SubscribeButton } from "@/components/subscribe-button";

const plans = [
  {
    id: "free" as const,
    name: "Free",
    monthlyPrice: "$0",
    annualPrice: "$0",
    unit: "",
    description: "Try Basquio on real work. No credit card required.",
    features: [
      "40 free credits (~3 Deck runs)",
      "Basquio branding on output",
      "Community templates only",
    ],
    cta: { label: "Start free", href: "/sign-up" },
    highlight: false,
  },
  {
    id: "starter" as const,
    name: "Starter",
    monthlyPrice: "$29",
    annualPrice: "$23",
    unit: "/mo",
    description: "For individuals who run 2\u20133 decks a month.",
    features: [
      "No branding on output",
      "30 credits/month",
      "1 custom template slot",
      "Email support",
    ],
    cta: { label: "Subscribe", plan: "starter" },
    highlight: false,
  },
  {
    id: "pro" as const,
    name: "Pro",
    monthlyPrice: "$79",
    annualPrice: "$63",
    unit: "/mo",
    description: "For power users running 5\u20138 decks a month.",
    features: [
      "No branding on output",
      "100 credits/month",
      "5 custom template slots",
      "Priority generation queue",
      "Narrative reports",
    ],
    cta: { label: "Subscribe", plan: "pro" },
    highlight: true,
    badge: "Most popular",
  },
  {
    id: "team" as const,
    name: "Team",
    monthlyPrice: "$149",
    annualPrice: "$119",
    unit: "/mo",
    description: "Shared workspace for teams that run the same reporting motion.",
    features: [
      "Shared workspace",
      "200 credits/month pool",
      "10 custom template slots",
      "Billing controls",
      "+$29/seat/month",
    ],
    cta: { label: "Subscribe", plan: "team" },
    highlight: false,
  },
] as const;

export function PricingPlans() {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");

  return (
    <section className="pricing-plans-section">
      <div className="stack" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <p className="section-label">Plans</p>
        <div className="pricing-interval-toggle" style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}>
          <button
            type="button"
            className={interval === "monthly" ? "button small" : "button small secondary"}
            onClick={() => setInterval("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={interval === "annual" ? "button small" : "button small secondary"}
            onClick={() => setInterval("annual")}
          >
            Annual — save 20%
          </button>
        </div>
      </div>
      <div className="pricing-grid pricing-grid-editorial">
        {plans.map((plan) => {
          const price = interval === "annual" ? plan.annualPrice : plan.monthlyPrice;
          const billedNote = interval === "annual" && plan.annualPrice !== plan.monthlyPrice
            ? "billed annually"
            : null;

          return (
            <article
              key={plan.id}
              className={plan.highlight ? "panel pricing-card pricing-card-highlighted" : "panel pricing-card"}
            >
              <div className="pricing-card-copy pricing-card-top">
                <div className="pricing-card-header">
                  <p className="pricing-tier-name">{plan.name}</p>
                  {"badge" in plan && plan.badge ? <span className="pricing-badge">{plan.badge}</span> : null}
                </div>
                <div className="pricing-price-row">
                  <span className="pricing-price">{price}</span>
                  {plan.unit ? <span className="pricing-unit">{plan.unit}</span> : null}
                </div>
                {billedNote ? (
                  <p className="pricing-annual-note">{billedNote}</p>
                ) : null}
                <p className="muted">{plan.description}</p>
              </div>

              <ul className="pricing-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              {"plan" in plan.cta ? (
                <SubscribeButton plan={plan.cta.plan} label={plan.cta.label} highlighted={plan.highlight} interval={interval} />
              ) : (
                <Link
                  className={plan.highlight ? "button" : "button secondary"}
                  href={plan.cta.href}
                >
                  {plan.cta.label}
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
