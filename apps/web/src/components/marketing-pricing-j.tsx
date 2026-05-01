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
    forWho: "Per un'analisi occasionale, una tantum",
    price: "Da $19",
    priceCaption: "Paghi per output, nessun abbonamento",
    example: "Analisi da 10 slide a partire da $19. La stima ti arriva prima di pagare, dimensionata sul lavoro.",
    provide: [
      "Il brief, in linguaggio semplice",
      "I tuoi dati: CSV, Excel, PDF",
      "Il tuo template di brand (opzionale)",
    ],
    receive: [
      "Una presentazione modificabile, un report narrativo e un file Excel",
      "Ogni grafico cita la riga della fonte",
      "Stima del costo prima di pagare, scarichi quando la generazione finisce",
    ],
    ctaLabel: "Stima un output",
    ctaHref: "/jobs/new",
    trial: null,
  },
  {
    id: "workspace",
    label: "Workspace",
    forWho: "Per analisti e consulenti con clienti ricorrenti",
    price: "$199",
    priceCaption: "al mese, un utente",
    example: "Il workspace diventa più affilato ogni mese. La quinta presentazione esce più veloce della prima, perché brand e brief sono già dentro.",
    provide: [
      "I tuoi clienti, brand e progetti ricorrenti",
      "Brief, appunti, trascrizioni, review passate",
      "Le tue regole di brand e i template approvati",
      "Gli stakeholder a cui presenti, con le loro preferenze",
    ],
    receive: [
      "Una memoria privata del tuo lavoro che si accumula a ogni richiesta",
      "La prossima presentazione parte con brand, brief e ultima review già al loro posto",
      "Uso mensile di output incluso, nessuna stima per richiesta",
    ],
    ctaLabel: "Avvia la prova di 7 giorni",
    ctaHref: "/get-started",
    trial: null,
    highlighted: true,
  },
  {
    id: "team",
    label: "Team",
    forWho: "Per team di ricerca con brand e stakeholder condivisi",
    price: "Custom",
    priceCaption: "due o più utenti",
    example: "La memoria condivisa fa entrare un nuovo analista in giorni, non settimane. Le ultime 50 presentazioni del team sono il punto di partenza, non una cartella da scavare.",
    provide: [
      "Il tuo team, con ruoli per analisti, lead e reviewer",
      "Regole di brand condivise e una libreria di template gestita",
      "Una mappa stakeholder fra funzioni e brand",
    ],
    receive: [
      "Memoria che si accumula sul team, non solo su un analista",
      "Onboarding concierge: mappa stakeholder, dizionario KPI, deck passati",
      "Uso di team incluso, fatturazione personalizzata",
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
