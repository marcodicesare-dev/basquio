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
    forWho: "For an occasional, one-off analysis",
    price: "From $19",
    priceCaption: "Pay per output, no subscription",
    example: "10-slide analysis from $19. The estimate comes back before you pay, sized to the work.",
    provide: [
      "The brief, in plain language",
      "Your data: CSV, Excel, PDFs",
      "Your brand template (optional)",
    ],
    receive: [
      "An editable deck, a narrative report, and an Excel workbook",
      "Every chart cites the source row",
      "Estimated cost before you pay, downloaded when the run finishes",
    ],
    ctaLabel: "Estimate one output",
    ctaHref: "/jobs/new",
    trial: null,
  },
  {
    id: "workspace",
    label: "Workspace",
    forWho: "For analysts and consultants with recurring clients",
    price: "$199",
    priceCaption: "per month, one user",
    example: "The workspace gets sharper every month. Deck five lands faster than deck one because the brand and the brief are already in.",
    provide: [
      "Your recurring clients, brands, and projects",
      "Briefs, notes, transcripts, past reviews",
      "Your brand rules and approved templates",
      "The stakeholders you present to, with their preferences",
    ],
    receive: [
      "A private memory of your work that compounds run after run",
      "The next deck starts with the brand, the brief, and the last review already in place",
      "Monthly output usage included, no per-run estimates",
    ],
    ctaLabel: "Start a 7-day trial",
    ctaHref: "/get-started",
    trial: null,
    highlighted: true,
  },
  {
    id: "team",
    label: "Team",
    forWho: "For research teams with shared brands and stakeholders",
    price: "Custom",
    priceCaption: "two or more users",
    example: "Shared memory means a new analyst onboards in days, not weeks. The team's last 50 decks are the starting point, not a folder to dig through.",
    provide: [
      "Your team, with roles for analysts, leads, and reviewers",
      "Shared brand rules and a managed template library",
      "A stakeholder map across functions and brands",
    ],
    receive: [
      "Memory that compounds across the team, not just one analyst",
      "Concierge onboarding: stakeholder map, KPI dictionary, past decks",
      "Team output usage included, custom invoicing",
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
