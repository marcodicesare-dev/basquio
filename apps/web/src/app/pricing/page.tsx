import type { Metadata } from "next";

import { PricingPathSwitcher } from "@/components/pricing-path-switcher";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Basquio pricing for pay as you go outputs, Workspace Pro, and Team Workspace pilots.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

const plans = [
  {
    name: "Pay as you go",
    price: "Estimate first",
    copy: "For one output. Add material, see the credit estimate, buy credits, run files.",
  },
  {
    name: "Workspace Pro",
    price: "$199/month",
    copy: "One user. Card-required 7-day trial. Private workspace memory plus output usage.",
  },
  {
    name: "Team Workspace",
    price: "From $500/month",
    copy: "Shared memory, projects, onboarding, pilot setup, and normal team usage.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-pricing-landing">
        <div className="mstudio-pricing-copy">
          <p className="section-label">Pricing</p>
          <h1>Pricing that matches the work.</h1>
          <p>
            Use credits when you need one output. Use a workspace when the same research context
            will matter again.
          </p>
        </div>
        <PricingPathSwitcher />
      </section>

      <section className="mstudio-plan-row">
        {plans.map((plan) => (
          <article key={plan.name}>
            <span>{plan.name}</span>
            <strong>{plan.price}</strong>
            <p>{plan.copy}</p>
          </article>
        ))}
      </section>

      <section className="mstudio-split">
        <div>
          <p className="section-label">Decision logic</p>
          <h2>Do not buy a subscription for a one-off file. Do not buy credits for a team habit.</h2>
        </div>
        <div className="mstudio-copy-stack">
          <p>Credits keep the first run simple because scope changes with the material.</p>
          <p>Workspace Pro is for the person who repeats the work and wants the context remembered.</p>
          <p>Team Workspace is for shared projects where memory, roles, review history, and onboarding matter.</p>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to price the work"
        title="Start with the buying path that matches the job."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="Talk to us"
        secondaryHref="/get-started"
      />
      <PublicSiteFooter />
    </div>
  );
}
