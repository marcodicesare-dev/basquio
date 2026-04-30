/**
 * Variant J · Path B
 * Real-feeling Basquio product UI mockups built in HTML/CSS.
 * Replaces placeholder SVG anchor illustrations with composed product surfaces:
 * a finished slide, a workspace home, a narrative report excerpt, an audit log.
 *
 * All numbers reconcile across mockups (the slide's 38.4% appears in the
 * report's first paragraph and in the workbook's Q4 share row).
 */

import { Fragment } from "react";

/* ------------------------------------------------------------------ */
/* Product section · finished slide                                    */
/* ------------------------------------------------------------------ */

export function ProductSlideMockup() {
  return (
    <article className="slide-mockup" aria-label="Example Basquio slide">
      <header className="slide-mockup-meta">
        <span className="slide-mockup-meta-id">
          <span className="slide-mockup-meta-dot" aria-hidden="true" />
          Espresso · Q4 category review
        </span>
        <span className="slide-mockup-meta-page">04 / 12</span>
      </header>

      <div className="slide-mockup-body">
        <p className="slide-mockup-section">Category · Share</p>
        <h3 className="slide-mockup-title">
          Private label takes 1.9 share points from branded espresso in Q4.
        </h3>

        <div className="slide-mockup-grid">
          <aside className="slide-mockup-kpi">
            <p className="slide-mockup-kpi-label">Branded share</p>
            <p className="slide-mockup-kpi-value">38.4%</p>
            <p className="slide-mockup-kpi-delta">−2.6 pts vs Q3</p>
            <p className="slide-mockup-kpi-context">
              Third consecutive quarter of decline.
            </p>
          </aside>

          <div className="slide-mockup-chart" aria-hidden="true">
            <div className="slide-mockup-chart-axis">
              <span>42%</span>
              <span>40%</span>
              <span>38%</span>
              <span>36%</span>
            </div>
            <div className="slide-mockup-chart-plot">
              <div className="slide-mockup-chart-grid">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="slide-mockup-chart-bars">
                <div className="slide-mockup-bar" data-q="Q1" style={{ height: "82%" }}>
                  <span className="slide-mockup-bar-value">41.0</span>
                </div>
                <div className="slide-mockup-bar" data-q="Q2" style={{ height: "74%" }}>
                  <span className="slide-mockup-bar-value">40.5</span>
                </div>
                <div className="slide-mockup-bar" data-q="Q3" style={{ height: "62%" }}>
                  <span className="slide-mockup-bar-value">41.0</span>
                </div>
                <div
                  className="slide-mockup-bar slide-mockup-bar-accent"
                  data-q="Q4"
                  style={{ height: "48%" }}
                >
                  <span className="slide-mockup-bar-value">38.4</span>
                </div>
              </div>
              <div className="slide-mockup-chart-labels" aria-hidden="true">
                <span>Q1</span>
                <span>Q2</span>
                <span>Q3</span>
                <span>Q4</span>
              </div>
            </div>
          </div>
        </div>

        <p className="slide-mockup-recommendation">
          <span className="slide-mockup-recommendation-tag">Recommend</span>
          Respond on the 250g multipack architecture. Hold the 1kg headline price for now.
        </p>
      </div>

      <footer className="slide-mockup-source">
        Source: retailer scan · 52 weeks · methodology in{" "}
        <em>data_tables.xlsx</em> sheet 03
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace section · workspace home                                  */
/* ------------------------------------------------------------------ */

const WORKSPACE_PROJECTS = [
  { name: "Espresso Q4 review", client: "Pellini Caffè", active: true },
  { name: "Trade marketing FY26", client: "Casa Vergnano", active: false },
  { name: "Modern trade share", client: "Caffè Motta", active: false },
  { name: "Brand health tracker", client: "Molino Andriani", active: false },
] as const;

const WORKSPACE_MEMORY = [
  { name: "Client", body: "Pellini Caffè · Verona · 18 contacts" },
  { name: "Brand", body: "Pellini · house style 2026" },
  { name: "Template", body: "JBP master template v3" },
  { name: "Last meeting", body: "Apr 18 · Beatrice Pellini" },
  { name: "Past reviews", body: "12 prior decks · 2024-2026" },
  { name: "Approved formats", body: "SCQA narrative · 12 slides" },
] as const;

const WORKSPACE_PROMPTS = [
  "Draft Q4 deck outline",
  "Summarize last meeting",
  "Compare share vs Q3",
] as const;

export function WorkspaceHomeMockup() {
  return (
    <article className="workspace-mockup" aria-label="Example Basquio workspace">
      <div className="workspace-mockup-rail">
        <div className="workspace-mockup-brand">
          <span className="workspace-mockup-brand-mark" aria-hidden="true" />
          basquio
        </div>
        <p className="workspace-mockup-rail-section">Projects</p>
        <ul className="workspace-mockup-projects">
          {WORKSPACE_PROJECTS.map((p) => (
            <li
              key={p.name}
              className={
                p.active
                  ? "workspace-mockup-project workspace-mockup-project-active"
                  : "workspace-mockup-project"
              }
            >
              <span className="workspace-mockup-project-dot" aria-hidden="true" />
              <span className="workspace-mockup-project-text">
                <span className="workspace-mockup-project-name">{p.name}</span>
                <span className="workspace-mockup-project-client">{p.client}</span>
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="workspace-mockup-rail-add" tabIndex={-1}>
          <span aria-hidden="true">+</span> New project
        </button>
      </div>

      <div className="workspace-mockup-main">
        <header className="workspace-mockup-main-head">
          <p className="workspace-mockup-breadcrumb">
            Workspace / Projects / Espresso Q4 review
          </p>
          <h3 className="workspace-mockup-main-title">
            Espresso Q4 review · Pellini Caffè
          </h3>
        </header>

        <p className="workspace-mockup-memory-label">Workspace memory</p>
        <ul className="workspace-mockup-memory">
          {WORKSPACE_MEMORY.map((m) => (
            <li key={m.name} className="workspace-mockup-memory-cell">
              <span className="workspace-mockup-memory-glyph" aria-hidden="true" />
              <span className="workspace-mockup-memory-copy">
                <span className="workspace-mockup-memory-name">{m.name}</span>
                <span className="workspace-mockup-memory-body">{m.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <aside className="workspace-mockup-chat">
        <p className="workspace-mockup-chat-title">Ask Basquio</p>
        <ul className="workspace-mockup-chat-suggestions">
          {WORKSPACE_PROMPTS.map((p) => (
            <li key={p} className="workspace-mockup-chat-suggestion">
              {p}
            </li>
          ))}
        </ul>
        <div className="workspace-mockup-chat-composer">
          <span className="workspace-mockup-chat-placeholder">
            Brief Basquio for this project...
          </span>
        </div>
        <button type="button" className="workspace-mockup-chat-cta" tabIndex={-1}>
          Run output <span aria-hidden="true">→</span>
        </button>
      </aside>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* About section · narrative report excerpt                            */
/* ------------------------------------------------------------------ */

export function ReportExcerptMockup() {
  return (
    <article className="report-mockup" aria-label="Example Basquio report excerpt">
      <header className="report-mockup-meta">
        <span className="report-mockup-mark" aria-hidden="true" />
        <span className="report-mockup-meta-file">
          narrative_report.md · 2,400 words · 6 sections
        </span>
      </header>

      <div className="report-mockup-body">
        <p className="report-mockup-eyebrow">Pellini Caffè · April 2026</p>
        <h3 className="report-mockup-title">
          Espresso category · Q4 performance review
        </h3>

        <p className="report-mockup-section">01 · What changed</p>

        <p className="report-mockup-paragraph">
          Branded espresso lost 2.6 share points in Q4, with private label gaining 1.9 points and
          discount mainstream brands picking up the rest. The shift held across the top three banners,
          with Modern Trade showing the steepest compression at <em>−3.4</em> points.
        </p>

        <blockquote className="report-mockup-pullquote">
          The price-pack architecture is the lever. Not the shelf-space conversation.
        </blockquote>

        <p className="report-mockup-paragraph">
          The price-per-100g delta between branded and private label widened by 11 percent during
          the same window, while branded distribution stayed flat. The pressure is on price-pack
          architecture, not on shelf presence.
        </p>

        <p className="report-mockup-section">02 · Why it matters</p>

        <p className="report-mockup-paragraph">
          Recovering 1.5 of the 2.6 lost share points is plausible inside two quarters if a 250g
          multipack lands at the right price-pack ratio. The 1kg headline price is a defensive lever
          to hold for now.
        </p>
      </div>

      <footer className="report-mockup-footer">
        <span>6 evidence references · methodology appendix</span>
        <span>1 of 14</span>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Security section · audit log + status band                          */
/* ------------------------------------------------------------------ */

const AUDIT_STATUS = [
  { tone: "ok", label: "Encrypted in transit · TLS 1.3" },
  { tone: "ok", label: "Encrypted at rest · AES-256" },
  { tone: "ok", label: "Tenant isolated · workspace-2247" },
  { tone: "warn", label: "SOC 2 Type 1 · planned 2026 Q3" },
] as const;

const AUDIT_ROWS = [
  { time: "10:42:18", actor: "marco@pellini.it", event: "WORKSPACE.OPEN", resource: "Espresso Q4 review", result: "ok" },
  { time: "10:43:02", actor: "marco@pellini.it", event: "FILE.UPLOAD", resource: "retail-scan-q4.xlsx", result: "ok" },
  { time: "10:44:11", actor: "system", event: "RUN.QUEUED", resource: "deck:slide-04-share", result: "ok" },
  { time: "10:51:36", actor: "system", event: "RUN.COMPLETED", resource: "deck:slide-04-share", result: "ok" },
  { time: "11:02:09", actor: "rossella@niq.eu", event: "MEMORY.READ", resource: "client:Pellini", result: "ok" },
  { time: "11:14:22", actor: "system", event: "MODEL.TRAIN", resource: "(none)", result: "blocked" },
  { time: "11:14:22", actor: "system", event: "POLICY.ENFORCE", resource: "no-training-on-customer-data", result: "ok" },
  { time: "11:32:48", actor: "veronica@victorinox.com", event: "EXPORT.PPTX", resource: "deck.pptx", result: "ok" },
] as const;

export function SecurityAuditMockup() {
  return (
    <article className="audit-mockup" aria-label="Example Basquio audit log">
      <ul className="audit-mockup-status">
        {AUDIT_STATUS.map((s) => (
          <li
            key={s.label}
            className={`audit-mockup-status-chip audit-mockup-status-${s.tone}`}
          >
            <span className="audit-mockup-status-dot" aria-hidden="true" />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>

      <div className="audit-mockup-table-wrap">
        <table className="audit-mockup-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Event</th>
              <th scope="col">Resource</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT_ROWS.map((r, i) => {
              const tone =
                r.result === "blocked"
                  ? "audit-mockup-row-block"
                  : r.event === "POLICY.ENFORCE"
                    ? "audit-mockup-row-policy"
                    : "";
              return (
                <Fragment key={`${r.time}-${i}`}>
                  <tr className={tone}>
                    <td className="audit-mockup-cell-mono">{r.time}</td>
                    <td>{r.actor}</td>
                    <td className="audit-mockup-cell-mono audit-mockup-cell-event">
                      {r.event}
                    </td>
                    <td>{r.resource}</td>
                    <td
                      className={
                        r.result === "blocked"
                          ? "audit-mockup-cell-result audit-mockup-cell-result-block"
                          : "audit-mockup-cell-result"
                      }
                    >
                      {r.result}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="audit-mockup-footnote">
        Live append-only audit log · streamed to your tenant · DPA available on request
      </p>
    </article>
  );
}
