import { createSystemTemplateProfile } from "@basquio/template-engine";

export default function TemplatesPage() {
  const template = createSystemTemplateProfile();

  return (
    <div className="grid">
      <section className="panel stack">
        <p className="eyebrow">Templates</p>
        <h1>PPTX-first template layer</h1>
        <p className="muted">
          `.pptx` is the editable template input in v1. `.pdf` can influence style, but it does not get promoted to an
          editable source of truth.
        </p>
      </section>

      <section className="panel stack">
        <p className="eyebrow">System profile</p>
        <pre className="code-block">{JSON.stringify(template, null, 2)}</pre>
      </section>
    </div>
  );
}
