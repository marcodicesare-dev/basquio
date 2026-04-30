"use client";

import { useState } from "react";
import Link from "next/link";

type BuyingMode = "one" | "workspace" | "team";

type ModeContent = {
  label: string;
  caption: string;
  provide: string[];
  receive: string[];
  price: string;
  priceCaption: string;
  ctaLabel: string;
  ctaHref: string;
  trial: string | null;
};

const buyingModes: Record<BuyingMode, ModeContent> = {
  one: {
    label: "One output",
    caption: "Pay as you go",
    provide: [
      "Brief in plain language",
      "Data files (CSV or Excel)",
      "Optional notes and old deck",
      "Optional brand template",
    ],
    receive: [
      "Estimated cost before you pay",
      "Credit pack sized to the work",
      "One run produces deck, report, and Excel",
      "Download the files when the run completes",
    ],
    price: "Estimated after upload",
    priceCaption: "No subscription. No free credits.",
    ctaLabel: "Estimate one output",
    ctaHref: "/jobs/new",
    trial: null,
  },
  workspace: {
    label: "Workspace",
    caption: "199 / month",
    provide: [
      "Recurring clients, brands, and projects",
      "Briefs, notes, transcripts, past reviews",
      "Brand rules and approved templates",
      "Stakeholder preferences over time",
    ],
    receive: [
      "Private workspace memory across runs",
      "Included monthly output usage",
      "Charts, decks, reports, and workbooks",
      "The next ask starts closer to done",
    ],
    price: "199",
    priceCaption: "per month, one user",
    ctaLabel: "Start the trial",
    ctaHref: "/get-started",
    trial: "Card required. Charged on day 7. Cancel anytime before then.",
  },
  team: {
    label: "Team",
    caption: "From 500 / month",
    provide: [
      "Team projects and roles",
      "Shared brand rules and templates",
      "Stakeholder map across functions",
      "Recurring deliverable rhythm",
    ],
    receive: [
      "Shared workspace and projects",
      "Memory across brands and stakeholders",
      "Concierge onboarding (stakeholder map, KPI dictionary, last reviews)",
      "Normal team usage included",
    ],
    price: "From 500",
    priceCaption: "per month, two or more users",
    ctaLabel: "Talk about a team pilot",
    ctaHref: "/about",
    trial: null,
  },
};

const modeOrder: BuyingMode[] = ["one", "workspace", "team"];

export function BuyingInterface({
  variant = "homepage",
  defaultMode,
}: {
  variant?: "homepage" | "pricing";
  defaultMode?: BuyingMode;
}) {
  const initialMode: BuyingMode =
    defaultMode ?? (variant === "pricing" ? "one" : "workspace");
  const [mode, setMode] = useState<BuyingMode>(initialMode);
  const active = buyingModes[mode];

  return (
    <div className={`buying-iface buying-iface-${variant}`}>
      <div
        role="radiogroup"
        aria-label="Choose how you want to use Basquio"
        className="buying-iface-modes"
      >
        {modeOrder.map((m) => {
          const content = buyingModes[m];
          const selected = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className={
                selected ? "buying-iface-mode buying-iface-mode-active" : "buying-iface-mode"
              }
              onClick={() => setMode(m)}
            >
              <span className="buying-iface-mode-radio" aria-hidden="true">
                <span className="buying-iface-mode-radio-dot" />
              </span>
              <span className="buying-iface-mode-text">
                <span className="buying-iface-mode-label">{content.label}</span>
                <span className="buying-iface-mode-caption">{content.caption}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="buying-iface-body">
        <section className="buying-iface-col" aria-labelledby={`buying-provide-${mode}`}>
          <h3 id={`buying-provide-${mode}`} className="buying-iface-col-head">
            You provide
          </h3>
          <ul className="buying-iface-list">
            {active.provide.map((line) => (
              <li key={line}>
                <span className="buying-iface-tick" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section className="buying-iface-col" aria-labelledby={`buying-receive-${mode}`}>
          <h3 id={`buying-receive-${mode}`} className="buying-iface-col-head">
            What you get
          </h3>
          <ul className="buying-iface-list">
            {active.receive.map((line) => (
              <li key={line}>
                <span className="buying-iface-tick buying-iface-tick-amber" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        </section>

        <aside className="buying-iface-checkout" aria-labelledby={`buying-price-${mode}`}>
          <p className="buying-iface-price-eyebrow">Price</p>
          <p id={`buying-price-${mode}`} className="buying-iface-price">
            {active.price}
          </p>
          <p className="buying-iface-price-caption">{active.priceCaption}</p>
          <p
            className={
              active.trial
                ? "buying-iface-trial"
                : "buying-iface-trial buying-iface-trial-empty"
            }
            aria-hidden={active.trial ? undefined : true}
          >
            {active.trial ?? "."}
          </p>
          <Link className="buying-iface-cta" href={active.ctaHref}>
            {active.ctaLabel}
            <span aria-hidden="true">→</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}
