import type { Metadata } from "next";

import { detailedComparisonRows } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Compare | Basquio",
  description:
    "Compare Basquio with generic AI and slide generators across evidence handling, deterministic computation, brand control, and output quality.",
};

export default function ComparePage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">Compare</p>
              <h1>Basquio is built for analytical reporting, not generic slide generation.</h1>
              <p className="page-copy">
                Generic AI can draft language. Slide generators can format slides. Basquio is designed to compute the numbers,
                rank the insight, plan the story, and deliver executive-grade artifacts.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">The baseline</p>
            <p>Evidence package input</p>
            <p>Deterministic analytics</p>
            <p>Brand-aware output</p>
            <p>Editable PPTX and polished PDF</p>
          </aside>
        </div>
      </section>

      <section className="panel comparison-panel">
        <div className="stack">
          <p className="section-label">Capability map</p>
          <h2>Where the product categories diverge.</h2>
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

      <PublicSiteFooterCta />
    </div>
  );
}
