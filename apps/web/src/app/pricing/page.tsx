import type { Metadata } from "next";
import { Suspense } from "react";

import { CreditPackShelf } from "@/components/credit-pack-shelf";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { PricingPlans } from "@/components/pricing-plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start free with 15 credits. Upgrade to Starter at $19/mo or Pro at $149/mo when the workflow becomes recurring. Basquio turns spreadsheets into finished analysis decks, narratives, and workbooks.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

const outputTypes = [
  {
    name: "Memo",
    credits: "3 credits",
    artifacts: "XLSX + MD",
    description: "Written analysis + data workbook. Fast, no slides.",
    time: "~2 min",
    highlight: false,
  },
  {
    name: "Deck",
    credits: "10 slides = 13 credits",
    artifacts: "PPTX + MD + XLSX",
    description: "Full deck with real charts, written analysis, and data workbook.",
    time: "~15 min",
    highlight: true,
  },
  {
    name: "Deep-Dive",
    credits: "10 slides = 25 credits",
    artifacts: "PPTX + MD + XLSX",
    description: "Consulting-grade depth. The full treatment.",
    time: "~25 min",
    highlight: false,
  },
] as const;

const faqs = [
  {
    question: "What do I get with each output type?",
    answer:
      "Every run includes a written analysis (2000+ words with methodology, findings, and recommendations) and a data workbook. Deck and Deep-Dive also include an editable PowerPoint with real charts. Deep-Dive runs a deeper analytical pass for more nuanced findings.",
  },
  {
    question: "How do credits work?",
    answer:
      "Memo costs 3 credits flat. Deck uses a progressive formula: 3 base + 1 per slide for the first 10 slides, then 2 per slide after that. Deep-Dive costs 5 base + 2 per slide. Examples: Deck 10 slides = 13 credits, Deck 15 slides = 23 credits, Deep-Dive 20 slides = 45 credits.",
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
    question: "Do custom templates cost extra on Free?",
    answer:
      "Yes. Free users pay a $5 per-run custom-template fee. Starter and Pro include template usage inside the plan.",
  },
] as const;

const planComparisonRows = [
  {
    label: "Who it is for",
    values: ["Trialing Basquio on real work", "Solo operator", "Power user", "Larger team / procurement"],
  },
  {
    label: "Monthly credits",
    values: ["15 free credits once", "30 / month", "200 / month", "Custom"],
  },
  {
    label: "Branding on output",
    values: ["Basquio branding", "No branding", "No branding", "No branding"],
  },
  {
    label: "Custom templates",
    values: ["Community only", "2 slots", "5 slots", "Custom"],
  },
  {
    label: "Workspace model",
    values: ["Single user", "Single user", "Single user", "Shared workspace"],
  },
  {
    label: "How to start",
    values: ["Try before paying", "Subscribe", "Subscribe", "Talk to sales"],
  },
] as const;

const outputModes = [
  {
    name: "Memo",
    credits: "3 credits",
    deliverables: ["Written analysis (2000+ words)", "Data workbook (XLSX)"],
    fit: "Fast readout when slides are unnecessary.",
    featured: false,
  },
  {
    name: "Deck",
    credits: "10 slides = 13 credits",
    deliverables: ["Editable PPTX with charts", "Written analysis (2000+ words)", "Data workbook (XLSX)"],
    fit: "Default client-ready report package.",
    featured: true,
  },
  {
    name: "Deep-Dive",
    credits: "10 slides = 25 credits",
    deliverables: ["Full deck with deeper analysis", "Extended written analysis", "Data workbook (XLSX)"],
    fit: "When the room needs more analysis, not more decoration.",
    featured: false,
  },
] as const;

const creditFormulaRows = [
  { label: "Memo", formula: "3 flat", note: "No slides." },
  { label: "Deck", formula: "3 + 1/slide for first 10, then 2/slide", note: "10 slides = 13. 15 slides = 23." },
  { label: "Deep-Dive", formula: "5 + 2 per slide", note: "10 slides = 25. 20 slides = 45." },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page pricing-page">
      <PublicSiteNav />

      <section className="page-hero pricing-hero">
        <div className="stack pricing-hero-copy">
          <p className="section-label">Pricing</p>
          <h1>Start free. Upgrade when you need more.</h1>
          <p className="page-copy">
            15 free credits. No credit card. Enough for one standard Deck run before you decide.
          </p>
        </div>
      </section>

      <PricingPlans />

      <section className="pricing-comparison-stage">
        <article className="technical-panel pricing-comparison-panel">
          <div className="pricing-comparison-head">
            <div className="stack-xs">
              <p className="section-label light">Plan comparison</p>
              <h2>Pick your plan. Adjust scope later.</h2>
            </div>
            <p className="muted">
              Every plan uses the same analysis engine. Higher tiers unlock cheaper credits, more template slots, and cleaner output.
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
                  <th>Enterprise</th>
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
            <h2>Credits map to workload, not vague AI usage.</h2>
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

      <Suspense fallback={null}>
        <div id="packs">
          <CreditPackShelf
            plan="free"
            subtitle="Top up anytime. Pack pricing gets cheaper once you subscribe: Free pays $0.88/credit, Starter $0.70, Pro $0.50."
          />
        </div>
      </Suspense>

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
        copy="Upload your data. Get a finished deck in 15 minutes. 15 free credits, no credit card."
        primaryLabel="Try it with your data"
        primaryHref="/jobs/new"
        secondaryLabel="Get started"
        secondaryHref="/get-started"
      />
      <PublicSiteFooter />
    </div>
  );
}
