import { Check, Minus, X } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { detailedComparisonRows } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio vs Gamma vs Beautiful.ai vs ChatGPT — Data-to-Presentation Tool Comparison",
  description:
    "Compare Basquio with AI slide generators (Gamma, Beautiful.ai), BI tools (Tableau, Power BI), and general AI (ChatGPT) for turning data files into finished analysis decks.",
  alternates: { canonical: "https://basquio.com/compare" },
};

function capabilityIcon(value: string) {
  if (value === "Yes") return <span className="cap-yes"><Check size={16} weight="bold" /></span>;
  if (value === "Partial") return <span className="cap-partial"><Minus size={16} weight="bold" /></span>;
  if (value === "No") return <span className="cap-no"><X size={16} weight="bold" /></span>;
  return <>—</>;
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
        <div className="comparison-legend">
          <span><Check size={14} weight="bold" /> Full support</span>
          <span><Minus size={14} weight="bold" /> Partial — works sometimes or with manual effort</span>
          <span><X size={14} weight="bold" /> Not available</span>
        </div>

        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">ChatGPT / Claude</th>
                <th scope="col">Gamma / Tome / Beautiful.ai</th>
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
