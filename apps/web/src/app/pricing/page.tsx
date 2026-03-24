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
    "Start free. Standard reports from $10. Team workspaces from $149/month.",
};

const tiers = [
  {
    name: "Individual",
    price: "Free to start",
    description: "Your first standard deck is on us. Then pay per report.",
    highlight: false,
    badge: null,
    features: [
      "First standard report free",
      "Standard: $10 per report (up to 10 slides)",
      "Pro: $24 per report (up to 15 slides)",
      "1 evidence file per report",
      "PPTX + PDF output",
      "Basquio Standard or 1 saved template",
      "1 rerun within 24 hours",
      "30-day report history",
    ],
    cta: { label: "Try with your data", href: "/jobs/new" },
    packId: null,
  },
  {
    name: "Team",
    price: "$149/mo",
    description: "Shared workspace for teams that run reports regularly.",
    highlight: true,
    badge: "Recommended",
    features: [
      "Everything in Individual",
      "Shared report history",
      "Shared brand systems",
      "Saved report recipes",
      "Multi-user workspace",
      "Included monthly report volume",
      "Additional reports metered",
      "Billing and usage controls",
      "Priority generation queue",
    ],
    cta: { label: "Contact us", href: "mailto:marco@basquio.com?subject=Basquio%20Team" },
    packId: null,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "Annual contracts with governance and support.",
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
    packId: null,
  },
] as const;

const comparisonRows = [
  { feature: "Reports per month", individual: "Pay per report", team: "Included volume + metered", enterprise: "Custom" },
  { feature: "Slides per report", individual: "Up to 10 (Standard) / 15 (Pro)", team: "Up to 15", enterprise: "Custom" },
  { feature: "Evidence files", individual: "1 per report", team: "Multiple", enterprise: "Unlimited" },
  { feature: "Brand templates", individual: "1 saved template", team: "Shared library", enterprise: "Managed library" },
  { feature: "Report recipes", individual: "Personal", team: "Shared across team", enterprise: "Shared + managed" },
  { feature: "Report history", individual: "30 days", team: "Unlimited", enterprise: "Unlimited + retention controls" },
  { feature: "Users", individual: "1", team: "Up to 10", enterprise: "Unlimited" },
  { feature: "SSO", individual: "No", team: "No", enterprise: "Yes" },
  { feature: "Support", individual: "Email", team: "Email", enterprise: "Dedicated" },
] as const;

const faqs = [
  {
    question: "What's included in a standard report?",
    answer: "A standard report includes data analysis, narrative construction, visual QA, and delivery as both PPTX and PDF. Up to 10 slides from one evidence file. Charts rendered as high-resolution images. Speaker notes included.",
  },
  {
    question: "When should I use Pro instead of Standard?",
    answer: "Pro reports support up to 15 slides, multiple evidence files, custom brand templates, and a higher revision budget. Choose Pro when you need deeper analysis from multiple data sources or client-branded output.",
  },
  {
    question: "How does the free first report work?",
    answer: "Sign up with no credit card. You get 6 credits — enough for one standard report with up to 3 slides. This lets you see real output from your own data before buying.",
  },
  {
    question: "What if a report fails?",
    answer: "If a report fails due to a system error, your credits are automatically refunded. You only pay for successful reports.",
  },
  {
    question: "Do credits expire?",
    answer: "No. Credits do not expire. Use them at your own pace.",
  },
  {
    question: "What file formats do you accept?",
    answer: "CSV, XLSX, XLS, PDF, PPTX (as template), and plain text. NielsenIQ, Circana, and Kantar exports work out of the box.",
  },
  {
    question: "How does team billing work?",
    answer: "Team workspaces start at $149/month, which includes a monthly report volume. Additional reports beyond the included volume are metered at the individual rate. All team members share the workspace balance.",
  },
  {
    question: "How do I get enterprise pricing?",
    answer: "Contact marco@basquio.com for annual contracts, SSO, data residency, retention controls, and procurement support.",
  },
] as const;

const creditPacks = [
  { name: "25 credits", price: "$15", perCredit: "$0.60", packId: "pack_25" as const },
  { name: "50 credits", price: "$25", perCredit: "$0.50", packId: "pack_50" as const },
  { name: "100 credits", price: "$40", perCredit: "$0.40", packId: "pack_100" as const },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      {/* Hero */}
      <section className="page-hero">
        <div className="stack" style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <p className="section-label">Pricing</p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>Start free. Pay when a report is worth keeping.</h1>
          <p className="page-copy">
            Your first standard deck is free. After that, reports start at $10. Teams get shared workspaces and volume pricing.
          </p>
        </div>
      </section>

      {/* Tier cards */}
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
              <p className="pricing-price" style={{ fontSize: "1.8rem" }}>{tier.price}</p>
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

      {/* Credit packs for individual buyers */}
      <section className="panel stack-xl" style={{ maxWidth: 800, margin: "0 auto" }}>
        <div className="stack">
          <p className="section-label">Credit packs</p>
          <h2>Buy credits for individual reports</h2>
          <p className="muted">
            A standard report (10 slides) costs 13 credits. A pro report (15 slides) costs 18 credits.
            Buy in larger packs for a lower per-credit rate.
          </p>
        </div>

        <div className="pricing-inline-grid">
          {creditPacks.map((pack) => (
            <div key={pack.packId} className="pricing-inline-card">
              <p className="pricing-inline-name">{pack.name}</p>
              <p className="pricing-inline-price">{pack.price}</p>
              <p className="muted">{pack.perCredit}/credit</p>
              <Suspense fallback={<button className="button secondary" disabled>Buy</button>}>
                <BuyCreditsButton packId={pack.packId} label={`Buy ${pack.name}`} highlighted={false} />
              </Suspense>
            </div>
          ))}
        </div>
      </section>

      {/* Feature comparison */}
      <section className="cards">
        <article className="panel stack-xl" style={{ overflow: "auto" }}>
          <div className="stack">
            <p className="section-label">Compare plans</p>
            <h2>What each plan includes</h2>
          </div>

          <table className="billing-table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Individual</th>
                <th>Team</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.feature}>
                  <td style={{ fontWeight: 600 }}>{row.feature}</td>
                  <td>{row.individual}</td>
                  <td>{row.team}</td>
                  <td>{row.enterprise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      {/* FAQ */}
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
        primaryLabel="Try with your data"
        primaryHref="/jobs/new"
        secondaryLabel="See how it works"
        secondaryHref="/#pipeline"
      />
      <PublicSiteFooter />
    </div>
  );
}
