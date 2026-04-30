/**
 * Variant J · Path D + motion
 * Mixed mockup system: PNG screenshots from Claude Design for the clean
 * artefact shots (slide, workbook), CSS components with anonymous data for
 * the workspace, report and security UI shots.
 *
 * All real-prospect references (Pellini Caffè, Casa Vergnano, Caffè Motta,
 * Molino Andriani, Beatrice Pellini, marco@pellini.it, rossella@niq.eu,
 * veronica@victorinox.com) have been replaced with fictional placeholder
 * data: Northstar Coffee, Aurora Espresso, Caffè Belvedere, Mulini Vetta,
 * Anna Ricci, marco@northstar.it, anna@example.it, luca@example.com.
 *
 * Numbers reconcile across all five mockups (the 1.9 share points on the
 * slide ties to workbook row 4 and report section 2).
 *
 * Motion layer (Linear / Vercel / Anthropic patterns):
 * - PNG mockups (slide, workbook) are wrapped in MotionMockupFrame which
 *   adds scroll-driven entrance plus mouse-tracking parallax tilt.
 * - The workspace mockup is the live MotionWorkspaceMockup with chat-typing
 *   animation, memory cells stagger reveal, and parallax tilt.
 * - report and security stay flat for now (they are deeper in the page,
 *   they get the standard ScrollReveal entrance only).
 */

import { Fragment } from "react";
import Image from "next/image";

import { MotionMockupFrame } from "@/components/motion-mockup-frame";
import { MotionWorkspaceMockup } from "@/components/motion-workspace-mockup";

export { MotionWorkspaceMockup as WorkspaceHomeMockup };

/* ------------------------------------------------------------------ */
/* Product section · finished slide (Claude Design PNG + parallax)     */
/* ------------------------------------------------------------------ */

export function ProductSlideMockup() {
  return (
    <MotionMockupFrame className="mockup-frame mockup-frame-slide">
      <Image
        className="mockup-frame-image"
        src="/marketing/screenshots/slide.png"
        alt="Slide 04 of an Espresso Q4 review deck. Headline reads 'Private label takes 1.9 share points from branded espresso in Q4', with a quarterly share chart and a recommendation block."
        width={850}
        height={490}
        sizes="(min-width: 1504px) 1440px, calc(100vw - 64px)"
        quality={95}
        priority
      />
      <figcaption className="mockup-frame-caption">deck.pptx · slide 04 of 12</figcaption>
    </MotionMockupFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Reconciliation section · workbook (Claude Design PNG + parallax)    */
/* ------------------------------------------------------------------ */

export function WorkbookMockup() {
  return (
    <MotionMockupFrame className="mockup-frame mockup-frame-workbook">
      <Image
        className="mockup-frame-image"
        src="/marketing/screenshots/workbook.png"
        alt="data_tables.xlsx Share sheet. Row 4 'Private label' is highlighted in amber with +1.9 points and an embedded chart on the right; the footer notes 'reconciled to slide 04 · report §02'."
        width={834}
        height={515}
        sizes="(min-width: 1504px) 1440px, calc(100vw - 64px)"
        quality={95}
      />
      <figcaption className="mockup-frame-caption">data_tables.xlsx · 4 sheets · auto-reconciled</figcaption>
    </MotionMockupFrame>
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
