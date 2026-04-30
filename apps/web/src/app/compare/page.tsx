import { Check, Minus, X } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollReveal } from "@/components/scroll-reveal";

export const metadata: Metadata = {
  title: "Basquio rispetto a ChatGPT, Gamma, Tableau · Confronto",
  description:
    "Confronta Basquio con AI generaliste (ChatGPT, Claude), generatori di slide (Gamma, Tome, Beautiful.ai) e strumenti BI per trasformare i file di ricerca in presentazione, report e file Excel.",
  alternates: { canonical: "https://basquio.com/compare" },
};

const COMPARISON_ROWS = [
  {
    label: "Carica più file insieme come un solo pacchetto",
    genericAi: "Yes",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "Analisi controllata prima della consegna",
    genericAi: "No",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "PowerPoint editabile che puoi ricondividere",
    genericAi: "No",
    slideGenerators: "Yes",
    basquio: "Yes",
  },
  {
    label: "PowerPoint, report e file Excel da una sola richiesta",
    genericAi: "No",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "Zero prompt: carichi i file e parti",
    genericAi: "No",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Template di brand interpretato in automatico",
    genericAi: "No",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Tier gratuito senza registrazione",
    genericAi: "Yes",
    slideGenerators: "Yes",
    basquio: "No",
  },
  {
    label: "Strumento generalista (non solo presentazioni)",
    genericAi: "Yes",
    slideGenerators: "No",
    basquio: "No",
  },
] as const;

function CapabilityIcon({ value }: { value: string }) {
  if (value === "Yes") {
    return (
      <span className="cap-yes" aria-label="Supporto completo">
        <Check size={16} weight="bold" />
      </span>
    );
  }
  if (value === "Partial") {
    return (
      <span className="cap-partial" aria-label="Supporto parziale">
        <Minus size={16} weight="bold" />
      </span>
    );
  }
  if (value === "No") {
    return (
      <span className="cap-no" aria-label="Non disponibile">
        <X size={16} weight="bold" />
      </span>
    );
  }
  return <span aria-hidden="true">.</span>;
}

const ANTI_PATTERNS = [
  {
    title: "La tua category review è domani.",
    body: "ChatGPT può scrivere bullet. Gamma può comporre slide. Solo Basquio legge i file di ricerca, controlla i numeri e ti consegna una presentazione brandizzata con grafici costruiti dai tuoi dati.",
  },
  {
    title: "Il management vuole una storia da tre tracker diversi.",
    body: "Gli altri strumenti ti fanno copiare e incollare numeri in un prompt e sperare che nulla cambi. Basquio carica i file direttamente, calcola gli scostamenti e costruisce la narrativa attorno a quello che è davvero cambiato.",
  },
] as const;

export default function ComparePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <section className="section-j section-j-page-hero" aria-labelledby="compare-page-heading">
        <ScrollReveal className="section-j-page-hero-inner">
          <p className="section-j-eyebrow">Confronto</p>
          <h1 id="compare-page-heading" className="section-j-page-title">
            Quello che conta quando la presentazione deve passare la review.
          </h1>
          <p className="section-j-body">
            Le AI generaliste sanno scrivere. I generatori di slide sanno impaginare. Nessuno
            dei due legge i tuoi file, controlla i numeri o ti consegna una presentazione
            brandizzata. Basquio sì.
          </p>
        </ScrollReveal>
      </section>

      <section className="section-j section-j-comparison" aria-labelledby="comparison-heading">
        <ScrollReveal className="section-j-comparison-inner">
          <header className="section-j-comparison-head">
            <h2 id="comparison-heading" className="section-j-title">
              Capacità per capacità.
            </h2>
            <ul className="comparison-legend-j" role="list">
              <li>
                <Check size={14} weight="bold" /> Supporto completo
              </li>
              <li>
                <Minus size={14} weight="bold" /> Supporto parziale
              </li>
              <li>
                <X size={14} weight="bold" /> Non disponibile
              </li>
            </ul>
          </header>

          <div className="comparison-table-wrap-j">
            <table className="comparison-table-j">
              <thead>
                <tr>
                  <th scope="col">Capacità</th>
                  <th scope="col">ChatGPT / Claude</th>
                  <th scope="col">Gamma / Tome / Beautiful.ai</th>
                  <th scope="col" className="comparison-positive-j">
                    Basquio
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>
                      <CapabilityIcon value={row.genericAi} />
                    </td>
                    <td>
                      <CapabilityIcon value={row.slideGenerators} />
                    </td>
                    <td className="comparison-positive-j">
                      <CapabilityIcon value={row.basquio} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-stage section-j-stage-dark"
        aria-labelledby="anti-pattern-heading"
      >
        <ScrollReveal className="section-j-stage-inner">
          <header className="section-j-head">
            <p className="section-j-eyebrow section-j-eyebrow-light">Cosa significa</p>
            <h2 id="anti-pattern-heading" className="section-j-title section-j-title-light">
              Due situazioni in cui la differenza si vede.
            </h2>
          </header>

          <div className="section-j-cards">
            {ANTI_PATTERNS.map((card) => (
              <article key={card.title} className="section-j-card">
                <h3 className="section-j-card-title">{card.title}</h3>
                <p className="section-j-card-body">{card.body}</p>
              </article>
            ))}
          </div>
        </ScrollReveal>
      </section>

      <PublicSiteFooterCta
        eyebrow="Pronto a vederlo"
        title="Inizia con un output. O imposta il workspace."
        copy="Carica il brief e i file per un singolo lavoro. Se il lavoro torna il mese prossimo, tieni il contesto in un workspace."
        primaryLabel="Avvia un output"
        primaryHref="/jobs/new"
        secondaryLabel="Vedi il workspace"
        secondaryHref="/#workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
