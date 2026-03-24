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
    "Pay per slide: 3 base credits + 1 per slide. 6 free credits on signup. Buy credit packs starting at $15.",
};

const BASE_CREDITS = 3;

const examples = [
  { slides: 3, credits: 6 },
  { slides: 5, credits: 8 },
  { slides: 8, credits: 11 },
  { slides: 10, credits: 13 },
  { slides: 15, credits: 18 },
  { slides: 20, credits: 23 },
] as const;

const packs = [
  {
    name: "Starter",
    credits: 25,
    price: "$15",
    perCredit: "$0.60",
    enough: "Enough for two 8-slide decks",
    highlighted: false,
    packId: "pack_25",
  },
  {
    name: "Standard",
    credits: 50,
    price: "$25",
    perCredit: "$0.50",
    enough: "Enough for four 10-slide decks",
    highlighted: true,
    packId: "pack_50",
  },
  {
    name: "Pro",
    credits: 100,
    price: "$40",
    perCredit: "$0.40",
    enough: "Enough for seven 10-slide decks",
    highlighted: false,
    packId: "pack_100",
  },
  {
    name: "Team",
    credits: null,
    price: "Custom",
    perCredit: "Volume",
    enough: "Shared workspace, templates, team history",
    highlighted: false,
    href: "mailto:marco@basquio.com?subject=Basquio%20Team%20plan",
  },
] as const;

const faqs = [
  {
    question: "How are credits calculated?",
    answer:
      "Every deck costs 3 base credits (covering data analysis and QA) plus 1 credit per slide. A 10-slide deck costs 13 credits. You choose the slide count in the brief, so you always know the price before generating.",
  },
  {
    question: "What if the run fails?",
    answer:
      "If a run fails due to a system error, your credits are automatically refunded. You only pay for successful decks.",
  },
  {
    question: "Do credits expire?",
    answer:
      "Credits do not expire. Use them at your own pace.",
  },
  {
    question: "What file formats do you accept?",
    answer:
      "CSV, XLSX, XLS, PDF, PPTX (as template), and plain text. NielsenIQ, Circana, and Kantar exports work out of the box.",
  },
  {
    question: "Is my data safe?",
    answer:
      "Your files are processed during generation and stored encrypted. We never use your data to train models.",
  },
  {
    question: "How long does a deck take?",
    answer:
      "Most decks complete in 5 to 10 minutes. Complex multi-file analyses may take up to 15 minutes.",
  },
  {
    question: "Do you offer enterprise pricing?",
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
          <h1>Pay per slide. 6 free credits to start.</h1>
          <p className="page-copy">
            Every deck costs {BASE_CREDITS} base credits plus 1 credit per slide.
            Buy credits in packs — the more you buy, the less each slide costs.
          </p>
        </div>
      </section>

      {/* How credits work */}
      <section className="cards">
        <article className="technical-panel stack-lg">
          <div className="stack">
            <p className="section-label light">How credits work</p>
            <h2>{BASE_CREDITS} base + 1 per slide = total credits</h2>
            <p className="muted" style={{ color: "var(--text-inverse-soft)" }}>
              The base covers data analysis, narrative construction, and visual QA.
              Each slide covers chart rendering, copywriting, and layout.
            </p>
          </div>

          <div className="credit-example-grid">
            {examples.map((ex) => (
              <div key={ex.slides} className="credit-example-cell">
                <span className="credit-example-slides">{ex.slides} slides</span>
                <span className="credit-example-credits">{ex.credits} credits</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">First deck free</p>
            <h2>6 credits on signup. No credit card.</h2>
            <p className="muted">
              Enough for one 3-slide deck — or apply them toward a larger deck
              after purchasing a credit pack.
            </p>
          </div>
        </article>
      </section>

      {/* Credit packs */}
      <section className="pricing-grid">
        {packs.map((pack) => (
          <article
            key={pack.name}
            className={pack.highlighted ? "panel pricing-card pricing-card-highlighted" : "panel pricing-card"}
          >
            <div className="stack">
              <p className="pricing-tier-name">{pack.name}</p>
              <div className="pricing-price-row">
                <span className="pricing-price">{pack.price}</span>
                {pack.credits ? (
                  <span className="pricing-unit">{pack.credits} credits</span>
                ) : (
                  <span className="pricing-unit">monthly</span>
                )}
              </div>
              {pack.credits ? (
                <p className="muted">{pack.perCredit}/credit. {pack.enough}.</p>
              ) : (
                <p className="muted">{pack.enough}.</p>
              )}
            </div>

            {pack.name === "Team" ? (
              <Link
                className="button secondary"
                href="mailto:marco@basquio.com?subject=Basquio%20Team%20plan"
              >
                Contact us
              </Link>
            ) : (
              <Suspense fallback={<button className={pack.highlighted ? "button" : "button secondary"} disabled>{`Buy ${pack.credits} credits`}</button>}>
                <BuyCreditsButton
                  packId={pack.packId}
                  label={`Buy ${pack.credits} credits`}
                  highlighted={pack.highlighted}
                />
              </Suspense>
            )}
          </article>
        ))}
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
        title="6 free credits on signup."
        copy="6 credits on signup — enough for a 3-slide deck. No credit card required."
        primaryLabel="Generate my first deck"
        primaryHref="/jobs/new"
        secondaryLabel="Compare the alternatives"
        secondaryHref="/compare"
      />
      <PublicSiteFooter />
    </div>
  );
}
