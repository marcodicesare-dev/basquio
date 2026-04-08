const chartBars = [
  { label: "Private Label", value: "24.8%", width: "92%" },
  { label: "NorthPeak", value: "20.4%", width: "78%" },
  { label: "Harbor Pantry", value: "16.9%", width: "64%" },
  { label: "Alta Select", value: "14.2%", width: "56%" },
  { label: "Market Street", value: "12.1%", width: "48%" },
];

export function ChartRender() {
  return (
    <div className="workflow-panel workflow-chart-panel">
      <div className="workflow-chart-topbar">
        <div className="stack">
          <span className="workflow-chart-kicker">Chart rendering</span>
          <strong>Market Share by Brand - Q4 2025</strong>
        </div>
        <div className="workflow-chart-stat">
          <span>Top mover</span>
          <strong>+7.2%</strong>
        </div>
      </div>

      <div className="workflow-chart-shell">
        <div className="workflow-chart-axis" aria-hidden="true">
          <span>0%</span>
          <span>10%</span>
          <span>20%</span>
          <span>30%</span>
        </div>

        {chartBars.map((bar, index) => (
          <div key={bar.label} className="workflow-chart-row" style={{ ["--bar-width" as string]: bar.width }}>
            <span className="workflow-chart-label">{bar.label}</span>
            <div className="workflow-chart-track">
              <div className="workflow-chart-grid" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className={`workflow-chart-fill${index === 0 ? " accent" : ""}`} />
            </div>
            <strong className="workflow-chart-value">{bar.value}</strong>
          </div>
        ))}
      </div>

      <div className="workflow-chart-footer">
        <div className="workflow-chart-summary">
          <span className="workflow-chart-summary-label">Key read</span>
          <p>Private label leads the quarter while branded share compresses across every major segment.</p>
        </div>
        <p className="workflow-chart-source">Source: Uploaded market and sell-out files</p>
      </div>

    </div>
  );
}
