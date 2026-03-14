import { GenerationForm } from "@/components/generation-form";
import { listGenerationRuns, summarizeRunBrief, summarizeRunSources } from "@/lib/job-runs";

const briefGuidance = [
  {
    label: "Your data",
    title: "Upload the files that matter to the analysis.",
    copy: "Add your spreadsheets, source files, and any supporting material that gives the numbers context.",
  },
  {
    label: "Your brief",
    title: "Explain what the audience needs to understand.",
    copy: "A clear objective, thesis, and stakes lead to a sharper story and better recommendations.",
  },
  {
    label: "Your output",
    title: "Get a presentation you can use right away.",
    copy: "Basquio gives you an editable deck and a polished PDF built from the same analysis.",
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
              <p className="section-label">New analysis</p>
              <h1>Create your analysis.</h1>
              <p className="page-copy">
                Upload your data, describe what you need, and let Basquio build the analysis and presentation.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">How Basquio works</p>
            <p>Basquio analyzes your data before building anything.</p>
            <p className="muted">
              The brief you write shapes the entire output.
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
            <p className="section-label">Good brief</p>
            <h2>Say what matters, why it matters now, and what decision the presentation should support.</h2>
            <p className="muted">
              Use the business context and stakes fields to explain the situation, the decision, and the pressure behind it.
            </p>
          </article>

          <article className="technical-panel stack-xl">
            <div className="stack">
              <p className="section-label light">What you can upload</p>
              <h2>Start with your data. Add a template if you have one.</h2>
            </div>
            <div className="action-list">
              <p>CSV is the fastest path today.</p>
              <p>XLSX and XLS work when workbook structure matters.</p>
              <p>PPTX is the editable template input. PDF can be used as a style reference.</p>
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
