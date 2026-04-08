"use client";

import { useScrollProgress } from "@/hooks/use-scroll-progress";

import { BriefInput } from "./workflow-states/brief-input";
import { ChartRender } from "./workflow-states/chart-render";
import { DataPreview } from "./workflow-states/data-preview";
import { DeckPreview } from "./workflow-states/deck-preview";
import { UploadZone } from "./workflow-states/upload-zone";

const workflowSteps = [
  {
    label: "Upload",
    title: "Upload your data",
    description: "CSV, Excel, notes, PDFs, and a deck template if you have one.",
    panel: <UploadZone />,
  },
  {
    label: "Brief",
    title: "Define the ask",
    description: "Tell Basquio what the meeting needs to answer.",
    panel: <BriefInput />,
  },
  {
    label: "Analysis",
    title: "Read the model",
    description: "The engine reads the sheets, rows, and context before writing a word.",
    panel: <DataPreview />,
  },
  {
    label: "Charts",
    title: "Render the story",
    description: "Charts, source lines, and narrative structure appear in one pass.",
    panel: <ChartRender />,
  },
  {
    label: "Deck",
    title: "Ship the deliverables",
    description: "Deck, report, and workbook land aligned and ready to send.",
    panel: <DeckPreview />,
  },
] as const;

export function ScrollWorkflowShowcase() {
  const { activeStep, progress, trackRef } = useScrollProgress(workflowSteps.length);

  return (
    <section className="workflow-showcase" id="workflow">
      <div className="workflow-track" ref={trackRef}>
        <div className="workflow-sticky">
          <div className="workflow-stage-shell">
            <div className="workflow-copy">
              <div className="stack">
                <p className="section-label">How it works</p>
                <h2>Upload your data. Get the deck.</h2>
                <p className="workflow-copy-body">
                  Three steps. No formatting. No chart-building. Just the finished analysis.
                </p>
              </div>

              <div className="workflow-proof-row" aria-hidden="true">
                <div className="workflow-proof-card">
                  <span>Turnaround</span>
                  <strong>15 min</strong>
                </div>
                <div className="workflow-proof-card">
                  <span>Deliverables</span>
                  <strong>3 files</strong>
                </div>
              </div>

              <div className="workflow-copy-detail">
                <span>Step {activeStep + 1}</span>
                <p>{workflowSteps[activeStep]?.description}</p>
                <div className="workflow-progress-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${Math.max(progress, 0.08)})` }} />
                </div>
              </div>

              <div className="workflow-progress" aria-label="Workflow steps">
                {workflowSteps.map((step, index) => (
                  <div
                    key={step.label}
                    className={`workflow-progress-step${index === activeStep ? " active" : ""}`}
                  >
                    <span className="workflow-progress-dot" aria-hidden="true" />
                    <div className="stack">
                      <strong>{step.label}</strong>
                      <p>{step.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="workflow-visual-wrap">
              <div className="workflow-visual-orbit workflow-visual-orbit-left" aria-hidden="true">
                <span className="workflow-visual-orbit-label">Inputs</span>
                <strong>CSV / XLSX / PDF</strong>
                <p>Files, notes, and brand templates travel together.</p>
              </div>

              <div className="workflow-visual" aria-live="polite">
                {workflowSteps.map((step, index) => (
                  <div
                    key={step.label}
                    className={`workflow-state${index === activeStep ? " active" : ""}`}
                    aria-hidden={index !== activeStep}
                  >
                    {step.panel}
                  </div>
                ))}
              </div>

              <div className="workflow-visual-orbit workflow-visual-orbit-right" aria-hidden="true">
                <span className="workflow-visual-orbit-label">Outputs</span>
                <strong>Deck / Report / Workbook</strong>
                <p>One analysis becomes the full artifact pack.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="workflow-sentinel-stack" aria-hidden="true">
          {workflowSteps.map((step, index) => (
            <div
              key={step.label}
              className="workflow-sentinel"
              data-workflow-sentinel="true"
              data-step-index={index}
            />
          ))}
        </div>
      </div>

      <div className="workflow-mobile-stack">
        {workflowSteps.map((step) => (
          <article key={step.label} className="workflow-mobile-card">
            <div className="stack">
              <p className="section-label">{step.label}</p>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
            <div className="workflow-mobile-visual">{step.panel}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
