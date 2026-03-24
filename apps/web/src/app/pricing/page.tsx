import type { Metadata } from "next";
import Link from "next/link";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Pricing | Basquio",
  description:
    "Your first deck is free. After that, pay per deck: $10 for Standard, $24 for Pro. No subscriptions required.",
};

const tiers = [
  {
    name: "Free",
    price: "$0",
    unit: "first deck",
    description: "See what Basquio produces from your own data. No credit card.",
    features: [
      "1 full deck run",
      "Up to 10 slides",
      "PPTX + PDF output",
      "Basquio Standard template",
      "No credit card required",
    ],
    cta: "Generate my first deck",
    href: "/jobs/new",
    highlighted: false,
  },
  {
    name: "Standard",
    price: "$10",
    unit: "per deck",
    description: "For recurring reviews with a single evidence file and standard template.",
    features: [
      "Up to 10 slides",
      "1 evidence file per run",
      "Basquio Standard or 1 saved template",
      "PPTX + PDF output",
      "1 free rerun within 24 hours",
      "30-day report history",
    ],
    cta: "Buy a Standard deck",
    href: "/jobs/new?tier=standard",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$24",
    unit: "per deck",
    description: "For complex analyses with multiple files, custom branding, and richer output.",
    features: [
      "Up to 15 slides",
      "Multiple evidence files",
      "Custom brand template support",
      "Richer charts and deeper analysis",
      "Extended revision budget",
      "90-day report history",
      "Report recipes (save and rerun)",
    ],
    cta: "Buy a Pro deck",
    href: "/jobs/new?tier=pro",
    highlighted: true,
  },
  {
    name: "Team",
    price: "Custom",
    unit: "monthly",
    description: "Shared workspace, templates, and history for teams that run reports regularly.",
    features: [
      "Everything in Pro",
      "Shared workspace and history",
      "Team brand template library",
      "Saved report recipes",
      "Volume pricing on decks",
      "Priority generation queue",
    ],
    cta: "Contact us",
    href: "mailto:marco@basquio.com?subject=Basquio%20Team%20plan",
    highlighted: false,
  },
] as const;

const faqs = [
  {
    question: "What counts as one deck?",
    answer:
      "One deck run includes the full pipeline: data analysis, narrative construction, PPTX generation, PDF rendering, and visual QA. If the run fails due to a system error, it does not count.",
  },
  {
    question: "Can I rerun with changes?",
    answer:
      "Standard decks include 1 free rerun within 24 hours. Pro decks have an extended revision budget. You can also start a new run with the same data and a different brief at any time.",
  },
  {
    question: "What file formats do you accept?",
    answer:
      "CSV, XLSX, XLS, PDF, PPTX (as template), and plain text. NielsenIQ, Circana, and Kantar exports work out of the box.",
  },
  {
    question: "Is my data safe?",
    answer:
      "Your files are processed during generation and stored encrypted. We never use your data to train models. Source files can be deleted after export on Team plans.",
  },
  {
    question: "How long does a deck take?",
    answer:
      "Most decks complete in 5 to 10 minutes. Complex multi-file analyses may take up to 15 minutes.",
  },
  {
    question: "Do you offer annual or enterprise pricing?",
    answer:
      "Yes. Contact marco@basquio.com for annual contracts, SSO, data residency, and custom workflows.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack" style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <p className="section-label">Pricing</p>
          <h1>Your first deck is free. After that, pay per deck.</h1>
          <p className="page-copy">
            No subscriptions. No seat licenses. Generate a consulting-grade deck from your data,
            download PPTX + PDF, and only pay when the output is ready.
          </p>
        </div>
      </section>

      <section className="pricing-grid">
        {tiers.map((tier) => (
          <article
            key={tier.name}
            className={tier.highlighted ? "panel pricing-card pricing-card-highlighted" : "panel pricing-card"}
          >
            <div className="stack">
              <p className="pricing-tier-name">{tier.name}</p>
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
              className={tier.highlighted ? "button" : "button secondary"}
              href={tier.href}
            >
              {tier.cta}
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
        copy="Upload one evidence package and get a full deck with PPTX and PDF output. No credit card required."
        primaryLabel="Generate my first deck"
        primaryHref="/jobs/new"
        secondaryLabel="Compare the alternatives"
        secondaryHref="/compare"
      />
      <PublicSiteFooter />
    </div>
  );
}
