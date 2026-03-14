import { GenerationForm } from "@/components/generation-form";
import { listGenerationRuns, summarizeRunBrief, summarizeRunSources } from "@/lib/job-runs";

export default async function NewJobPage() {
  const runs = await listGenerationRuns(3);

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="stack">
          <h1>Create your analysis.</h1>
          <p className="page-copy">
            Upload your data, describe what you need, and Basquio builds the analysis and presentation.
          </p>
        </div>
      </section>

      <section className="job-compose-grid">
        <GenerationForm />

        <aside className="stack-xl sticky-stack">
          <article className="panel guidance-card stack">
            <p className="section-label">Write a strong brief</p>
            <h2>Say what matters, why now, and what decision this supports.</h2>
          </article>

          <article className="technical-panel stack-xl">
            <div className="stack">
              <p className="section-label light">Accepted file types</p>
              <h2>CSV, Excel, PowerPoint, PDF</h2>
            </div>
            <div className="action-list">
              <p>CSV and Excel (XLSX/XLS) for your data.</p>
              <p>PPTX templates for branded output.</p>
              <p>PDF for style reference.</p>
            </div>
          </article>
        </aside>
      </section>

      {runs.length > 0 ? (
        <section className="panel stack-xl">
          <div className="stack">
            <p className="section-label">Recent runs</p>
            <h2>Your recent analyses.</h2>
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
