import Link from "next/link";

export function MarketingHeroJ() {
  return (
    <section className="hero-j" aria-labelledby="hero-j-headline">
      <div className="hero-j-copy">
        <p className="hero-j-eyebrow">For market research teams</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          From scattered research files to a finished deck.
        </h1>
        <p className="hero-j-subhead">
          Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and
          Excel file your stakeholder asked for. The workspace remembers the client, brand, template,
          and last review.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/jobs/new">
            Start one output
          </Link>
          <Link className="hero-j-secondary" href="#workspace">
            See the workspace
          </Link>
        </div>

        <Link href="/security" className="hero-j-trust-link">
          <span className="hero-j-trust-dot" aria-hidden="true" />
          Security and data handling
        </Link>
      </div>

      <div className="hero-j-stage">
        <FinishedDeckArtifact />
        <CompanionArtifacts />
      </div>
    </section>
  );
}

function FinishedDeckArtifact() {
  return (
    <article className="hero-j-deck" aria-label="Finished deck slide example">
      <header className="hero-j-deck-meta">
        <span className="hero-j-deck-meta-id">Espresso · Q4 category review</span>
        <span className="hero-j-deck-meta-page">04 / 12</span>
      </header>

      <div className="hero-j-deck-body">
        <p className="hero-j-deck-section">Category · Share</p>
        <h2 className="hero-j-deck-title">
          Private label takes 1.9 share points from branded espresso in Q4.
        </h2>

        <div className="hero-j-deck-grid">
          <div className="hero-j-deck-kpi">
            <p className="hero-j-deck-kpi-label">Branded share</p>
            <p className="hero-j-deck-kpi-value">38.4%</p>
            <p className="hero-j-deck-kpi-delta">−2.6 pts vs Q3</p>
            <p className="hero-j-deck-kpi-context">3rd consecutive quarter of decline</p>
          </div>

          <div className="hero-j-deck-chart" aria-hidden="true">
            <div className="hero-j-deck-chart-axis" aria-hidden="true">
              <span>42%</span>
              <span>40%</span>
              <span>38%</span>
              <span>36%</span>
            </div>
            <div className="hero-j-deck-chart-plot">
              <div className="hero-j-deck-chart-grid">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="hero-j-deck-chart-bars">
                <span className="hero-j-deck-bar" style={{ height: "82%" }} data-quarter="Q1" />
                <span className="hero-j-deck-bar" style={{ height: "74%" }} data-quarter="Q2" />
                <span className="hero-j-deck-bar" style={{ height: "62%" }} data-quarter="Q3" />
                <span
                  className="hero-j-deck-bar hero-j-deck-bar-accent"
                  style={{ height: "48%" }}
                  data-quarter="Q4"
                />
              </div>
              <div className="hero-j-deck-chart-labels" aria-hidden="true">
                <span>Q1</span>
                <span>Q2</span>
                <span>Q3</span>
                <span>Q4</span>
              </div>
            </div>
          </div>
        </div>

        <p className="hero-j-deck-recommendation">
          <span className="hero-j-deck-recommendation-tag">Recommend</span>
          Respond on the 250g multipack architecture. Hold the 1kg headline price for now.
        </p>
      </div>

      <footer className="hero-j-deck-source">
        Source: retailer scan · 52 weeks · methodology in <em>data_tables.xlsx</em> sheet 03
      </footer>
    </article>
  );
}

function CompanionArtifacts() {
  return (
    <div className="hero-j-companions-wrap">
      <p className="hero-j-companions-label">
        <span className="hero-j-companions-tick" aria-hidden="true" />
        Same run also produced the report and the Excel workbook
      </p>
      <ul className="hero-j-companions" aria-label="The same run also produced">
        <li className="hero-j-companion">
          <span className="hero-j-companion-glyph" aria-hidden="true">
            <span className="hero-j-companion-glyph-line" />
            <span className="hero-j-companion-glyph-line short" />
            <span className="hero-j-companion-glyph-line" />
            <span className="hero-j-companion-glyph-line short" />
          </span>
          <span className="hero-j-companion-text">
            <span className="hero-j-companion-kind">Report</span>
            <span className="hero-j-companion-name">narrative_report.md</span>
            <span className="hero-j-companion-meta">2,400 words · 6 sections</span>
          </span>
        </li>
        <li className="hero-j-companion">
          <span className="hero-j-companion-glyph" aria-hidden="true">
            <span className="hero-j-companion-glyph-grid" />
          </span>
          <span className="hero-j-companion-text">
            <span className="hero-j-companion-kind">Workbook</span>
            <span className="hero-j-companion-name">data_tables.xlsx</span>
            <span className="hero-j-companion-meta">4 sheets · native charts</span>
          </span>
        </li>
      </ul>
    </div>
  );
}
