const previewRows = [
  ["Basquio Private Label", "$8.4M", "24.8%", "+7.2%"],
  ["NorthPeak Foods", "$6.9M", "20.4%", "+2.8%"],
  ["Harbor Pantry", "$5.7M", "16.9%", "-1.1%"],
  ["Alta Select", "$4.8M", "14.2%", "+5.6%"],
  ["Market Street", "$4.1M", "12.1%", "+3.4%"],
  ["Goldcrest", "$3.9M", "11.6%", "-0.4%"],
];

export function DataPreview() {
  return (
    <div className="workflow-panel workflow-data-panel">
      <div className="workflow-processing-label">Reading 12,847 rows across 3 sheets</div>

      <div className="workflow-table-shell">
        <table className="workflow-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Revenue</th>
              <th>Share</th>
              <th>Growth</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell) => (
                  <td key={cell}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="workflow-scan-line" aria-hidden="true" />
      </div>
    </div>
  );
}
