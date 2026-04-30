/**
 * Variant J · Path D
 * Mixed mockup system: PNG screenshots from Claude Design for the clean
 * artefact shots (slide, workbook), CSS components with anonymous data for
 * the workspace + report + security UI shots that previously contained
 * real prospect names.
 *
 * All real-prospect references (Pellini Caffè, Casa Vergnano, Caffè Motta,
 * Molino Andriani, Beatrice Pellini, marco@pellini.it, rossella@niq.eu,
 * veronica@victorinox.com) have been replaced with fictional placeholder
 * data: Northstar Coffee, Aurora Espresso, Caffè Belvedere, Mulini Vetta,
 * Anna Ricci, marco@northstar.it, anna@example.it, luca@example.com.
 *
 * Numbers still reconcile across all five mockups (the 1.9 share points on
 * the slide ties to the workbook row 4 and the report section 2).
 */

import { Fragment } from "react";
import Image from "next/image";

/* ------------------------------------------------------------------ */
/* Product section · finished slide (Claude Design PNG)                */
/* ------------------------------------------------------------------ */

export function ProductSlideMockup() {
  return (
    <figure className="mockup-frame mockup-frame-slide">
      <Image
        className="mockup-frame-image"
        src="/marketing/screenshots/slide.png"
        alt="Slide 04 of an Espresso Q4 review deck. Headline reads 'Private label takes 1.9 share points from branded espresso in Q4', with a quarterly share chart and a recommendation block."
        width={850}
        height={490}
        sizes="(min-width: 1280px) 1100px, (min-width: 768px) 80vw, 100vw"
        priority
      />
      <figcaption className="mockup-frame-caption">deck.pptx · slide 04 of 12</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace section · workspace home (CSS, anonymous)                 */
/* ------------------------------------------------------------------ */

const WORKSPACE_PROJECTS = [
  { name: "Espresso Q4 review", client: "Northstar Coffee", active: true },
  { name: "Trade marketing FY26", client: "Aurora Espresso", active: false },
  { name: "Modern trade share", client: "Caffè Belvedere", active: false },
  { name: "Brand health tracker", client: "Mulini Vetta", active: false },
] as const;

const WORKSPACE_MEMORY = [
  { name: "Client", body: "Northstar Coffee · Verona · 18 contacts" },
  { name: "Brand", body: "Northstar · house style 2026" },
  { name: "Template", body: "JBP master template v3" },
  { name: "Last meeting", body: "Apr 18 · Anna Ricci" },
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
            Espresso Q4 review · Northstar Coffee
          </h3>
        </header>

        <p className="workspace-mockup-memory-label">Workspace memory · 6 facts pinned</p>
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
            Brief Basquio for this project
            <span className="workspace-mockup-chat-caret" aria-hidden="true" />
          </span>
        </div>
        <button type="button" className="workspace-mockup-chat-cta" tabIndex={-1}>
          Run output <span aria-hidden="true">→</span>
        </button>
        <p className="workspace-mockup-chat-trust">No training on customer data</p>
      </aside>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Reconciliation section · workbook (Claude Design PNG)               */
/* ------------------------------------------------------------------ */

export function WorkbookMockup() {
  return (
    <figure className="mockup-frame mockup-frame-workbook">
      <Image
        className="mockup-frame-image"
        src="/marketing/screenshots/workbook.png"
        alt="data_tables.xlsx Share sheet. Row 4 'Private label' is highlighted in amber with +1.9 points and an embedded chart on the right; the footer notes 'reconciled to slide 04 · report §02'."
        width={834}
        height={515}
        sizes="(min-width: 1280px) 1100px, (min-width: 768px) 80vw, 100vw"
      />
      <figcaption className="mockup-frame-caption">data_tables.xlsx · 4 sheets · auto-reconciled</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* About section · narrative report excerpt (CSS, anonymous)           */
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
        <p className="report-mockup-eyebrow">Northstar Coffee · April 2026</p>
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
/* Security section · audit log (CSS, anonymous)                       */
/* ------------------------------------------------------------------ */

const AUDIT_STATUS = [
  { tone: "ok", label: "Encrypted in transit · TLS 1.3" },
  { tone: "ok", label: "Encrypted at rest · AES-256" },
  { tone: "ok", label: "Tenant isolated · workspace-2247" },
  { tone: "warn", label: "SOC 2 Type 1 · planned 2026 Q3" },
] as const;

const AUDIT_ROWS = [
  { time: "10:42:18", actor: "marco@northstar.it", event: "WORKSPACE.OPEN", resource: "Espresso Q4 review", result: "ok" },
  { time: "10:43:02", actor: "marco@northstar.it", event: "FILE.UPLOAD", resource: "retail-scan-q4.xlsx", result: "ok" },
  { time: "10:44:11", actor: "system", event: "RUN.QUEUED", resource: "deck:slide-04-share", result: "ok" },
  { time: "10:51:36", actor: "system", event: "RUN.COMPLETED", resource: "deck:slide-04-share", result: "ok" },
  { time: "11:02:09", actor: "anna@example.it", event: "MEMORY.READ", resource: "client:Northstar", result: "ok" },
  { time: "11:14:22", actor: "system", event: "MODEL.TRAIN", resource: "(none)", result: "blocked" },
  { time: "11:14:22", actor: "system", event: "POLICY.ENFORCE", resource: "no-training-on-customer-data", result: "ok" },
  { time: "11:32:48", actor: "luca@example.com", event: "EXPORT.PPTX", resource: "deck.pptx", result: "ok" },
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
