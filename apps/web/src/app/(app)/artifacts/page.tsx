export default function ArtifactsPage() {
  return (
    <div className="grid">
      <section className="panel stack">
        <p className="eyebrow">Artifacts</p>
        <h1>PPTX and PDF stay coupled to the same slide plan.</h1>
        <p className="muted">
          Artifact persistence prefers Supabase Storage when service credentials are configured. Local file fallback is
          development-only and should not be relied on in production deployments.
        </p>
      </section>

      <section className="grid cards">
        <article className="panel stack compact">
          <p className="eyebrow">Editable PPTX</p>
          <p className="muted">PptxGenJS-backed stub with template-preserving support wired through pptx-automizer.</p>
        </article>
        <article className="panel stack compact">
          <p className="eyebrow">Polished PDF</p>
          <p className="muted">Browserless-first HTML render path, with pdf-lib placeholder output when tokens are absent.</p>
        </article>
      </section>
    </div>
  );
}
