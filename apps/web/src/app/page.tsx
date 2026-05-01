import type { Metadata } from "next";
import Link from "next/link";

import { BuyingInterface } from "@/components/marketing-pricing-j";
import { MarketingHeroJ } from "@/components/marketing-hero-j";
import {
  ReportExcerptMockup,
  SecurityAuditMockup,
  WorkbookMockup,
  WorkspaceHomeMockup,
} from "@/components/marketing-mockups";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { MotionSectionHead } from "@/components/motion-section-head";
import { ScrollReveal } from "@/components/scroll-reveal";
import { WorkflowBigBlocks } from "@/components/workflow-big-blocks";

export const metadata: Metadata = {
  title: "Basquio · Da file di ricerca a presentazione, report e file Excel",
  description:
    "Basquio trasforma brief, dati, appunti e template nella presentazione, nel report e nel file Excel che il tuo stakeholder ti ha chiesto. Per il lavoro ricorrente, il workspace ricorda cliente, brand, template e review precedenti.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio · From research files to finished decks, reports, and workbooks",
    description:
      "Basquio trasforma brief, dati, appunti e template nella presentazione, nel report e nel file Excel che il tuo stakeholder ti ha chiesto.",
  },
};

export default function HomePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <MarketingHeroJ />

      <div id="how-it-works">
        <WorkflowBigBlocks />
      </div>

      <section className="section-j section-j-stack" id="workspace" aria-labelledby="workspace-heading">
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Workspace</p>
          <h2 id="workspace-heading" className="section-j-title">
            Un workspace che impara il brand, il brief e l&apos;analista.
          </h2>
          <p className="section-j-body">
            Cliente, template, review passate, stakeholder. Tutto in un posto. La prossima
            presentazione parte già più vicina al risultato.
          </p>
          <Link className="section-j-link" href="/#workspace">
            Vedi il workspace
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <WorkspaceHomeMockup />
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-buying section-j-stage section-j-stage-dark"
        id="pricing-preview"
        aria-labelledby="buying-heading"
      >
        <ScrollReveal className="section-j-stage-inner">
          <header className="section-j-head">
            <p className="section-j-eyebrow section-j-eyebrow-light">Prezzi</p>
            <h2 id="buying-heading" className="section-j-title section-j-title-light">
              Paga un output. O tieni il lavoro nel workspace.
            </h2>
            <p className="section-j-body section-j-body-light">
              Tre modi per usare Basquio. Scegli quello che corrisponde al tuo lavoro.
            </p>
          </header>

          <BuyingInterface variant="homepage" />
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-stack"
        id="numbers-reconcile"
        aria-labelledby="reconciliation-heading"
      >
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Workbook</p>
          <h2 id="reconciliation-heading" className="section-j-title">
            Ogni grafico ha una riga nel workbook. Ogni affermazione ha una fonte.
          </h2>
          <p className="section-j-body">
            I 1,9 punti di share di slide 04 corrispondono alla riga 4 del file Excel e alla
            sezione 2 del report. Quando lo stakeholder ti contraddice, la risposta è a un clic.
          </p>
          <Link className="section-j-link" href="/jobs/new">
            Vedi il workbook nell&apos;output
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <WorkbookMockup />
        </ScrollReveal>
      </section>

      <section className="section-j section-j-stack" aria-labelledby="about-heading">
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Chi siamo</p>
          <h2 id="about-heading" className="section-j-title">
            Costruito da analisti FMCG e CPG che hanno vissuto questo lavoro.
          </h2>
          <p className="section-j-body">
            Basquio nasce da ingegneria, brand, category e ricerca di mercato dentro aziende FMCG
            e CPG.
          </p>
          <Link className="section-j-link" href="/about">
            Conosci il team
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <ReportExcerptMockup />
        </ScrollReveal>
      </section>

      <section className="section-j section-j-stack" aria-labelledby="security-heading">
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Sicurezza</p>
          <h2 id="security-heading" className="section-j-title">
            Gestione dei dati chiara prima di caricare.
          </h2>
          <p className="section-j-body">
            Niente training del modello sui dati cliente. Isolamento per workspace. SOC 2 Type 1 in
            arrivo, non dichiarata.
          </p>
          <Link className="section-j-link" href="/security">
            Leggi i dettagli sulla sicurezza
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <SecurityAuditMockup />
        </ScrollReveal>
      </section>

      <PublicSiteFooterCta
        eyebrow="Pronto a iniziare"
        title="Inizia con un output. O imposta il workspace."
        copy="Carica il brief e i file per un singolo lavoro. Se il lavoro torna il mese prossimo, tieni il contesto in un workspace."
        primaryLabel="Avvia un output"
        primaryHref="/jobs/new"
        secondaryLabel="Vedi il workspace"
        secondaryHref="#workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
