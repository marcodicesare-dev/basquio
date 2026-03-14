import { BASQUIO_PIPELINE_STAGES } from "@basquio/core";

export default function NewJobPage() {
  return (
    <div className="grid">
      <section className="panel stack">
        <p className="eyebrow">New generation job</p>
        <h1>Job creation scaffold</h1>
        <p className="muted">
          The UI is intentionally light for now. The important part is that uploads map to a typed generation request,
          deterministic analytics run before reasoning, and the artifacts persist after the render stages.
        </p>
      </section>

      <section className="panel stack">
        <p className="eyebrow">Expected payload</p>
        <pre className="code-block">{`{
  "jobId": "job_123",
  "organizationId": "org_123",
  "projectId": "project_123",
  "sourceFileName": "market-share.xlsx",
  "templateFileName": "client-template.pptx",
  "businessContext": "Explain share movement and channel shifts",
  "audience": "Category leadership",
  "objective": "Move from topline signal to supporting segment evidence"
}`}</pre>
      </section>

      <section className="panel stack">
        <p className="eyebrow">Run order</p>
        <ul className="clean">
          {BASQUIO_PIPELINE_STAGES.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
