export function UploadZone() {
  return (
    <div className="workflow-panel workflow-upload-panel">
      <div className="workflow-upload-dropzone">
        <div className="workflow-upload-icon">
          <span />
          <span />
        </div>
        <div className="stack">
          <strong>Drop your files here</strong>
          <p>CSV, Excel, notes, PDFs, and a deck template if you have one.</p>
        </div>
      </div>

      <div className="workflow-file-card">
        <div className="workflow-file-meta">
          <span className="workflow-file-badge">.xlsx</span>
          <div className="stack">
            <strong>Sales_Data_Q4.xlsx</strong>
            <span>434 KB</span>
          </div>
        </div>
        <div className="workflow-upload-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
