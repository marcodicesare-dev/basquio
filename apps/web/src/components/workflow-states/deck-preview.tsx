import Image from "next/image";

export function DeckPreview() {
  return (
    <div className="workflow-panel workflow-deck-panel">
      <div className="workflow-window-chrome">
        <span />
        <span />
        <span />
      </div>

      <div className="workflow-slide-frame">
        <Image
          src="/showcase/slide-showcase-executive.svg"
          alt="Executive overview slide with KPI cards, segment breakdown, and key finding"
          width={960}
          height={540}
        />
      </div>

      <div className="workflow-deliverables">
        <div className="workflow-deliverable-card workflow-deliverable-proof">
          <span className="workflow-deliverable-kind">Turnaround</span>
          <strong>15 min</strong>
        </div>
        <div className="workflow-deliverable-card workflow-deliverable-proof">
          <span className="workflow-deliverable-kind">Deliverables</span>
          <strong>3 files</strong>
        </div>
        <div className="workflow-deliverable-card">
          <span className="workflow-deliverable-kind">Deck</span>
          <strong>deck.pptx</strong>
        </div>
        <div className="workflow-deliverable-card">
          <span className="workflow-deliverable-kind">Narrative</span>
          <strong>report.md</strong>
        </div>
        <div className="workflow-deliverable-card">
          <span className="workflow-deliverable-kind">Workbook</span>
          <strong>workbook.xlsx</strong>
        </div>
      </div>

      <p className="workflow-ready-label">15 minutes. 3 files. Ready to present.</p>
    </div>
  );
}
