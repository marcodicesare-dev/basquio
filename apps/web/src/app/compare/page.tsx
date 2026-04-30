import { Check, Minus, X } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { detailedComparisonRows } from "@/app/site-content";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollReveal } from "@/components/scroll-reveal";

export const metadata: Metadata = {
  title: "Basquio vs ChatGPT, Gamma, Tableau · Compare",
  description:
    "Compare Basquio with general AI (ChatGPT, Claude), slide generators (Gamma, Tome, Beautiful.ai), and BI tools for turning research files into a finished deck, report and Excel file.",
  alternates: { canonical: "https://basquio.com/compare" },
};

function CapabilityIcon({ value }: { value: string }) {
  if (value === "Yes") {
    return (
      <span className="cap-yes" aria-label="Full support">
        <Check size={16} weight="bold" />
      </span>
    );
  }
  if (value === "Partial") {
    return (
      <span className="cap-partial" aria-label="Partial support">
        <Minus size={16} weight="bold" />
      </span>
    );
  }
  if (value === "No") {
    return (
      <span className="cap-no" aria-label="Not available">
        <X size={16} weight="bold" />
      </span>
    );
  }
  return <span aria-hidden="true">.</span>;
}

const ANTI_PATTERNS = [
  {
    title: "Your category review is tomorrow.",
    body: "ChatGPT can write bullets. Gamma can lay out slides. Only Basquio reads your source files, checks the math, and hands you a branded deck with charts built from your data.",
  },
  {
    title: "Leadership wants one story across three trackers.",
    body: "Other tools make you copy-paste numbers into a prompt and hope nothing drifts. Basquio loads the files directly, computes the shifts, and builds the narrative around what actually changed.",
  },
] as const;

export default function ComparePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <section className="section-j section-j-page-hero" aria-labelledby="compare-page-heading">
        <ScrollReveal className="section-j-page-hero-inner">
          <p className="section-j-eyebrow">Compare</p>
          <h1 id="compare-page-heading" className="section-j-page-title">
            What matters when the deck has to survive review.
          </h1>
          <p className="section-j-body">
            Generic AI can draft language. Slide generators can lay out shapes. Neither reads
            your files, checks the math, or hands you a branded deck. Basquio does.
          </p>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-comparison"
        aria-labelledby="comparison-heading"
      >
        <ScrollReveal className="section-j-comparison-inner">
          <header className="section-j-comparison-head">
            <h2 id="comparison-heading" className="section-j-title">
              Capability by capability.
            </h2>
            <ul className="comparison-legend-j" role="list">
              <li>
                <Check size={14} weight="bold" /> Full support
              </li>
              <li>
                <Minus size={14} weight="bold" /> Partial support
              </li>
              <li>
                <X size={14} weight="bold" /> Not available
              </li>
            </ul>
          </header>

          <div className="comparison-table-wrap-j">
            <table className="comparison-table-j">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">ChatGPT / Claude</th>
                  <th scope="col">Gamma / Tome / Beautiful.ai</th>
                  <th scope="col" className="comparison-positive-j">
                    Basquio
                  </th>
                </tr>
              </thead>
              <tbody>
                {detailedComparisonRows.map((row) => (
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
            <p className="section-j-eyebrow section-j-eyebrow-light">What this means</p>
            <h2 id="anti-pattern-heading" className="section-j-title section-j-title-light">
              Two situations where the difference shows.
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
        eyebrow="Ready to see it"
        title="Start with one output. Or set up the workspace."
        copy="Upload the brief and files for one job. If the work comes back next month, keep the context in a workspace."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See the workspace"
        secondaryHref="/#workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
