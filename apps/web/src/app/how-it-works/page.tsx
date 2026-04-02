import type { Metadata } from "next";
import Image from "next/image";

import { evidencePackageInputs, howItWorksChecks, howItWorksPhases } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "How Basquio Works — From Data Upload to Finished Analysis Deck",
  description:
    "Upload CSV or Excel files, Basquio analyzes the data, computes metrics, generates real charts, and delivers a branded PPTX, narrative report, and data workbook in one automated workflow.",
  alternates: { canonical: "https://basquio.com/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">How it works</p>
              <h1>Four stages. One accountable deck engine.</h1>
              <p className="page-copy">
                You upload one evidence package: the CSVs, spreadsheets, PDFs, briefs, and brand files behind a single
                reporting cycle. Basquio reads every file, computes the numbers, shapes the story, checks the artifacts,
                and delivers a deck you can present.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">What you upload</p>
            <ul className="clean-list">
              {evidencePackageInputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border)", background: "var(--canvas-2)" }}>
        <Image
          src="/illustrations/page-how-it-works.png"
          alt="Atmospheric illustration of a luminous data processing pipeline stretching across a landscape, with raw data entering on one side and finished presentations emerging on the other"
          width={1536}
          height={1024}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACqADAAQAAAABAAAABwAAAAD/wAARCAAHAAoDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAWFhYWFhYmFhYmNiYmJjZJNjY2NklcSUlJSUlcb1xcXFxcXG9vb29vb29vhoaGhoaGnJycnJyvr6+vr6+vr6+v/9sAQwEbHR0tKS1MKSlMt3xmfLe3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3/90ABAAB/9oADAMBAAIRAxEAPwCpf3Ntc4kTtWXuh96T/lnUNarRWRm9Xc//2Q=="
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </section>

      {/* Verification callout */}
      <section className="panel dark-panel">
        <div className="stack">
          <p className="section-label light">What makes Basquio different</p>
          <h2>Every deck is checked before delivery.</h2>
          <p className="muted">
            Basquio combines deterministic analysis, template-aware deck generation, and artifact QA before
            anything is published. Broken exports and mismatched artifact metadata are blocked instead of being
            silently shipped.
          </p>
        </div>
        <ul className="clean-list">
          {howItWorksChecks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="stack-xl">
        {howItWorksPhases.map((phase) => (
          <article key={phase.stage} className="panel stack-lg">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="section-label">Stage {phase.stage}</span>
              <span className="pipeline-time">{phase.time}</span>
            </div>
            <div className="stack-xs">
              <h2>{phase.title}</h2>
              <p className="page-copy">{phase.copy}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="panel technical-panel">
        <div className="stack">
          <p className="section-label">What you receive</p>
          <h2>One story across the full artifact pack.</h2>
          <p className="muted">
            An editable PowerPoint, a narrative report, and the audit workbook are built from the same
            analysis, the same narrative, and the same verified claims.
          </p>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to try one package"
        title="Bring the files behind your next review."
        copy="Start with one reporting cycle and let Basquio show you what the first draft can look like."
        secondaryLabel="Compare the categories"
        secondaryHref="/compare"
      />
      <PublicSiteFooter />
    </div>
  );
}
