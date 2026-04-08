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
      <div className="workflow-chart-header">
        <div className="stack">
          <span className="workflow-chart-kicker">Chart rendering</span>
          <strong>Market Share by Brand - Q4 2025</strong>
        </div>
      </div>

      <div className="workflow-chart-shell">
        {chartBars.map((bar, index) => (
          <div key={bar.label} className="workflow-chart-row" style={{ ["--bar-width" as string]: bar.width }}>
            <span>{bar.label}</span>
            <div className="workflow-chart-track">
              <div className={`workflow-chart-fill${index === 0 ? " accent" : ""}`} />
            </div>
            <strong>{bar.value}</strong>
          </div>
        ))}
      </div>

      <p className="workflow-chart-source">Source: Uploaded market and sell-out files</p>
    </div>
  );
}
