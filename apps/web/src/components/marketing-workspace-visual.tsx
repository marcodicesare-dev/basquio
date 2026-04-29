"use client";

import { useMemo, useState } from "react";

type ModeId = "one" | "workspace" | "team";

const modes: Array<{
  id: ModeId;
  label: string;
  intent: string;
  ask: string;
  memory: string[];
  outputs: string[];
  route: string;
}> = [
  {
    id: "one",
    label: "One output",
    intent: "Estimate one request",
    ask: "Turn this brief, data file, notes, old deck, and template into the files for Friday.",
    memory: ["Brief objective", "Source tables", "Template rules", "Review notes"],
    outputs: ["Deck", "Report", "Excel"],
    route: "Credits before run",
  },
  {
    id: "workspace",
    label: "Workspace Pro",
    intent: "Keep context alive",
    ask: "Use the last review, the same template, and the stakeholder notes for the next category update.",
    memory: ["Brand rules", "Stakeholder preferences", "Past review", "KPI definitions"],
    outputs: ["Updated deck", "Workbook", "Saved context"],
    route: "$199 per month",
  },
  {
    id: "team",
    label: "Team Workspace",
    intent: "Share recurring work",
    ask: "Prepare the monthly team output with shared projects, roles, and review history.",
    memory: ["Projects", "Roles", "Review trail", "Pilot onboarding"],
    outputs: ["Team deck", "Report", "Excel", "Review trail"],
    route: "From $500 per month",
  },
];

const sourceItems = ["Brief", "Data", "Notes", "Old deck", "Template"] as const;

export function MarketingWorkspaceVisual() {
  const [activeId, setActiveId] = useState<ModeId>("one");
  const active = useMemo(() => modes.find((mode) => mode.id === activeId) ?? modes[0], [activeId]);

  return (
    <div className={`mstudio-visual mstudio-visual-${active.id}`}>
      <div className="mstudio-mode-row" aria-label="Choose Basquio path">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={mode.id === active.id ? "mstudio-mode active" : "mstudio-mode"}
            aria-pressed={mode.id === active.id}
            onClick={() => setActiveId(mode.id)}
          >
            <span>{mode.label}</span>
            <small>{mode.intent}</small>
          </button>
        ))}
      </div>

      <div key={active.id} className="mstudio-product" aria-live="polite">
        <aside className="mstudio-rail">
          <p>Material</p>
          {sourceItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </aside>

        <main className="mstudio-thread">
          <div className="mstudio-window-bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="mstudio-thread-body">
            <div className="mstudio-thread-kicker">Analyst direction</div>
            <h2>{active.ask}</h2>
            <div className="mstudio-canvas">
              <div className="mstudio-chart" aria-hidden="true">
                <span style={{ height: "56%" }} />
                <span style={{ height: "72%" }} />
                <span style={{ height: "88%" }} />
                <span style={{ height: "64%" }} />
              </div>
              <div className="mstudio-slide">
                <strong>{active.outputs[0]}</strong>
                <span>{active.outputs[1]}</span>
                <span>{active.outputs[2]}</span>
              </div>
            </div>
          </div>
        </main>

        <aside className="mstudio-memory">
          <p>Workspace memory</p>
          {active.memory.map((item) => (
            <span key={item}>{item}</span>
          ))}
          <strong>{active.route}</strong>
        </aside>
      </div>

      <div className="mstudio-output-tray" aria-label="Output files">
        {active.outputs.map((output) => (
          <span key={output}>{output}</span>
        ))}
      </div>
    </div>
  );
}
