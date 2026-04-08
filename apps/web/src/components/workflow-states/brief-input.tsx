export function BriefInput() {
  return (
    <div className="workflow-panel workflow-brief-panel">
      <div className="workflow-form-field">
        <label>What should the deck analyze?</label>
        <div className="workflow-brief-editor">
          <p className="workflow-brief-typing">
            Analyze category performance for private label vs branded. Focus on share shifts and growth drivers
            for the leadership review.
          </p>
        </div>
      </div>

      <div className="workflow-form-row">
        <div className="workflow-form-field compact">
          <label>Audience</label>
          <div className="workflow-select-pill">Leadership team</div>
        </div>
        <button type="button" className="workflow-generate-button">
          Generate deck
        </button>
      </div>
    </div>
  );
}
