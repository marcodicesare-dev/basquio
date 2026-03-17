import type { Metadata } from "next";

import { detailedComparisonRows } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Compare | Basquio",
  description:
    "Compare Basquio with generic AI and slide generators on the capabilities that matter when the deck has to survive review.",
};

function capabilityIcon(value: string) {
  if (value === "Yes") return "\u2713";
  if (value === "Partial") return "\u25D0";
  return "\u2014";
}

export default function ComparePage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack">
          <p className="section-label">Compare</p>
          <h1>What matters when the deck has to survive review.</h1>
          <p className="page-copy">
            Generic AI can draft language. Slide generators can help with layout. Neither reads your files, checks the
            math, or hands you a branded deck with every claim traced to source. Basquio does.
          </p>
        </div>
      </section>

      <section className="panel comparison-panel">
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Generic AI</th>
                <th scope="col">Slide generators</th>
                <th scope="col" className="comparison-positive">Basquio</th>
              </tr>
            </thead>
            <tbody>
              {detailedComparisonRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{capabilityIcon(row.genericAi)}</td>
                  <td>{capabilityIcon(row.slideGenerators)}</td>
                  <td className="comparison-positive">{capabilityIcon(row.basquio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel dark-panel">
        <div className="stack">
          <p className="section-label">What this means</p>
          <div className="cards">
            <article className="panel stack">
              <h3>Your category review is tomorrow.</h3>
              <p className="muted">
                ChatGPT can write bullets. Gamma can make slides. Only Basquio can read your 6 source files, check the
                math, and hand you a branded deck with every claim traced to source.
              </p>
            </article>
            <article className="panel stack">
              <h3>Leadership wants one story from three trackers.</h3>
              <p className="muted">
                Other tools make you copy-paste numbers into a prompt and hope nothing drifts. Basquio loads the files
                directly, computes the shifts, and builds the narrative around what actually changed.
              </p>
            </article>
          </div>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Want to see the workflow"
        title="See what happens between the upload and the finished deck."
        copy="The workflow page shows how Basquio moves from one evidence package to one review-ready story."
        secondaryLabel="Read how it works"
        secondaryHref="/how-it-works"
      />
      <PublicSiteFooter />
    </div>
  );
}
