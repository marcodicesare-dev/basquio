"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PathId = "payg" | "pro" | "team";

const paths: Array<{
  id: PathId;
  label: string;
  price: string;
  detail: string;
  steps: string[];
  bestFor: string;
  cta: string;
  href: string;
}> = [
  {
    id: "payg",
    label: "Pay as you go",
    price: "Estimate first",
    detail: "Buy credits for one output after Basquio sees the brief and material.",
    steps: ["Add material", "See estimate", "Buy credits", "Run files"],
    bestFor: "One deck, report, or Excel file without a workspace commitment.",
    cta: "Start one output",
    href: "/jobs/new",
  },
  {
    id: "pro",
    label: "Workspace Pro",
    price: "$199/month",
    detail: "One private workspace for recurring work. 7-day trial requires checkout.",
    steps: ["Add templates", "Save context", "Run outputs", "Reuse memory"],
    bestFor: "Solo consultants and power users with repeat clients or projects.",
    cta: "Start Workspace Pro",
    href: "/get-started",
  },
  {
    id: "team",
    label: "Team Workspace",
    price: "From $500/month",
    detail: "Shared projects, roles, memory, onboarding, and pilot support.",
    steps: ["Map projects", "Invite team", "Run pilot", "Set fair use"],
    bestFor: "Insight, category, brand, trade, and strategy teams doing monthly research work.",
    cta: "Talk about Team Workspace",
    href: "/get-started",
  },
];

export function PricingPathSwitcher() {
  const [activeId, setActiveId] = useState<PathId>("team");
  const active = useMemo(() => paths.find((path) => path.id === activeId) ?? paths[2], [activeId]);

  return (
    <section className="mstudio-pricing-tool" aria-labelledby="pricing-tool-title">
      <div className="mstudio-section-head">
        <p className="section-label">Pricing model</p>
        <h2 id="pricing-tool-title">Choose the way the work repeats.</h2>
      </div>
      <div className="mstudio-price-tabs" aria-label="Pricing paths">
        {paths.map((path) => (
          <button
            key={path.id}
            type="button"
            className={path.id === active.id ? "active" : ""}
            aria-pressed={path.id === active.id}
            onClick={() => setActiveId(path.id)}
          >
            {path.label}
          </button>
        ))}
      </div>
      <div key={active.id} className={`mstudio-price-surface mstudio-price-${active.id}`}>
        <article className="mstudio-price-card">
          <p>{active.label}</p>
          <h3>{active.price}</h3>
          <span>{active.detail}</span>
          <Link className="button" href={active.href}>
            {active.cta}
          </Link>
        </article>
        <div className="mstudio-price-steps">
          {active.steps.map((step, index) => (
            <span key={step}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              {step}
            </span>
          ))}
        </div>
        <p className="mstudio-price-fit">{active.bestFor}</p>
      </div>
    </section>
  );
}
