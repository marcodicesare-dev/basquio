"use client";

import Link from "next/link";

/**
 * BuyingInterface · three persistent vertical columns.
 *
 * Replaces the prior radio-toggle pattern that the team flagged in the May
 * 2026 review: "the radio buttons overlap the columns. It seems like 'what
 * you get' is in the previous thing." The new layout shows Output, Workspace,
 * and Team side by side. Each column is self-contained with its own price,
 * "for X" subhead, what you provide, what you get, and CTA.
 *
 * Workspace is highlighted as the recommended path. Output gets a worked
 * cost example so visitors do not have to guess whether one analysis costs
 * one dollar or a thousand.
 */

type Tier = {
  id: "one" | "workspace" | "team";
  label: string;
  forWho: string;
  price: string;
  priceCaption: string;
  example?: string;
  provide: string[];
  receive: string[];
  ctaLabel: string;
  ctaHref: string;
  trial: string | null;
  highlighted?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "one",
    label: "One output",
    forWho: "For a single analysis without a recurring workflow",
    price: "From $19",
    priceCaption: "Pay per output, no subscription",
    example: "Complete analysis, 10 slides, from $19. Larger decks priced per upload.",
    provide: [
      "Brief in plain language",
      "Data files (CSV, Excel)",
      "Optional notes or old deck",
      "Optional brand template",
    ],
    receive: [
      "Estimated cost before you pay",
      "Deck, narrative report, and Excel",
      "Numbers reconcile across all three files",
      "Download when the run completes",
    ],
    ctaLabel: "Estimate one output",
    ctaHref: "/jobs/new",
    trial: null,
  },
  {
    id: "workspace",
    label: "Workspace",
    forWho: "For individual contributors with recurring research",
    price: "$199",
    priceCaption: "per month, one user",
    example: "Includes monthly output usage. The next ask starts closer to done.",
    provide: [
      "Recurring clients, brands, projects",
      "Briefs, notes, transcripts, past reviews",
      "Brand rules and approved templates",
      "Stakeholder preferences over time",
    ],
    receive: [
      "Private workspace memory across runs",
      "Included monthly output usage",
      "Charts, decks, reports, workbooks",
      "The next ask starts closer to done",
    ],
    ctaLabel: "Start a 7-day trial",
    ctaHref: "/get-started",
    trial: "Card required. Charged on day 7. Cancel anytime before then.",
    highlighted: true,
  },
  {
    id: "team",
    label: "Team",
    forWho: "For enterprises with multiple users and shared context",
    price: "Custom",
    priceCaption: "two or more users",
    example: "Concierge onboarding: stakeholder map, KPI dictionary, last reviews.",
    provide: [
      "Team projects and roles",
      "Shared brand rules and templates",
      "Stakeholder map across functions",
      "Recurring deliverable rhythm",
    ],
    receive: [
      "Shared workspace and projects",
      "Memory across brands and stakeholders",
      "Concierge onboarding",
      "Team usage included",
    ],
    ctaLabel: "Talk about a team pilot",
    ctaHref: "/about",
    trial: null,
  },
];

export function BuyingInterface({
  variant = "homepage",
}: {
  variant?: "homepage" | "pricing";
}) {
  return (
    <div className={`buying-iface buying-iface-${variant} buying-iface-grid`}>
      {TIERS.map((tier) => (
        <article
          key={tier.id}
          className={
            tier.highlighted
              ? "buying-iface-card buying-iface-card-highlighted"
              : "buying-iface-card"
          }
          aria-labelledby={`buying-card-${tier.id}-label`}
        >
          {tier.highlighted && (
            <p className="buying-iface-card-flag" aria-hidden="true">
              Recommended
            </p>
          )}

          <header className="buying-iface-card-head">
            <p id={`buying-card-${tier.id}-label`} className="buying-iface-card-label">
              {tier.label}
            </p>
            <p className="buying-iface-card-for">{tier.forWho}</p>
          </header>

          <div className="buying-iface-card-price-block">
            <p className="buying-iface-card-price">{tier.price}</p>
            <p className="buying-iface-card-price-caption">{tier.priceCaption}</p>
            {tier.example && (
              <p className="buying-iface-card-example">{tier.example}</p>
            )}
          </div>

          <Link className="buying-iface-card-cta" href={tier.ctaHref}>
            {tier.ctaLabel}
            <span aria-hidden="true">→</span>
          </Link>

          <div className="buying-iface-card-lists">
            <section
              className="buying-iface-card-section"
              aria-labelledby={`buying-card-${tier.id}-provide`}
            >
              <h3
                id={`buying-card-${tier.id}-provide`}
                className="buying-iface-card-section-head"
              >
                You provide
              </h3>
              <ul className="buying-iface-card-list">
                {tier.provide.map((line) => (
                  <li key={line}>
                    <span className="buying-iface-card-tick" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </section>

            <section
              className="buying-iface-card-section"
              aria-labelledby={`buying-card-${tier.id}-receive`}
            >
              <h3
                id={`buying-card-${tier.id}-receive`}
                className="buying-iface-card-section-head"
              >
                What you get
              </h3>
              <ul className="buying-iface-card-list">
                {tier.receive.map((line) => (
                  <li key={line}>
                    <span
                      className="buying-iface-card-tick buying-iface-card-tick-amber"
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </article>
      ))}
    </div>
  );
}
