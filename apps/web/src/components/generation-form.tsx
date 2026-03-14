"use client";

import Link from "next/link";
import { useState } from "react";

type GenerationResponse = {
  jobId: string;
  storyTitle: string;
  fileCount: number;
  sheetCount: number;
  outlineSectionCount: number;
  slideCount: number;
  highlights: string[];
  artifacts: Array<{
    kind: "pptx" | "pdf";
    fileName: string;
    mimeType: string;
    downloadUrl: string;
  }>;
};

const formSignals = [
  {
    label: "Package",
    title: "Multi-file evidence input",
    copy: "Upload core data plus the supporting notes, validation material, or methodology references that define the job.",
  },
  {
    label: "Brief",
    title: "Narrative stays constrained",
    copy: "Audience, objective, thesis, and stakes steer the storyline before the slide plan is generated.",
  },
  {
    label: "Output",
    title: "Dual artifacts from one plan",
    copy: "Basquio keeps the editable deck and the polished PDF derived from the same structured contract.",
  },
] as const;

export function GenerationForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResponse | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setResult(null);

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as GenerationResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Generation failed.");
      }

      setResult(payload);
    } catch (submissionError) {
      setResult(null);
      setError(submissionError instanceof Error ? submissionError.message : "Generation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="stack-xl">
      <form className="stack-lg" onSubmit={handleSubmit}>
        <div className="panel form-panel stack-xl">
          <div className="stack">
            <p className="section-label">Generation composer</p>
            <h2>Upload the evidence pack, set the brief, and map optional brand input.</h2>
            <p className="muted">
              Basquio treats this submission as a report-generation job. It infers file roles, runs deterministic
              analytics first, plans the narrative spine, and then renders the editable PPTX plus the presentation-ready
              PDF from the same slide plan.
            </p>
          </div>

          <div className="brief-rule-grid">
            {formSignals.map((signal) => (
              <article key={signal.label} className="brief-rule stack">
                <p className="section-label">{signal.label}</p>
                <h3>{signal.title}</h3>
                <p className="muted">{signal.copy}</p>
              </article>
            ))}
          </div>

          <div className="form-grid">
            <label className="field field-span-2">
              <span>Evidence files</span>
              <input
                name="evidenceFiles"
                type="file"
                accept=".csv,.xlsx,.xls,.doc,.docx,.txt,.md,.pdf,.pptx,.json,.css"
                multiple
                required
              />
              <small>
                Upload one or more tabular files plus methodology, citation, validation, or support files.
              </small>
            </label>

            <label className="field field-span-2">
              <span>Brand or template file</span>
              <input name="brandFile" type="file" accept=".json,.css,.pptx,.pdf" />
              <small>
                JSON or CSS brand tokens map into <code>TemplateProfile</code>. PPTX remains editable-template input.
                PDF is style reference only.
              </small>
            </label>

            <label className="field field-span-2">
              <span>Business context</span>
              <textarea
                name="businessContext"
                rows={5}
                placeholder="Describe the evidence package, the reporting context, and what leadership needs to understand."
                required
              />
            </label>

            <label className="field">
              <span>Client</span>
              <input name="client" defaultValue="Internal Basquio test client" placeholder="SGS Sustainability Services" />
            </label>

            <label className="field">
              <span>Audience</span>
              <input name="audience" defaultValue="Category leadership" placeholder="Category leadership" />
            </label>

            <label className="field">
              <span>Objective</span>
              <input
                name="objective"
                defaultValue="Move from framing to methodology, findings, implications, and recommendations"
                placeholder="Explain what changed, why it matters, and what to do next"
              />
            </label>

            <label className="field">
              <span>Thesis</span>
              <input name="thesis" placeholder="Example: Retrieval visibility is the constraint, not brand awareness." />
            </label>

            <label className="field field-span-2">
              <span>Stakes</span>
              <textarea
                name="stakes"
                rows={3}
                placeholder="Why does this report matter now? Example: leadership is deciding where to invest before the next quarterly review."
              />
            </label>
          </div>

          <div className="row form-actions">
            <div className="row">
              <button className="button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Generating artifacts..." : "Generate PPTX and PDF"}
              </button>
              <Link className="button secondary" href="/artifacts">
                View artifact library
              </Link>
            </div>

            <p className="fine-print">
              v1 still keeps both outputs coupled to the same <code>SlideSpec[]</code>. The report brief and file-role
              manifest influence planning before Basquio renders anything.
            </p>
          </div>
        </div>
      </form>

      {error ? <div className="panel danger-panel">{error}</div> : null}

      {result ? (
        <section className="panel stack-lg success-panel">
          <div className="stack">
            <p className="section-label">Generation complete</p>
            <h3>{result.storyTitle}</h3>
            <p className="muted">
              {result.fileCount} file{result.fileCount === 1 ? "" : "s"} understood. {result.sheetCount} sheet
              {result.sheetCount === 1 ? "" : "s"} analyzed. {result.outlineSectionCount} outline sections planned.{" "}
              {result.slideCount} slides rendered.
            </p>
          </div>

          <div className="deliverable-grid">
            {result.artifacts.map((artifact) => (
              <article key={artifact.kind} className="deliverable-tile stack">
                <p className="artifact-kind">{artifact.kind === "pptx" ? "Editable PowerPoint" : "Polished PDF"}</p>
                <h4>{artifact.fileName}</h4>
                <p className="muted">
                  {artifact.kind === "pptx"
                    ? "Editable working file derived from the canonical slide plan."
                    : "Presentation-ready PDF generated from the same report contract."}
                </p>
                <a className="button" href={artifact.downloadUrl}>
                  Download {artifact.kind.toUpperCase()}
                </a>
              </article>
            ))}
          </div>

          {result.highlights.length > 0 ? (
            <div className="stack">
              <p className="section-label">Detected highlights</p>
              <ul className="clean-list">
                {result.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="row">
            <Link className="button secondary" href={`/artifacts?jobId=${result.jobId}`}>
              Open run in artifacts
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
