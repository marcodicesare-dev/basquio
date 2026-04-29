import type { Metadata } from "next";
import Link from "next/link";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio pricing · Pay as you go, Workspace Pro, Team Workspace",
  description:
    "Pay for one output, or use a workspace for recurring research work. Basquio pricing covers pay as you go for one-off outputs, Workspace Pro for solo recurring work, and Team Workspace for shared research teams.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

const plans = [
  {
    name: "Pay as you go",
    price: "Estimated after upload",
    priceCaption: "Buy a credit pack for one output.",
    forWho: "One deck, report, or Excel file.",
    accent: false,
    primary: { label: "Estimate one output", href: "/jobs/new" },
    secondary: null,
    bullets: [
      "Upload the brief and files.",
      "See the credit estimate before you pay.",
      "Buy the pack, run the output, download the files.",
      "No subscription. No free credits.",
    ],
    notIncluded: [
      "Workspace memory between outputs",
      "Stakeholder, brand, or template recall",
      "Shared team access",
    ],
  },
  {
    name: "Workspace Pro",
    price: "199",
    priceCaption: "per month, one user",
    forWho: "Solo consultants and independent professionals doing recurring research work.",
    accent: true,
    primary: { label: "Start the trial", href: "/get-started" },
    secondary: null,
    bullets: [
      "Private workspace with memory across recurring work.",
      "Brief, data, notes, templates, and past reviews stay together.",
      "Included monthly output usage at normal solo volume.",
      "Card-required 7-day trial. Cancel before day 7 and you are not charged.",
    ],
    notIncluded: [
      "Multi-user team access",
      "Shared projects and review trails",
      "Concierge onboarding",
    ],
  },
  {
    name: "Team Workspace",
    price: "From 500",
    priceCaption: "per month, 2 or more users",
    forWho: "Teams preparing recurring research outputs every month.",
    accent: false,
    primary: { label: "Talk about a team pilot", href: "/about" },
    secondary: null,
    bullets: [
      "Shared workspace, projects, roles, and review trails.",
      "Memory across brands, categories, stakeholders, templates, and prior reviews.",
      "Concierge onboarding: stakeholder map, KPI dictionary, retailer canon, last reviews.",
      "Normal team usage included; fair-use limits agreed in pilot.",
    ],
    notIncluded: [
      "SSO and SOC 2 Type 1 (planned, not shipped)",
      "Custom data residency",
      "Dedicated FMCG engineer",
    ],
  },
] as const;

const faqs = [
  {
    question: "Why is there no free plan?",
    answer:
      "Basquio is built for real client work with real files. Pay as you go lets you start with one output without subscribing or signing up for a free trial that will not last past the first deliverable.",
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
      "Yes, for selected outputs. Analyst review is an add-on after a generated run, not the default delivery model. It is not the homepage offer; the homepage offer is the workspace.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page pricing-page">
      <PublicSiteNav />

      <section className="page-hero pricing-j-hero">
        <div className="stack pricing-j-hero-copy">
          <p className="section-j-eyebrow">Pricing</p>
          <h1 className="pricing-j-title">Choose how you want to use Basquio.</h1>
          <p className="pricing-j-sub">
            Pay for one output when the work is occasional. Use Workspace Pro or Team Workspace when
            the context needs to stay alive between outputs.
          </p>
        </div>
      </section>

      <section className="pricing-j-stage">
        <div className="pricing-j-grid">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={
                plan.accent ? "pricing-j-card pricing-j-card-accent" : "pricing-j-card"
              }
            >
              {plan.accent ? (
                <span className="pricing-j-flag">Most teams start here</span>
              ) : null}
              <p className="pricing-j-card-name">{plan.name}</p>
              <p className="pricing-j-card-price">{plan.price}</p>
              <p className="pricing-j-card-price-caption">{plan.priceCaption}</p>
              <p className="pricing-j-card-for">{plan.forWho}</p>

              <Link className="pricing-j-card-cta" href={plan.primary.href}>
                {plan.primary.label}
                <span aria-hidden="true">→</span>
              </Link>

              <ul className="pricing-j-card-bullets">
                {plan.bullets.map((bullet) => (
                  <li key={bullet}>
                    <span className="pricing-j-tick" aria-hidden="true" />
                    {bullet}
                  </li>
                ))}
              </ul>

              <p className="pricing-j-card-not-label">Not included</p>
              <ul className="pricing-j-card-not">
                {plan.notIncluded.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
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
