"use client";

import { useState } from "react";
import Link from "next/link";

type ArtifactKind = "deck" | "report" | "excel";

const materialChips = [
  { label: "Brief", caption: "Espresso category Q4" },
  { label: "Data", caption: "Retail · 52 weeks" },
  { label: "Notes", caption: "Sales call · Apr 22" },
  { label: "Old deck", caption: "Q3 review" },
  { label: "Template", caption: "Brand master" },
] as const;

const memoryNotes = [
  "Client and brand",
  "Last review",
  "Approved format",
] as const;

const artifactCopy: Record<
  ArtifactKind,
  { label: string; caption: string }
> = {
  deck: {
    label: "Deck",
    caption: "Editable PowerPoint with charts, storyline, and recommendations.",
  },
  report: {
    label: "Report",
    caption: "Written explanation of what changed, why it matters, what to do next.",
  },
  excel: {
    label: "Excel",
    caption: "Workbook with the tables behind every chart.",
  },
};

export function MarketingHeroJ() {
  const [active, setActive] = useState<ArtifactKind>("deck");

  return (
    <section className="hero-j" aria-labelledby="hero-j-headline">
      <div className="hero-j-copy">
        <p className="hero-j-eyebrow">For market research teams</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          <span className="hero-j-headline-clause">Upload the material.</span>
          <span className="hero-j-headline-clause">
            Basquio builds the deck, report, and Excel file.
          </span>
        </h1>
        <p className="hero-j-subhead">
          Start with the brief, data, notes, template, and past work. For one job, pay for the output.
          For recurring work, keep everything in a workspace that remembers the context.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/jobs/new">
            Start one output
          </Link>
          <Link className="hero-j-secondary" href="#workspace">
            See the workspace
          </Link>
        </div>

        <Link href="/trust" className="hero-j-trust-link">
          <span className="hero-j-trust-dot" aria-hidden="true" />
          Security and data handling
        </Link>
      </div>

      <HeroArtifact active={active} onSelect={setActive} />
    </section>
  );
}

