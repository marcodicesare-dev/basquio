import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { BuyCreditsButton } from "@/components/buy-credits-button";
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

const creditPacks = [
  { id: "pack_25", credits: 25, price: "$18", perCredit: "$0.72" },
  { id: "pack_50", credits: 50, price: "$32", perCredit: "$0.64" },
  { id: "pack_100", credits: 100, price: "$56", perCredit: "$0.56" },
  { id: "pack_250", credits: 250, price: "$125", perCredit: "$0.50" },
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

      {/* Output Types */}
      <section className="pricing-output-types">
        <p className="section-label" style={{ textAlign: "center", marginBottom: "1rem" }}>Output types</p>
        <div className="pricing-output-grid">
          {outputTypes.map((type) => (
            <article
              key={type.name}
              className={type.highlight ? "panel pricing-output-card pricing-output-card-highlighted" : "panel pricing-output-card"}
            >
              <div className="pricing-card-top">
                <p className="pricing-tier-name">{type.name}</p>
                <p className="pricing-output-credits">{type.credits}</p>
              </div>
              <p className="muted">{type.description}</p>
              <p className="pricing-output-artifacts">{type.artifacts}</p>
              <p className="pricing-output-time">{type.time}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Plans with monthly/annual toggle */}
      <PricingPlans />

      {/* Credit Packs */}
      <section id="packs" className="pricing-packs-section">
        <div className="stack" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <p className="section-label">Credit packs</p>
          <p className="muted">Top up anytime. Purchased credits expire after 12 months.</p>
        </div>
        <div className="pricing-packs-grid">
          {creditPacks.map((pack) => (
            <article key={pack.id} className="panel pricing-pack-card">
              <p className="pricing-pack-credits">{pack.credits} credits</p>
              <p className="pricing-pack-price">{pack.price}</p>
              <p className="muted">{pack.perCredit}/credit</p>
              <BuyCreditsButton packId={pack.id} label={`Buy ${pack.credits}`} />
            </article>
          ))}
        </div>
      </section>

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
