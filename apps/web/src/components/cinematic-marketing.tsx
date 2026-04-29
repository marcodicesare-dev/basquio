"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

type BuyerPath = "one" | "workspace" | "team";

const buyerPaths: Record<
  BuyerPath,
  {
    label: string;
    caption: string;
    direction: string;
    source: string[];
    memory: string[];
    outputs: string[];
    cue: string;
    primary: string;
    href: string;
  }
> = {
  one: {
    label: "One output",
    caption: "Estimate credits",
    direction: "Brief plus files become a deck, report, and Excel workbook.",
    source: ["Brief", "Data", "Notes", "Old deck", "Template"],
    memory: ["Credit estimate", "Output scope", "Review checklist"],
    outputs: ["Deck", "Report", "Excel"],
    cue: "Credit estimate before the run",
    primary: "Start one output",
    href: "/jobs/new",
  },
  workspace: {
    label: "Workspace",
    caption: "Keep context",
    direction: "Past work, templates, and stakeholder preferences stay ready for the next ask.",
    source: ["Brief", "Data", "Notes", "Past reviews", "Brand rules"],
    memory: ["Template", "Stakeholders", "Approved format"],
    outputs: ["Next deck", "Report", "Charts"],
    cue: "Context carries into the next request",
    primary: "See the workspace",
    href: "/workspace-pro",
  },
  team: {
    label: "Team",
    caption: "Share recurring work",
    direction: "Projects, roles, review trails, and shared memory stay in one research workspace.",
    source: ["Projects", "Data rooms", "Transcripts", "Templates", "Reviews"],
    memory: ["Roles", "Review trail", "Shared formats"],
    outputs: ["Team deck", "Evidence trail", "Workbook"],
    cue: "Shared work without rebuilding the brief",
    primary: "Plan a team pilot",
    href: "/team-workspace",
  },
};

export function CinematicHero() {
  const [path, setPath] = useState<BuyerPath>("one");
  const active = buyerPaths[path];

  return (
    <section className="cinematic-hero" aria-labelledby="cinematic-hero-title">
      <div className="cinematic-hero-copy">
        <p className="section-label light">For market research teams</p>
        <h1 id="cinematic-hero-title">Your next research deck should not start from zero.</h1>
        <p className="cinematic-subhead">
          Basquio keeps the brief, data, notes, template, and past work together, then turns the next ask
          into a deck, report, and Excel file.
        </p>

        <div className="cinematic-path-switcher" aria-label="Choose a buying path">
          {(Object.keys(buyerPaths) as BuyerPath[]).map((key) => (
            <button
              key={key}
              type="button"
              className={path === key ? "cinematic-path-button active" : "cinematic-path-button"}
              onClick={() => setPath(key)}
            >
              <strong>{buyerPaths[key].label}</strong>
              <span>{buyerPaths[key].caption}</span>
            </button>
          ))}
        </div>

        <div className="cinematic-hero-actions">
          <Link className="button" href={active.href}>
            {active.primary}
          </Link>
          <Link className="button secondary inverted" href="/pricing">
            See pricing
          </Link>
        </div>
      </div>

      <OutputArtifact active={active} path={path} />
    </section>
  );
}

function OutputArtifact({ active, path }: { active: (typeof buyerPaths)[BuyerPath]; path: BuyerPath }) {
  return (
    <div className={`cinematic-artifact path-${path}`} aria-live="polite">
      <div className="source-rail source-rail-left">
        <p>Material</p>
        {active.source.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>

      <div className="cinematic-flow-line" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="finished-files-stage">
        <div className="deck-window">
          <div className="window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <Image
            src="/showcase/slide-showcase-executive.svg"
            alt="Finished Basquio executive slide with KPI cards, chart, and finding"
            width={960}
            height={540}
            priority
          />
        </div>

        <div className="report-sheet">
          <span>Narrative report</span>
          <strong>{active.outputs[1]}</strong>
          <p>{active.direction}</p>
          <i />
          <i />
          <i />
        </div>

        <div className="workbook-sheet">
          <span>Workbook</span>
          <strong>{active.outputs[2]}</strong>
          <div className="workbook-grid" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
        </div>
      </div>

      <div className="source-rail source-rail-right">
        <p>Remembered</p>
        {active.memory.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>

      <div className="artifact-caption">
        <span>{active.label}</span>
        <strong>{active.cue}</strong>
      </div>
    </div>
  );
}

export function CinematicProof() {
  return (
    <section className="cinematic-proof">
      <div className="cinematic-proof-copy">
        <p className="section-label">The workspace model</p>
        <h2>The finished file is only half the system.</h2>
        <p>
          The research direction, sources, brand rules, and past reviews stay together so the next request
          starts from the team context, not a blank slide.
        </p>
      </div>

      <div className="cinematic-proof-grid" aria-label="Basquio flow">
        <article>
          <span>01</span>
          <strong>Bring the work</strong>
          <p>Brief, data, notes, transcripts, template, and past decks.</p>
        </article>
        <article>
          <span>02</span>
          <strong>Set the direction</strong>
          <p>The analyst keeps the point of view and chooses the output.</p>
        </article>
        <article>
          <span>03</span>
          <strong>Review finished files</strong>
          <p>Deck, report, Excel file, charts, and evidence trail.</p>
        </article>
      </div>
    </section>
  );
}

export function CinematicHomePricing() {
  return (
    <section className="cinematic-buying-strip">
      <div>
        <p className="section-label">Buying paths</p>
        <h2>One-off output, recurring workspace, or shared team memory.</h2>
      </div>
      <Link className="button secondary" href="/pricing">
        Open pricing
      </Link>
    </section>
  );
}
