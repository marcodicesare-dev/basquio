import { GenerationForm } from "@/components/generation-form";
import { listGenerationRuns, summarizeRunBrief, summarizeRunSources } from "@/lib/job-runs";

const briefGuidance = [
  {
    label: "Evidence package",
    title: "Upload the report materials leadership would actually hand over.",
    copy: "CSV and workbook data can be combined with methodology notes, validation files, and supporting context.",
  },
  {
    label: "Report brief",
    title: "Give the system a real audience, objective, and stakes.",
    copy: "The stronger the brief, the more usable the narrative spine and slide ordering become.",
  },
  {
    label: "Output pair",
    title: "The editable deck and the PDF remain coupled.",
    copy: "Both deliverables are rendered from the same slide contract so the system does not split into two stories.",
  },
] as const;

export default async function NewJobPage() {
  const runs = await listGenerationRuns(3);

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-lg">
            <div className="stack">
              <p className="section-label">New run</p>
              <h1>Compose a real report generation run.</h1>
              <p className="page-copy">
                This remains the primary action path. Upload the evidence package, define the business ask, attach
                optional brand input, and let Basquio plan one report structure before it renders the PPTX and PDF.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">What the path protects</p>
            <p>Basquio still refuses the generic “upload CSV, get random deck” posture.</p>
            <p className="muted">
              The form is intentionally opinionated around evidence packages, report briefs, and artifact discipline.
            </p>
          </aside>
        </div>

        <div className="brief-rule-grid">
          {briefGuidance.map((item) => (
            <article key={item.label} className="brief-rule stack">
              <p className="section-label">{item.label}</p>
              <h3>{item.title}</h3>
              <p className="muted">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="job-compose-grid">
        <GenerationForm />

        <aside className="stack-xl sticky-stack">
          <article className="panel guidance-card stack">
            <p className="section-label">Brief should answer</p>
            <h2>What leadership needs to understand, why it matters now, and what decision sits behind the report.</h2>
            <p className="muted">
              Use the business context and stakes fields to explain timing, the operating question, and the intended
              consequence of the report.
            </p>
          </article>

          <article className="technical-panel stack-xl">
            <div className="stack">
              <p className="section-label light">Accepted now</p>
              <h2>CSV-first, evidence-package aware.</h2>
            </div>
            <div className="action-list">
              <p>CSV is the fastest and best-tested product path.</p>
              <p>XLSX and XLS remain accepted where workbook structure matters.</p>
              <p>PPTX stays the editable template input; PDF is a style reference only in v1.</p>
            </div>
          </article>
        </aside>
      </section>

      {runs.length > 0 ? (
        <section className="panel stack-xl">
          <div className="stack">
            <p className="section-label">Recent runs</p>
            <h2>Reference the latest outputs while composing the next report job.</h2>
          </div>

          <div className="cards">
            {runs.map((run) => (
              <article key={run.jobId} className="artifact-card">
                <div className="stack">
                  <p className="artifact-kind">{summarizeRunSources(run)}</p>
                  <h3>{run.story.keyMessages[0] ?? run.objective}</h3>
                  <p className="muted">{summarizeRunBrief(run)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
