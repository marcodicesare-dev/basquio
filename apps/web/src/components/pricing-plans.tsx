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
    monthlyFull: "",
    unit: "",
    description: "Try Basquio on real work. No credit card required.",
    bestFor: "Best for validating the workflow on one real reporting cycle.",
    features: [
      "30 free credits (~2 Deck runs)",
      "Basquio branding on output",
      "Community templates only",
    ],
    cta: { label: "Start free", href: "/sign-in?mode=sign-up" },
    highlight: false,
  },
  {
    id: "starter" as const,
    name: "Starter",
    monthlyPrice: "$19",
    annualPrice: "$16",
    monthlyFull: "$19",
    unit: "/mo",
    description: "For recurring reporting work that needs clean output without Basquio branding.",
    bestFor: "Best for solo operators with recurring reports and a couple of client templates.",
    features: [
      "No branding on output",
      "30 credits/month",
      "2 custom template slots",
      "Community support",
    ],
    cta: { label: "Subscribe", plan: "starter" },
    highlight: true,
    badge: "Default choice",
  },
  {
    id: "pro" as const,
    name: "Pro",
    monthlyPrice: "$149",
    annualPrice: "$124",
    monthlyFull: "$149",
    unit: "/mo",
    description: "For teams running multiple reports every month who need cheaper credits and priority access.",
    bestFor: "Best for consultants, agencies, and operators running multiple full reviews every month.",
    features: [
      "No branding on output",
      "200 credits/month",
      "5 custom template slots",
      "Priority generation queue",
      "Email support",
    ],
    cta: { label: "Subscribe", plan: "pro" },
    highlight: false,
    badge: "Heavy usage",
  },
  {
    id: "enterprise" as const,
    name: "Enterprise",
    monthlyPrice: "Custom",
    annualPrice: "Custom",
    monthlyFull: "",
    unit: "",
    description: "Custom billing, shared workspace, and dedicated support for larger teams.",
    bestFor: "Best for teams that need shared access, custom billing, and higher-volume reporting.",
    features: [
      "Shared workspace",
      "Custom credits and billing",
      "Custom template setup",
      "Priority support",
    ],
    cta: { label: "Talk to us", href: "/get-started" },
    highlight: false,
  },
] as const;

export function PricingPlans() {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const isAnnual = interval === "annual";

  return (
    <section className="pricing-plans-section">
      <div className="stack" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <p className="section-label">Plans</p>
        <div className="pricing-interval-toggle" style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}>
          <button
            type="button"
            className={!isAnnual ? "button small" : "button small secondary"}
            onClick={() => setInterval("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={isAnnual ? "button small" : "button small secondary"}
            onClick={() => setInterval("annual")}
          >
            Annual
          </button>
        </div>
      </div>
      <div className="pricing-grid pricing-grid-editorial">
        {plans.map((plan) => {
          const showStrikethrough = isAnnual && plan.monthlyFull;
          const displayPrice = isAnnual ? plan.annualPrice : plan.monthlyPrice;

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
                  {showStrikethrough ? (
                    <span className="pricing-price-struck">{plan.monthlyFull}</span>
                  ) : null}
                  <span className="pricing-price">{displayPrice}</span>
                  {plan.unit ? <span className="pricing-unit">{plan.unit}</span> : null}
                </div>
                <p className="muted">{plan.description}</p>
                <p className="pricing-plan-best-for">{plan.bestFor}</p>
              </div>

              <ul className="pricing-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="pricing-card-footer">
                {"plan" in plan.cta ? (
                  <SubscribeButton plan={plan.cta.plan} label={plan.cta.label} highlighted={plan.highlight} interval={interval} />
                ) : (
                  <Link className={plan.highlight ? "button" : "button secondary"} href={plan.cta.href}>
                    {plan.cta.label}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
