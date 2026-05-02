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
    label: "One analysis",
    forWho: "For one-off projects",
    price: "From €19",
    priceCaption: "Pay per analysis, no subscription",
    example: "10 slides from €19. Pay only what the work is worth.",
    provide: [
      "Brief and data",
      "Brand template (optional)",
    ],
    receive: [
      "Editable deck, narrative report, Excel workbook",
      "Source row cited on every chart",
      "Estimate before you pay",
    ],
    ctaLabel: "Estimate one analysis",
    ctaHref: "/jobs/new",
    trial: null,
  },
  {
    id: "workspace",
    label: "Workspace",
    forWho: "For analysts with recurring clients",
    price: "€199",
    priceCaption: "per month, one user",
    example: "Deck five lands faster than deck one. Brand and brief already in.",
    provide: [
      "Your recurring clients and brands",
      "Past briefs, notes, reviews",
      "Approved templates and brand rules",
      "Stakeholder preferences",
    ],
    receive: [
      "A private memory that compounds run after run",
      "The next deck starts pre-loaded",
      "Monthly analysis usage included",
    ],
    ctaLabel: "Start a 7-day trial",
    ctaHref: "/get-started",
    trial: null,
    highlighted: true,
  },
  {
    id: "team",
    label: "Team",
    forWho: "For research teams with shared brands",
    price: "Custom",
    priceCaption: "two or more users",
    example: "A new analyst onboards in days, not weeks.",
    provide: [
      "Your team, with roles",
      "Shared brand rules and templates",
      "Stakeholder map across the team",
    ],
    receive: [
      "Memory that compounds across the team",
      "Concierge onboarding",
      "Custom invoicing",
    ],
    ctaLabel: "Talk to us",
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
