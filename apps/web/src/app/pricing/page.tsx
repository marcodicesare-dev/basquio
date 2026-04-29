import type { Metadata } from "next";
import { Suspense } from "react";

import { CreditPackShelf } from "@/components/credit-pack-shelf";
import { PricingModelInterface } from "@/components/pricing-model-interface";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio Pricing",
  description:
    "Estimate one research output, subscribe to a single-user workspace for recurring context, or plan a team workspace with shared projects, reviews, and onboarding.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

const pricingQuestions = [
  {
    question: "When should I use pay as you go?",
    answer:
      "Use credits when you have one clear request and want to estimate the output before purchase. It is built for a single deck, report, or Excel package.",
  },
  {
    question: "Why does Workspace Pro cost $199 per month?",
    answer:
      "The subscription is for recurring work. It keeps templates, notes, past reviews, and preferred formats together so the next request starts with context.",
  },
  {
    question: "What makes Team Workspace different?",
    answer:
      "Team Workspace adds shared projects, roles, review history, onboarding, and pilot support for teams that produce research outputs together.",
  },
  {
    question: "Is the Workspace Pro trial free?",
    answer:
      "Workspace Pro has a 7-day trial that requires checkout. Pay as you go remains the clean path for one output without a workspace subscription.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page pricing-page pricing-page-g">
      <PublicSiteNav />

      <section className="page-hero pricing-hero pricing-hero-g">
        <div className="stack pricing-hero-copy">
          <p className="section-label">Pricing</p>
          <h1>Pricing that matches how research work happens.</h1>
          <p className="page-copy">
            Estimate one output. Subscribe when context should stay alive. Bring the team in when projects,
            roles, and review history need to be shared.
          </p>
        </div>
      </section>

      <PricingModelInterface />

      <Suspense fallback={null}>
        <div id="packs" className="pricing-packs-g">
          <CreditPackShelf
            plan="free"
            subtitle="Use credit packs for one-off output. Subscribe when the context should stay available for the next request."
          />
        </div>
      </Suspense>

      <section className="pricing-questions-g">
        <article className="technical-panel stack-lg">
          <div className="stack">
            <p className="section-label light">Questions</p>
            <h2>Choose credits, workspace, or team based on the work pattern.</h2>
          </div>

          <div className="faq-list">
            {pricingQuestions.map((faq) => (
              <details key={faq.question} className="faq-item">
                <summary>{faq.question}</summary>
                <p className="muted">{faq.answer}</p>
              </details>
            ))}
          </div>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Start with the material you already have."
        copy="Bring the brief, sources, notes, and template. Leave with files your team can review."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="Talk to us"
        secondaryHref="/get-started"
      />
      <PublicSiteFooter />
    </div>
  );
}
