import type { Metadata } from "next";
import Link from "next/link";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Pricing | Basquio",
  description:
    "Start with your first standard report free, then pay per report or move to a team workspace when the workflow becomes routine.",
};

const tiers = [
  {
    name: "Individual",
    price: "$10",
    unit: "per report*",
    description: "The simple way to try Basquio on live work without buying a subscription first.",
    highlight: false,
    badge: null,
    features: [
      "First standard report free",
      "Standard reports up to 10 slides",
      "Pro reports up to 15 slides",
      "PPTX and PDF from the same run",
      "One rerun within 24 hours",
      "Works with Basquio Standard or one saved template",
    ],
    cta: { label: "Try it with your data", href: "/jobs/new" },
  },
  {
    name: "Team",
    price: "$149",
    unit: "per month + usage",
    description: "For teams that run the same reporting motion every month and need shared history.",
    highlight: true,
    badge: "Recommended",
    features: [
      "Everything in Individual",
      "Shared workspace for up to 10 people",
      "Shared report history and templates",
      "Saved report recipes",
      "Billing and usage controls",
      "Priority generation queue",
    ],
    cta: { label: "Talk to us", href: "mailto:marco@basquio.com?subject=Basquio%20Team" },
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "annual contract",
    description: "For larger rollouts that need procurement support, governance, and tighter access controls.",
    highlight: false,
    badge: null,
    features: [
      "Everything in Team",
      "SSO and SAML",
      "Retention and workspace controls",
      "Security review and DPA",
      "Custom workflow setup",
      "Dedicated support channel",
    ],
    cta: { label: "Contact sales", href: "mailto:marco@basquio.com?subject=Basquio%20Enterprise" },
  },
] as const;

const faqs = [
  {
    question: "What does a standard report include?",
    answer:
      "A finished first draft with analysis, narrative, charts, and delivery as matching PPTX and PDF files. Standard is built for one evidence package and up to 10 slides.",
  },
  {
    question: "When should I choose Pro instead of Standard?",
    answer:
      "Use Pro when the package is deeper, the slide count needs to go past 10, or the review needs a more involved branded output.",
  },
  {
    question: "What happens after the free first report?",
    answer:
      "You can keep going report by report, or move to a team workspace once the workflow becomes something more than one-off use.",
  },
  {
    question: "What if a run fails?",
    answer: "Basquio refunds system failures automatically. You do not lose usage when the platform fails to finish the run.",
  },
  {
    question: "What files can I upload?",
    answer:
      "CSV, XLSX, XLS, PDF, PPTX as template input, and plain text files for notes or brief material.",
  },
  {
    question: "How does team billing work?",
    answer:
      "Team workspaces start at $149 per month with shared usage, shared history, and shared templates. Contact us if you need a larger setup.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page pricing-page">
      <PublicSiteNav />

      <section className="page-hero pricing-hero">
        <div className="stack pricing-hero-copy">
          <p className="section-label">Pricing</p>
          <h1>Start free. Pay per report. Add the team when it becomes routine.</h1>
          <p className="page-copy">
            Basquio is easy to try on real work. Your first standard report is free. After that, buy individual reports or set up a shared workspace for the team.
          </p>
          <p className="pricing-footnote">
            * Basquio calculates credits and report type from scope, slide count, and workflow complexity.
          </p>
        </div>
      </section>

      <section className="pricing-grid pricing-grid-editorial">
        {tiers.map((tier) => (
          <article
            key={tier.name}
            className={tier.highlight ? "panel pricing-card pricing-card-highlighted" : "panel pricing-card"}
          >
            <div className="pricing-card-copy pricing-card-top">
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
            <h2>What you pay for, what you get back, and when to move up.</h2>
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
        title="Run the first report on live data."
        copy="The fastest way to know if Basquio fits the team is to put one real review through it."
        primaryLabel="Try it with your data"
        primaryHref="/jobs/new"
        secondaryLabel="Get started"
        secondaryHref="/get-started"
      />
      <PublicSiteFooter />
    </div>
  );
}
