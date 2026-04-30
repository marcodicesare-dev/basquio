import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollReveal } from "@/components/scroll-reveal";

export const metadata: Metadata = {
  title: "Chi siamo · Il team di Basquio",
  description:
    "Basquio è stato costruito da analisti e brand manager che hanno passato anni a scrivere category review FMCG e CPG a mano. Il workspace che volevamo usare è il workspace che abbiamo costruito.",
  alternates: { canonical: "https://basquio.com/about" },
};

const TEAM_MEMBERS = [
  {
    initials: "MD",
    name: "Marco Di Cesare",
    role: "Engineering",
    background:
      "Full-stack engineer. Costruisce la pipeline che trasforma brief, dati, appunti e template in presentazione, report e file Excel.",
  },
  {
    initials: "GM",
    name: "Giulia Monica",
    role: "Brand management",
    background:
      "Brand manager in Mondelez. La persona che riceve la presentazione e la presenta in riunione.",
  },
  {
    initials: "NIQ",
    name: "Analisti ex-NielsenIQ",
    role: "Ricerca di mercato",
    background:
      "Tre analisti che hanno lavorato in NielsenIQ e che vivevano il ciclo brief, dati, template, scadenza ogni settimana. Disegnano l'esperienza analista dentro Basquio.",
  },
] as const;

const EXPERIENCE_STATS = [
  { number: "20+", label: "anni cumulati di ricerca di mercato in FMCG e CPG" },
  { number: "500+", label: "category review costruite a mano da questo team" },
  { number: "1", label: "ingegnere che ha detto mai più" },
] as const;

export default function AboutPage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <section className="section-j section-j-page-hero" aria-labelledby="about-page-heading">
        <ScrollReveal className="section-j-page-hero-inner">
          <p className="section-j-eyebrow">Chi siamo</p>
          <h1 id="about-page-heading" className="section-j-page-title">
            Costruito da analisti FMCG e CPG che hanno vissuto questo lavoro.
          </h1>
          <p className="section-j-body">
            Basquio nasce da ingegneria, brand, category e ricerca di mercato dentro aziende
            FMCG e CPG. Sappiamo cosa è una buona category review perché ne abbiamo presentate
            centinaia.
          </p>
        </ScrollReveal>
      </section>

      <section className="section-j section-j-team" aria-labelledby="team-heading">
        <ScrollReveal className="section-j-team-head">
          <p className="section-j-eyebrow">Il team</p>
          <h2 id="team-heading" className="section-j-title">
            Un piccolo team che faceva queste presentazioni a mano.
          </h2>
        </ScrollReveal>

        <ScrollReveal className="section-j-team-grid" delay={120}>
          {TEAM_MEMBERS.map((member) => (
            <article key={member.initials} className="team-card-j">
              <div className="team-card-j-avatar" aria-hidden="true">
                {member.initials}
              </div>
              <h3 className="team-card-j-name">{member.name}</h3>
              <p className="team-card-j-role">{member.role}</p>
              <p className="team-card-j-background">{member.background}</p>
            </article>
          ))}
        </ScrollReveal>
      </section>

      <section className="section-j section-j-experience" aria-labelledby="experience-heading">
        <ScrollReveal className="section-j-experience-inner">
          <h2 id="experience-heading" className="section-j-experience-heading sr-only">
            Esperienza cumulata
          </h2>
          <ul className="section-j-experience-row" role="list">
            {EXPERIENCE_STATS.map((stat) => (
              <li key={stat.label} className="section-j-experience-cell">
                <span className="section-j-experience-number">{stat.number}</span>
                <span className="section-j-experience-label">{stat.label}</span>
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-stage section-j-stage-dark"
        aria-labelledby="thesis-heading"
      >
        <ScrollReveal className="section-j-stage-inner section-j-stage-inner-narrow">
          <p className="section-j-eyebrow section-j-eyebrow-light">La tesi</p>
          <h2 id="thesis-heading" className="section-j-title section-j-title-light">
            La ricerca ricorrente segue sempre gli stessi sette passi. La produzione richiede
            più tempo dell&apos;analisi.
          </h2>
          <p className="section-j-body section-j-body-light">
            I passi 1-3 sono analisi. I passi 4-7 sono produzione: tirare grafici, scrivere
            slide, controllare numeri, brandizzare la presentazione, scrivere il report,
            costruire il file Excel. Basquio prende i passi 4-7 perché il team possa restare
            sui passi 1-3.
          </p>
        </ScrollReveal>
      </section>

      <PublicSiteFooterCta
        eyebrow="Pronto a iniziare"
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
