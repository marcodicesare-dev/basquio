"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

type IntentId = "one-output" | "workspace" | "team";

const intents: Array<{
  id: IntentId;
  label: string;
  short: string;
  priceCue: string;
  artifactTitle: string;
  artifactMeta: string;
  contextTitle: string;
  contextItems: string[];
  outputItems: string[];
}> = [
  {
    id: "one-output",
    label: "One output",
    short: "Estimate and run one deck package.",
    priceCue: "Credits estimated before purchase",
    artifactTitle: "Deck, report, Excel",
    artifactMeta: "One brief into finished files",
    contextTitle: "Material in",
    contextItems: ["Brief", "Data", "Notes", "Template"],
    outputItems: ["Editable PPTX", "Narrative report", "Excel workbook"],
  },
  {
    id: "workspace",
    label: "Workspace",
    short: "Keep the context for the next request.",
    priceCue: "$199 per month, one user",
    artifactTitle: "Recurring research room",
    artifactMeta: "The next ask starts with memory",
    contextTitle: "Saved context",
    contextItems: ["Brand rules", "Past reviews", "Stakeholder notes", "Approved formats"],
    outputItems: ["New deck", "Updated report", "Reusable workbook"],
  },
  {
    id: "team",
    label: "Team",
    short: "Share projects, reviews, and formats.",
    priceCue: "From $500 per month",
    artifactTitle: "Team research system",
    artifactMeta: "Shared work without shared chaos",
    contextTitle: "Team layer",
    contextItems: ["Projects", "Roles", "Reviews", "Pilot setup"],
    outputItems: ["Deck", "Report", "Excel", "Review trail"],
  },
];

const sourceInputs = ["Brief", "Data", "Notes", "Old deck", "Template"] as const;

export function MarketingIntentHero() {
  const [activeId, setActiveId] = useState<IntentId>("one-output");
  const active = useMemo(() => intents.find((intent) => intent.id === activeId) ?? intents[0], [activeId]);

  return (
    <section className={`g-hero g-hero-${active.id}`} aria-labelledby="homepage-hero-title">
      <div className="g-hero-copy">
        <p className="section-label light">For market research teams</p>
        <h1 id="homepage-hero-title">Your next research deck should not start from zero.</h1>
        <p className="g-hero-subhead">
          Basquio keeps the brief, data, notes, template, and past work together, then turns the next ask
          into a deck, report, and Excel file.
        </p>

        <div className="g-hero-actions">
          <Link className="button" href="/jobs/new">
            Start one output
          </Link>
          <Link className="button secondary inverted" href="/pricing">
            See pricing
          </Link>
        </div>

        <div className="g-intent-selector" role="tablist" aria-label="Choose how Basquio fits your work">
          {intents.map((intent) => (
            <button
              key={intent.id}
              type="button"
              className={intent.id === active.id ? "g-intent-button active" : "g-intent-button"}
              aria-pressed={intent.id === active.id}
              onClick={() => setActiveId(intent.id)}
            >
              <span>{intent.label}</span>
              <small>{intent.short}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="g-hero-artifact" aria-live="polite">
        <div className="g-source-spine" aria-label="Source material">
          {sourceInputs.map((source) => (
            <span key={source} className={active.contextItems.includes(source) ? "active" : ""}>
              {source}
            </span>
          ))}
        </div>

        <svg className="g-flow-lines" viewBox="0 0 640 420" aria-hidden="true">
          <path d="M64 72 C176 72 176 134 292 150" />
          <path d="M64 154 C172 154 190 184 292 194" />
          <path d="M64 236 C174 236 188 224 292 224" />
          <path d="M64 318 C182 318 184 268 292 250" />
          <path d="M442 214 C512 214 528 180 586 148" className="output" />
          <path d="M442 238 C512 238 526 244 586 250" className="output" />
          <path d="M442 262 C512 262 528 310 586 338" className="output" />
        </svg>

        <div className="g-output-stage">
          <div className="g-stage-chrome" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="g-stage-body">
            <div className="g-slide-frame">
              <Image
                src="/showcase/slide-showcase-executive.svg"
                alt="Finished Basquio research slide with charts and a clear finding"
                width={960}
                height={540}
                priority
              />
            </div>

            <aside className="g-context-panel">
              <span className="g-panel-kicker">{active.contextTitle}</span>
              <div className="g-context-list">
                {active.contextItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </aside>

            <aside className="g-output-panel">
              <span className="g-panel-kicker">{active.artifactMeta}</span>
              <strong>{active.artifactTitle}</strong>
              <span>{active.priceCue}</span>
            </aside>
          </div>
        </div>

        <div className="g-output-rail" aria-label="Files returned">
          {active.outputItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
