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
    label: "Data",
    title: "Upload your business data",
    copy: "Spreadsheets, supporting notes, and context files — Basquio reads everything before starting the analysis.",
  },
  {
    label: "Brief",
    title: "Describe the business context",
    copy: "Audience, objective, thesis, and stakes shape the narrative. The stronger the brief, the better the output.",
  },
  {
    label: "Output",
    title: "Two deliverables, one analysis",
    copy: "Editable PowerPoint and polished PDF, both from the same structured analysis plan.",
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
            <p className="section-label">Create analysis</p>
            <h2>Upload your data, set the brief, and add your template.</h2>
            <p className="muted">
              Basquio analyzes your data, finds the insights, builds the narrative, and delivers an editable
              presentation and PDF.
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
              <span>Data files</span>
              <input
                name="evidenceFiles"
                type="file"
                accept=".csv,.xlsx,.xls,.doc,.docx,.txt,.md,.pdf,.pptx,.json,.css"
                multiple
                required
              />
              <small>Upload spreadsheets (CSV, Excel) and any supporting documents — methodology notes, context files, etc.</small>
            </label>

            <label className="field field-span-2">
              <span>Template (optional)</span>
              <input name="brandFile" type="file" accept=".json,.css,.pptx,.pdf" />
              <small>Upload a PPTX template for branded output, or a PDF/JSON file for style reference.</small>
            </label>

            <label className="field field-span-2">
              <span>Business context</span>
              <textarea
                name="businessContext"
                rows={5}
                placeholder="What is this data about? What does your audience need to understand? What decision depends on this analysis?"
                required
              />
            </label>

            <label className="field">
              <span>Client</span>
              <input name="client" defaultValue="Internal Basquio test client" placeholder="Unilever" />
            </label>

            <label className="field">
              <span>Audience</span>
              <input name="audience" defaultValue="Category leadership" placeholder="Regional category leadership" />
            </label>

            <label className="field">
              <span>Objective</span>
              <input
                name="objective"
                defaultValue="Explain what changed, why it matters, and what to do next"
                placeholder="Help the team decide what to do next"
              />
            </label>

            <label className="field">
              <span>Thesis</span>
              <input name="thesis" placeholder="Example: Growth is slowing in premium channels, not across the full category." />
            </label>

            <label className="field field-span-2">
              <span>Stakes</span>
              <textarea
                name="stakes"
                rows={3}
                placeholder="Why does this matter now? What happens if the analysis doesn't reach the right people?"
              />
            </label>
          </div>

          <div className="row form-actions">
            <div className="row">
              <button className="button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Generating presentation..." : "Generate presentation"}
              </button>
              <Link className="button secondary" href="/artifacts">
                View recent outputs
              </Link>
            </div>

            <p className="fine-print">
              Basquio analyzes your data and builds the narrative before rendering anything. Both outputs stay in
              sync.
            </p>
          </div>
        </div>
      </form>

      {error ? <div className="panel danger-panel">{error}</div> : null}

      {result ? (
        <section className="panel stack-lg success-panel">
          <div className="stack">
            <p className="section-label">Analysis ready</p>
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
                    ? "Editable PowerPoint file, ready for your team to refine."
                    : "Polished PDF built from the same analysis."}
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
