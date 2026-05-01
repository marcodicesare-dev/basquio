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
    label: "Un output",
    forWho: "Per una singola analisi senza un flusso ricorrente",
    price: "Da $19",
    priceCaption: "Paghi per output, nessun abbonamento",
    example: "Analisi completa, 10 slide, da $19. Per deck più grandi il prezzo si calcola al caricamento.",
    provide: [
      "Brief in linguaggio semplice",
      "File dati (CSV, Excel)",
      "Appunti o vecchio deck (opzionali)",
      "Template di brand (opzionale)",
    ],
    receive: [
      "Stima del costo prima di pagare",
      "Presentazione, report e file Excel",
      "I numeri tornano fra i tre file",
      "Scarichi quando la generazione finisce",
    ],
    ctaLabel: "Stima un output",
    ctaHref: "/jobs/new",
    trial: null,
  },
  {
    id: "workspace",
    label: "Workspace",
    forWho: "Per chi fa ricerca ricorrente in autonomia",
    price: "$199",
    priceCaption: "al mese, un utente",
    example: "Include l'uso mensile. La prossima richiesta parte già più vicino al risultato.",
    provide: [
      "Clienti, brand e progetti ricorrenti",
      "Brief, appunti, trascrizioni, review passate",
      "Regole di brand e template approvati",
      "Preferenze degli stakeholder nel tempo",
    ],
    receive: [
      "Memoria privata fra le generazioni",
      "Uso mensile di output incluso",
      "Grafici, presentazioni, report, file Excel",
      "La prossima richiesta parte già pronta",
    ],
    ctaLabel: "Avvia la prova di 7 giorni",
    ctaHref: "/get-started",
    trial: "Serve la carta. Addebito al giorno 7. Cancelli quando vuoi prima.",
    highlighted: true,
  },
  {
    id: "team",
    label: "Team",
    forWho: "Per aziende con più utenti e contesto condiviso",
    price: "Custom",
    priceCaption: "due o più utenti",
    example: "Onboarding concierge: mappa stakeholder, dizionario KPI, review precedenti.",
    provide: [
      "Progetti e ruoli del team",
      "Regole di brand e template condivisi",
      "Mappa stakeholder per funzione",
      "Ritmo ricorrente delle consegne",
    ],
    receive: [
      "Workspace e progetti condivisi",
      "Memoria fra brand e stakeholder",
      "Onboarding concierge",
      "Uso del team incluso",
    ],
    ctaLabel: "Parlaci di un pilota team",
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
              Consigliato
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
                Cosa fornisci
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
                Cosa ricevi
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
