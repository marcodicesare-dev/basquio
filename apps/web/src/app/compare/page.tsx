import type { Metadata } from "next";

import { comparisonColumnNotes, detailedComparisonRows } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Compare | Basquio",
  description:
    "Compare Basquio with generic AI and slide generators using plain-English criteria that matter in analytical reporting.",
};

export default function ComparePage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack-xl">
          <div className="stack">
            <p className="section-label">Compare</p>
            <h1>Basquio is for teams that need the numbers and the story to survive review.</h1>
            <p className="page-copy">
              Generic AI is good at drafting language. Slide generators are good at helping with layout. Basquio is for
              the teams that still have to connect the files, check the math, shape the story, and hand over a deck that
              can actually be used.
            </p>
          </div>

          <div className="cards">
            {comparisonColumnNotes.map((note) => (
              <article key={note} className="panel stack">
                <p className="muted">{note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel comparison-panel">
        <div className="stack">
          <p className="section-label">Capability map</p>
          <h2>One scale across the whole table: No, Partial, or Yes.</h2>
        </div>

        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Generic AI</th>
                <th scope="col">Slide generators</th>
                <th scope="col">Basquio</th>
              </tr>
            </thead>
            <tbody>
              {detailedComparisonRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.genericAi}</td>
                  <td>{row.slideGenerators}</td>
                  <td className="comparison-positive">{row.basquio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Want to see the workflow"
        title="See what happens between the upload and the finished deck."
        copy="If you want the step-by-step version, the workflow page shows how Basquio moves from one package to one story."
        secondaryLabel="Read how it works"
        secondaryHref="/how-it-works"
      />
      <PublicSiteFooter />
    </div>
  );
}
