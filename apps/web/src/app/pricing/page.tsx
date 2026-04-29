import type { Metadata } from "next";

import { BuyingInterface } from "@/components/marketing-pricing-j";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio pricing · Pay as you go, Workspace, Team",
  description:
    "Pay for one output, or use a workspace for recurring research work. Basquio pricing covers pay as you go for one-off outputs, Workspace for solo recurring work, and Team Workspace for shared research teams.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

const faqs = [
  {
    question: "Why is there no free plan?",
    answer:
      "Basquio is built for real client work with real files. Pay as you go lets you start with one output without subscribing or signing up for a trial that will not last past the first deliverable.",
  },
  {
    question: "Why does pay as you go need an estimate?",
    answer:
      "A short report and a 20-slide category review do not cost the same to produce. Basquio estimates the workload from the brief and files before asking you to buy credits, so the price you see is the price for that specific output.",
  },
  {
    question: "What happens if a run fails?",
    answer:
      "Credits are returned automatically when Basquio fails to produce the promised output files. You never lose credits when the platform fails.",
  },
  {
    question: "What does the workspace remember?",
    answer:
      "Clients, brands, stakeholders, templates, brand rules, recurring projects, transcripts, prior reviews, and the corrections you make on past runs. The next brief starts with that context already in place.",
  },
  {
    question: "Is Team Workspace unlimited?",
    answer:
      "It is designed for normal daily team usage. During pilot setup we agree fair-use limits based on team size and expected output volume, so the subscription does not punish heavy weeks.",
  },
  {
    question: "Can I add analyst review on a run?",
    answer:
      "Yes, for selected outputs. Analyst review is an add-on after a generated run, not the default delivery model.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page pricing-page-j">
      <PublicSiteNav />

      <section className="pricing-j-hero">
        <div className="pricing-j-hero-copy">
          <p className="section-j-eyebrow">Pricing</p>
          <h1 className="pricing-j-title">Choose how you want to use Basquio.</h1>
          <p className="pricing-j-sub">
            Pay for one output when the work is occasional. Use Workspace or Team Workspace when the
            context needs to stay alive between outputs.
          </p>
        </div>
      </section>

      <section className="pricing-j-buying-stage" aria-labelledby="pricing-buying-heading">
        <h2 id="pricing-buying-heading" className="visually-hidden">
          Pricing
        </h2>
        <BuyingInterface variant="pricing" />
      </section>

      <section className="pricing-j-faq-stage" aria-labelledby="pricing-faq-heading">
        <header className="section-j-head pricing-j-faq-head">
          <p className="section-j-eyebrow">Common questions</p>
          <h2 id="pricing-faq-heading" className="section-j-title">
            What you pay for, what you get back, and when each plan stops fitting.
          </h2>
        </header>

        <div className="pricing-j-faq-list">
          {faqs.map((faq) => (
            <details key={faq.question} className="pricing-j-faq-item">
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Start with one output. Or set up the workspace."
        copy="Upload the brief and files for one job. If the work comes back next month, keep the context in a workspace."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See the workspace"
        secondaryHref="/#workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
