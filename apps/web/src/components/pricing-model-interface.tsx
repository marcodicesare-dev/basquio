"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PricingPath = "one-output" | "workspace" | "team";

const paths: Array<{
  id: PricingPath;
  label: string;
  price: string;
  unit: string;
  fit: string;
  cta: string;
  href: string;
  steps: string[];
  includes: string[];
  why: string;
}> = [
  {
    id: "one-output",
    label: "Pay as you go",
    price: "Estimate first",
    unit: "buy credits per output",
    fit: "For a single deck, report, or Excel package.",
    cta: "Estimate one output",
    href: "/jobs/new",
    steps: ["Upload material", "Estimate credits", "Buy pack", "Run files"],
    includes: ["Deck", "Report", "Excel", "Credit pack"],
    why: "Credits fit one-off work because the scope changes with the files.",
  },
  {
    id: "workspace",
    label: "Workspace Pro",
    price: "$199",
    unit: "per month, one user",
    fit: "For recurring research work that should remember context.",
    cta: "Start workspace trial",
    href: "/get-started",
    steps: ["Add templates", "Save reviews", "Keep context", "Run next ask"],
    includes: ["One user", "7-day trial", "Checkout required", "Recurring context"],
    why: "Subscription fits continuity because the workspace keeps what the next request needs.",
  },
  {
    id: "team",
    label: "Team Workspace",
    price: "From $500",
    unit: "per month",
    fit: "For teams sharing projects, formats, and review history.",
    cta: "Plan a team pilot",
    href: "/get-started",
    steps: ["Set projects", "Invite roles", "Review outputs", "Scale formats"],
    includes: ["Shared memory", "Projects", "Onboarding", "Pilot"],
    why: "Team pricing fits shared recurring work because quality depends on common context.",
  },
];

const material = ["Brief", "Data", "Notes", "Old deck", "Template"] as const;

export function PricingModelInterface() {
  const [activeId, setActiveId] = useState<PricingPath>("one-output");
  const active = useMemo(() => paths.find((path) => path.id === activeId) ?? paths[0], [activeId]);

  return (
    <section className="pricing-model-interface" aria-labelledby="pricing-model-title">
      <div className="pricing-model-head">
        <div className="stack-xs">
          <p className="section-label">Pricing model</p>
          <h2 id="pricing-model-title">Pay for the kind of research work you are doing.</h2>
        </div>
        <div className="pricing-path-tabs" aria-label="Pricing paths">
          {paths.map((path) => (
            <button
              key={path.id}
              type="button"
              className={path.id === active.id ? "pricing-path-tab active" : "pricing-path-tab"}
              aria-pressed={path.id === active.id}
              onClick={() => setActiveId(path.id)}
            >
              {path.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`pricing-buying-surface pricing-buying-surface-${active.id}`}>
        <div className="pricing-material-panel">
          <p className="pricing-panel-label">Material</p>
          <div className="pricing-material-list">
            {material.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div className="pricing-flow-panel" aria-label={`${active.label} workflow`}>
          {active.steps.map((step, index) => (
            <div key={step} className="pricing-flow-step">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>

        <article className="pricing-path-card">
          <p className="pricing-panel-label">{active.label}</p>
          <div>
            <p className="pricing-path-price">{active.price}</p>
            <p className="pricing-path-unit">{active.unit}</p>
          </div>
          <p>{active.fit}</p>
          <div className="pricing-includes">
            {active.includes.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <Link className="button" href={active.href}>
            {active.cta}
          </Link>
        </article>
      </div>

      <p className="pricing-model-why">{active.why}</p>
    </section>
  );
}
