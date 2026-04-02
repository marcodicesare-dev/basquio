import type { Metadata } from "next";
import { Suspense } from "react";

import { CreditPackShelf } from "@/components/credit-pack-shelf";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { PricingPlans } from "@/components/pricing-plans";

export const metadata: Metadata = {
  title: "Pricing — Basquio",
  description:
    "Start free with 40 credits — enough for ~3 Deck runs. Then choose a plan that fits: Starter at $29/mo, Pro at $79/mo, or Team at $149/mo. Turn CSV and Excel data into finished analysis decks.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

const outputTypes = [
  {
    name: "Memo",
    credits: "3 credits",
    artifacts: "XLSX + MD",
    description: "Data tables and narrative report. Fast, no slides.",
    time: "~2 min",
    highlight: false,
  },
  {
    name: "Deck",
    credits: "~13 credits",
    artifacts: "PPTX + PDF + MD + XLSX",
    description: "Full analysis deck with real charts and narrative report.",
    time: "~15 min",
    highlight: true,
  },
  {
    name: "Deep-Dive",
    credits: "~33 credits",
    artifacts: "PPTX + PDF + MD + XLSX",
    description: "Consulting-grade depth. The full treatment.",
    time: "~25 min",
    highlight: false,
  },
] as const;

const faqs = [
  {
    question: "What do I get with each output type?",
    answer:
      "Memo gives you data tables and a narrative report (XLSX + MD). Deck adds a full presentation with real charts (PPTX + PDF). Deep-Dive is the same artifacts as Deck but with consulting-grade analytical depth.",
  },
  {
    question: "How do credits work?",
    answer:
      "Memo costs 3 credits flat. Deck costs 3 base + 1 per slide (a 10-slide deck = 13 credits). Deep-Dive costs 3 base + 3 per slide (a 10-slide deck = 33 credits). Plans include monthly credits; you can buy more anytime.",
  },
  {
    question: "What happens to unused credits?",
    answer:
      "Subscription credits roll over for 1 month. Purchased credit packs expire after 12 months. Free tier credits never expire.",
  },
  {
    question: "What if a run fails?",
    answer: "Basquio refunds credits automatically for system failures. You never lose credits when the platform fails.",
  },
  {
    question: "What files can I upload?",
    answer:
      "CSV, XLSX, XLS, PDF, PPTX, and plain text. Excel gives the deepest analysis; PPTX and PDF also work for extraction and restyling.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancel from the billing page or Stripe portal. Your plan stays active until the end of the billing period. No refunds for partial months.",
  },
] as const;

const planComparisonRows = [
  {
    label: "Who it is for",
    values: ["Trialing Basquio on real work", "Solo operator", "Power user", "Reporting team"],
  },
  {
    label: "Monthly credits",
    values: ["40 free credits once", "30 / month", "100 / month", "200 / month pooled"],
  },
  {
    label: "Branding on output",
    values: ["Basquio branding", "No branding", "No branding", "No branding"],
  },
  {
    label: "Custom templates",
    values: ["Community only", "1 slot", "5 slots", "10 slots"],
  },
  {
    label: "Workspace model",
    values: ["Single user", "Single user", "Single user", "Shared workspace"],
  },
  {
    label: "Best buying motion",
    values: ["Try before paying", "Subscribe", "Subscribe", "Subscribe + top up"],
  },
] as const;

const outputModes = [
  {
    name: "Memo",
    credits: "3 credits",
    deliverables: ["Narrative report", "Audit-ready workbook"],
    fit: "Fast readout when slides are unnecessary.",
    featured: false,
  },
  {
    name: "Deck",
    credits: "~13 credits",
    deliverables: ["Editable PPTX", "Shareable PDF", "Narrative report", "Audit-ready workbook"],
    fit: "Default client-ready report package.",
    featured: true,
  },
  {
    name: "Deep-Dive",
    credits: "~33 credits",
    deliverables: ["Full deck set", "Longer analytical pass", "Heavier narrative depth"],
    fit: "When the room needs more analysis, not more decoration.",
    featured: false,
  },
] as const;

const creditFormulaRows = [
  { label: "Memo", formula: "3 flat", note: "No slides." },
  { label: "Deck", formula: "3 + 1 per slide", note: "10 slides = 13 credits." },
  { label: "Deep-Dive", formula: "3 + 3 per slide", note: "10 slides = 33 credits." },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page pricing-page">
      <PublicSiteNav />

      <section className="page-hero pricing-hero">
        <div className="stack pricing-hero-copy">
          <p className="section-label">Pricing</p>
          <h1>Start free. Scale when it clicks.</h1>
          <p className="page-copy">
            40 free credits — enough for ~3 Deck runs. No credit card. See if Basquio fits before you pay anything.
          </p>
        </div>
      </section>

      {/* Plans with monthly/annual toggle */}
      <PricingPlans />

      <section className="pricing-comparison-stage">
        <article className="technical-panel pricing-comparison-panel">
          <div className="pricing-comparison-head">
            <div className="stack-xs">
              <p className="section-label light">Plan comparison</p>
              <h2>Pick the buying model first. Scope comes second.</h2>
            </div>
            <p className="muted">
              This should read like a decision table, not a scavenger hunt. Start free, subscribe when the motion is recurring, top up when volume spikes.
            </p>
          </div>

          <div className="pricing-comparison-table-wrap">
            <table className="pricing-comparison-table">
              <thead>
                <tr>
                  <th>Decision point</th>
                  <th>Free</th>
                  <th>Starter</th>
                  <th>Pro</th>
                  <th>Team</th>
                </tr>
              </thead>
              <tbody>
                {planComparisonRows.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    {row.values.map((value) => (
                      <td key={`${row.label}-${value}`}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="pricing-explainer-stage">
        <article className="panel pricing-explainer-panel">
          <div className="stack-xs">
            <p className="section-label">Deliverables</p>
            <h2>Choose the output mode that matches the room.</h2>
          </div>

          <div className="pricing-mode-grid">
            {outputModes.map((mode) => (
              <article
                key={mode.name}
                className={mode.featured ? "pricing-mode-card pricing-mode-card-featured" : "pricing-mode-card"}
              >
                <div className="pricing-mode-top">
                  <div>
                    <p className="pricing-tier-name">{mode.name}</p>
                    <p className="pricing-mode-credits">{mode.credits}</p>
                  </div>
                  {mode.featured ? <span className="pricing-badge">Default</span> : null}
                </div>
                <p className="muted">{mode.fit}</p>
                <ul className="pricing-mode-deliverables">
                  {mode.deliverables.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="pricing-formula-stage">
        <article className="technical-panel pricing-formula-panel">
          <div className="stack-xs">
            <p className="section-label light">Credit logic</p>
            <h2>Credits map to workload, not vague “AI usage.”</h2>
          </div>

          <div className="pricing-formula-body">
            <div className="pricing-formula-list">
              {creditFormulaRows.map((row) => (
                <div key={row.label} className="pricing-formula-row">
                  <div>
                    <p className="pricing-tier-name">{row.label}</p>
                    <p className="pricing-formula-value">{row.formula}</p>
                  </div>
                  <p className="muted">{row.note}</p>
                </div>
              ))}
            </div>

            <div className="pricing-example-card">
              <p className="section-label light">Examples</p>
              <div className="pricing-example-grid">
                {outputTypes.map((type) => (
                  <div key={type.name} className="pricing-example-pill">
                    <strong>{type.name}</strong>
                    <span>{type.time}</span>
                    <span>{type.artifacts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </article>
      </section>

      {/* Credit Packs — BuyCreditsButton uses useSearchParams, needs Suspense */}
      <Suspense fallback={null}>
        <div id="packs">
          <CreditPackShelf />
        </div>
      </Suspense>

      {/* FAQ */}
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
        copy="The fastest way to know if Basquio fits is to put one real review through it."
        primaryLabel="Try it with your data"
        primaryHref="/jobs/new"
        secondaryLabel="Get started"
        secondaryHref="/get-started"
      />
      <PublicSiteFooter />
    </div>
  );
}
