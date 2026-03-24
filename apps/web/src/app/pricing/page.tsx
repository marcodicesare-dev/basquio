import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { BuyCreditsButton } from "@/components/buy-credits-button";

export const metadata: Metadata = {
  title: "Pricing | Basquio",
  description:
    "First standard report free. Then $10 per standard report or $24 per pro report. Teams from $149/month.",
};

const tiers = [
  {
    name: "Individual",
    price: "$10",
    unit: "per standard report",
    description: "First standard deck free. Then pay per report, no subscription.",
    highlight: false,
    badge: null,
    features: [
      "First standard report free (no card needed)",
      "Standard: up to 10 slides — $10",
      "Pro: up to 15 slides — $24",
      "1 evidence file per standard report",
      "PPTX + PDF output",
      "Basquio Standard or 1 saved template",
      "1 rerun within 24 hours",
    ],
    cta: { label: "Try free", href: "/jobs/new" },
  },
  {
    name: "Team",
    price: "$149",
    unit: "per month + usage",
    description: "Shared workspace for teams that run reports every month.",
    highlight: true,
    badge: "Recommended",
    features: [
      "Everything in Individual",
      "Shared report history across team",
      "Shared brand systems",
      "Saved report recipes",
      "Multi-user workspace (up to 10)",
      "Included monthly report volume",
      "Billing and usage controls",
      "Priority generation queue",
    ],
    cta: { label: "Contact us", href: "mailto:marco@basquio.com?subject=Basquio%20Team" },
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "annual contract",
    description: "Governance, SSO, retention controls, and dedicated support.",
    highlight: false,
    badge: null,
    features: [
      "Everything in Team",
      "SSO / SAML",
      "Data retention controls",
      "Procurement support",
      "Custom workflow configuration",
      "Dedicated support channel",
      "Security review and DPA",
    ],
    cta: { label: "Contact us", href: "mailto:marco@basquio.com?subject=Basquio%20Enterprise" },
  },
] as const;

const faqs = [
  {
    question: "What does a standard report include?",
    answer: "Data analysis, narrative construction, visual QA, and delivery as PPTX + PDF. Up to 10 slides from one evidence file. Charts rendered as high-resolution images.",
  },
  {
    question: "When should I use Pro instead of Standard?",
    answer: "Pro supports up to 15 slides, multiple evidence files, custom brand templates, and a higher revision budget. Use it for deeper analysis or client-branded output.",
  },
  {
    question: "How does the free first report work?",
    answer: "Sign up with no credit card. Generate one standard report from your own data at no cost. If the output is useful, buy credits to keep going.",
  },
  {
    question: "What if a report fails?",
    answer: "Credits are automatically refunded for system failures. You only pay for successful reports.",
  },
  {
    question: "What file formats do you accept?",
    answer: "CSV, XLSX, XLS, PDF, PPTX (as template), and plain text. NielsenIQ, Circana, and Kantar exports work out of the box.",
  },
  {
    question: "How does team billing work?",
    answer: "Team workspaces start at $149/month with included report volume. Additional reports beyond the included amount are metered. All members share the workspace balance.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack" style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <p className="section-label">Pricing</p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>Start free. Pay per report.</h1>
          <p className="page-copy">
            Your first standard deck is free. After that, standard reports are $10 and pro reports are $24. Teams get shared workspaces and volume pricing.
          </p>
        </div>
      </section>

      <section className="pricing-grid">
        {tiers.map((tier) => (
          <article
            key={tier.name}
            className={tier.highlight ? "panel pricing-card pricing-card-highlighted" : "panel pricing-card"}
          >
            <div className="stack">
              <div className="pricing-card-header">
                <p className="pricing-tier-name">{tier.name}</p>
                {tier.badge ? <span className="pricing-badge">{tier.badge}</span> : null}
              </div>
              <div className="pricing-price-row">
                <span className="pricing-price">{tier.price}</span>
                <span className="pricing-unit">{tier.unit}</span>
              </div>
              <p className="muted">{tier.description}</p>
            </div>

            <ul className="pricing-features">
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>

            <Link
              className={tier.highlight ? "button" : "button secondary"}
              href={tier.cta.href}
            >
              {tier.cta.label}
            </Link>
          </article>
        ))}
      </section>

      <section className="cards">
        <article className="technical-panel stack-lg">
          <div className="stack">
            <p className="section-label light">Common questions</p>
            <h2>How it works, what you pay, what you own.</h2>
          </div>

          <div className="faq-list">
            {faqs.map((faq) => (
              <details key={faq.question} className="faq-item">
                <summary>{faq.question}</summary>
                <p className="muted">{faq.answer}</p>
              </details>
            ))}
          </div>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to try it?"
        title="Your first report is free."
        copy="Upload your data and see the output before you buy. No credit card required."
        primaryLabel="Try free"
        primaryHref="/jobs/new"
        secondaryLabel="See how it works"
        secondaryHref="/#pipeline"
      />
      <PublicSiteFooter />
    </div>
  );
}