function HeroArtifact({
  active,
  onSelect,
}: {
  active: ArtifactKind;
  onSelect: (kind: ArtifactKind) => void;
}) {
  return (
    <div className="hero-j-artifact" aria-live="polite">
      <header className="hero-j-artifact-chrome">
        <div className="hero-j-artifact-id">
          <span className="hero-j-artifact-id-dot" aria-hidden="true" />
          <span className="hero-j-artifact-id-name">Espresso · Q4 category review</span>
        </div>
        <div className="hero-j-artifact-state">
          <span className="hero-j-artifact-state-pulse" aria-hidden="true" />
          <span>Workspace memory active</span>
        </div>
      </header>

      <div className="hero-j-material-row" aria-label="Material in this run">
        {materialChips.map((chip) => (
          <span key={chip.label} className="hero-j-material-chip">
            <span className="hero-j-material-chip-label">{chip.label}</span>
            <span className="hero-j-material-chip-caption">{chip.caption}</span>
          </span>
        ))}
      </div>

      <div className="hero-j-stage">
        <div
          className="hero-j-stage-tabs"
          role="tablist"
          aria-label="Output artifacts"
        >
          {(Object.keys(artifactCopy) as ArtifactKind[]).map((kind) => (
            <button
              key={kind}
              role="tab"
              type="button"
              aria-selected={active === kind}
              tabIndex={active === kind ? 0 : -1}
              className={
                active === kind
                  ? "hero-j-stage-tab hero-j-stage-tab-active"
                  : "hero-j-stage-tab"
              }
              onClick={() => onSelect(kind)}
            >
              {artifactCopy[kind].label}
            </button>
          ))}
        </div>

        <div className="hero-j-stage-pane" role="tabpanel">
          {active === "deck" ? <DeckPane /> : null}
          {active === "report" ? <ReportPane /> : null}
          {active === "excel" ? <ExcelPane /> : null}
        </div>
      </div>

      <footer className="hero-j-memory-row">
        <span className="hero-j-memory-label">Workspace remembers</span>
        <ul className="hero-j-memory-notes">
          {memoryNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

function DeckPane() {
  return (
    <div className="hero-j-deck-pane">
      <div className="hero-j-deck-head">
        <p className="hero-j-deck-eyebrow">Slide 04 · Category share</p>
        <h3 className="hero-j-deck-title">Private label keeps taking branded share in espresso</h3>
      </div>

      <div className="hero-j-deck-body">
        <div className="hero-j-kpi">
          <p className="hero-j-kpi-label">Branded share</p>
          <p className="hero-j-kpi-value">38.4%</p>
          <p className="hero-j-kpi-delta">−2.6 pts vs Q3</p>
        </div>

        <div className="hero-j-chart" aria-hidden="true">
          <div className="hero-j-chart-grid">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="hero-j-chart-bars">
            <div className="hero-j-chart-bar" style={{ height: "62%" }}>
              <span className="hero-j-chart-bar-label">Q1</span>
            </div>
            <div className="hero-j-chart-bar" style={{ height: "58%" }}>
              <span className="hero-j-chart-bar-label">Q2</span>
            </div>
            <div className="hero-j-chart-bar" style={{ height: "52%" }}>
              <span className="hero-j-chart-bar-label">Q3</span>
            </div>
            <div className="hero-j-chart-bar hero-j-chart-bar-accent" style={{ height: "48%" }}>
              <span className="hero-j-chart-bar-label">Q4</span>
            </div>
          </div>
        </div>
      </div>

      <p className="hero-j-deck-source">
        Source: retailer scan · 52 weeks · methodology in workbook tab 03
      </p>
    </div>
  );
}

function ReportPane() {
  return (
    <div className="hero-j-report-pane">
      <p className="hero-j-report-eyebrow">Section 02 · What changed</p>
      <h3 className="hero-j-report-title">The branded share story is now a price-pack story</h3>
      <div className="hero-j-report-body">
        <p>
          Branded espresso lost 2.6 share points in Q4, with private label gaining 1.9 points and
          discount mainstream brands picking up the rest. The shift held across the top three banners.
        </p>
        <p>
          The price-per-100g delta between branded and private label widened by 11 percent during
          the same window. The recommendation prioritizes a 250g multipack response over headline
          price action on the 1kg SKU.
        </p>
      </div>
      <ul className="hero-j-report-meta" aria-label="Report cross-references">
        <li>Source workbook · 4 sheets</li>
        <li>Cited evidence · 6 retailer cuts</li>
        <li>Stakeholder · CMO + Trade lead</li>
      </ul>
    </div>
  );
}

function ExcelPane() {
  return (
    <div className="hero-j-excel-pane">
      <div className="hero-j-excel-tabs" aria-hidden="true">
        <span className="hero-j-excel-tab hero-j-excel-tab-active">Share</span>
        <span className="hero-j-excel-tab">Price</span>
        <span className="hero-j-excel-tab">Promo</span>
        <span className="hero-j-excel-tab">README</span>
      </div>
      <table className="hero-j-excel-table" aria-label="Workbook preview, share by quarter">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Q3</th>
            <th scope="col">Q4</th>
            <th scope="col">Δ pts</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Branded premium</td>
            <td>22.1</td>
            <td>21.0</td>
            <td className="hero-j-excel-down">−1.1</td>
          </tr>
          <tr>
            <td>Branded mainstream</td>
            <td>18.9</td>
            <td>17.4</td>
            <td className="hero-j-excel-down">−1.5</td>
          </tr>
          <tr>
            <td>Private label</td>
            <td>34.6</td>
            <td>36.5</td>
            <td className="hero-j-excel-up">+1.9</td>
          </tr>
          <tr>
            <td>Discount mainstream</td>
            <td>14.4</td>
            <td>15.1</td>
            <td className="hero-j-excel-up">+0.7</td>
          </tr>
        </tbody>
      </table>
      <p className="hero-j-excel-note">Sheet 01 · Numbers reconcile to slide 04 and report section 02</p>
    </div>
  );
}
