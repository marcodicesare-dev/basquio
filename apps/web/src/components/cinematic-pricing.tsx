"use client";

import { useState } from "react";
import Link from "next/link";

type PricingPath = "payg" | "pro" | "team";

const paths: Record<
  PricingPath,
  {
    label: string;
    price: string;
    unit: string;
    headline: string;
    steps: string[];
    output: string[];
    note: string;
    cta: string;
    href: string;
  }
> = {
  payg: {
    label: "Pay as you go",
    price: "Credits",
    unit: "per output",
    headline: "Estimate credits, buy a pack, run one output.",
    steps: ["Add brief and files", "Estimate credits", "Buy credits", "Review files"],
    output: ["Deck", "Report", "Excel"],
    note: "Best when the work is one request and context does not need to live on.",
    cta: "Start one output",
    href: "/jobs/new",
  },
  pro: {
    label: "Workspace Pro",
    price: "$199",
    unit: "per month",
    headline: "One user keeps research context ready for recurring work.",
    steps: ["Save templates", "Keep past reviews", "Reuse brand rules", "Run the next ask"],
    output: ["Workspace", "History", "Files"],
    note: "Checkout-required 7-day trial. Built for a solo researcher with recurring outputs.",
    cta: "Start workspace trial",
    href: "/workspace-pro",
  },
  team: {
    label: "Team Workspace",
    price: "From $500",
    unit: "per month",
    headline: "Shared memory, projects, onboarding, and a team pilot.",
    steps: ["Map projects", "Assign roles", "Review together", "Keep decisions"],
    output: ["Projects", "Roles", "Review trail"],
    note: "Best when several people share sources, templates, stakeholders, and recurring work.",
    cta: "Plan a team pilot",
    href: "/team-workspace",
  },
};

export function CinematicPricingInterface() {
  const [path, setPath] = useState<PricingPath>("payg");
  const active = paths[path];

  return (
    <section className="pricing-cinema" aria-labelledby="pricing-cinema-title">
      <div className="pricing-cinema-copy">
        <p className="section-label light">Pricing</p>
        <h1 id="pricing-cinema-title">Pricing that follows the work.</h1>
        <p>
          Credits fit one-off output. Subscription fits recurring workspace memory. Team pricing fits
          shared research work.
        </p>
      </div>

      <div className="pricing-cinema-shell">
        <div className="pricing-path-tabs" aria-label="Pricing paths">
          {(Object.keys(paths) as PricingPath[]).map((key) => (
            <button
              type="button"
              key={key}
              className={path === key ? "pricing-path-tab active" : "pricing-path-tab"}
              onClick={() => setPath(key)}
            >
              <span>{paths[key].label}</span>
              <strong>{paths[key].price}</strong>
              <small>{paths[key].unit}</small>
            </button>
          ))}
        </div>

        <div className={`pricing-buying-interface pricing-${path}`}>
          <div className="pricing-flow">
            <p className="section-label light">{active.label}</p>
            <h2>{active.headline}</h2>
            <div className="pricing-step-line">
              {active.steps.map((step, index) => (
                <div key={step} className="pricing-step">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="pricing-output-preview">
            <div>
              <span>{active.price}</span>
              <strong>{active.unit}</strong>
            </div>
            <ul>
              {active.output.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>{active.note}</p>
            <Link className="button" href={active.href}>
              {active.cta}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PricingLogicStrip() {
  return (
    <section className="pricing-logic-strip">
      <article>
        <span>01</span>
        <strong>Credits</strong>
        <p>Use credits when you need one finished deck, report, and Excel file.</p>
      </article>
      <article>
        <span>02</span>
        <strong>Workspace</strong>
        <p>Subscribe when templates, past reviews, and preferences should stay ready.</p>
      </article>
      <article>
        <span>03</span>
        <strong>Team</strong>
        <p>Move to team when shared projects and reviews need a common memory.</p>
      </article>
    </section>
  );
}
