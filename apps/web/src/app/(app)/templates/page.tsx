import Image from "next/image";
import Link from "next/link";

import { createSystemTemplateProfile } from "@basquio/template-engine";

export default function TemplatesPage() {
  const template = createSystemTemplateProfile();
  const brandTokens = template.brandTokens;

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-lg">
            <div className="stack">
              <p className="section-label">Templates</p>
              <h1>Template control stays productized, not decorative.</h1>
              <p className="page-copy">
                Basquio currently renders against the shared system profile so the CSV-first path stays stable. The next
                step remains honest: PPTX template ingestion and file-backed brand-token handling through the existing
                template contract.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Use current system profile
              </Link>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Current baseline</p>
            <p>{template.sourceType}</p>
            <p className="muted">
              The renderer is intentionally narrow right now so evidence understanding and artifact generation can be
              proven end to end before customer templates go live.
            </p>
          </aside>
        </div>

        <div className="summary-strip">
          <article className="summary-card">
            <span className="summary-value">{template.layouts.length}</span>
            <span className="summary-label">System layouts in the current profile</span>
          </article>
          <article className="summary-card">
            <span className="summary-value">{template.colors.length}</span>
            <span className="summary-label">Color tokens resolved for rendering</span>
          </article>
          <article className="summary-card">
            <span className="summary-value">{template.fonts.length}</span>
            <span className="summary-label">Fonts currently declared in the contract</span>
          </article>
        </div>
      </section>

      <section className="template-grid">
        <article className="technical-panel stack-xl">
          <div className="row split">
            <div className="stack">
              <p className="section-label light">System profile</p>
              <h2>The current renderer baseline already carries Basquio’s core brand cues.</h2>
            </div>
            <Image src="/brand/svg/logo/basquio-logo-dark-bg.svg" alt="Basquio" width={168} height={27} />
          </div>

          <div className="token-swatches">
            {template.colors.map((color) => (
              <article key={color} className="signal-card stack">
                <div className="swatch-color" style={{ backgroundColor: color }} />
                <p className="artifact-kind">{color}</p>
              </article>
            ))}
          </div>

          <div className="layout-list">
            {template.layouts.map((layout) => (
              <article key={layout.id} className="signal-card stack">
                <p className="artifact-kind">{layout.name}</p>
                <h3>{layout.id}</h3>
                <ul className="placeholder-list">
                  {layout.placeholders.map((placeholder) => (
                    <li key={placeholder}>{placeholder}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </article>

        <article className="panel stack-xl">
          <div className="stack">
            <p className="section-label">Source handling</p>
            <h2>What Basquio accepts and how it interprets each input.</h2>
          </div>

          <div className="brief-rule-grid">
            <article className="brief-rule stack">
              <p className="section-label">Now</p>
              <h3>System theme only</h3>
              <p className="muted">Generated runs use the shared system profile so the end-to-end product path remains testable.</p>
            </article>
            <article className="brief-rule stack">
              <p className="section-label">Next</p>
              <h3>PPTX template ingestion</h3>
              <p className="muted">Editable customer templates remain the first-class next step after the current pipeline is reliable.</p>
            </article>
            <article className="brief-rule stack">
              <p className="section-label">Constraint</p>
              <h3>PDF is style reference only</h3>
              <p className="muted">PDF upload will not be promoted to editable template fidelity in v1.</p>
            </article>
          </div>

          <div className="profile-grid">
            <article className="meta-card stack">
              <p className="artifact-kind">Logo hints</p>
              {template.logoAssetHints.map((hint) => (
                <p key={hint} className="muted">
                  {hint}
                </p>
              ))}
            </article>
            <article className="meta-card stack">
              <p className="artifact-kind">Typography</p>
              {template.fonts.map((font) => (
                <p key={font}>{font}</p>
              ))}
            </article>
            <article className="meta-card stack">
              <p className="artifact-kind">Spacing tokens</p>
              {template.spacingTokens.map((token) => (
                <p key={token}>{token}</p>
              ))}
            </article>
          </div>
        </article>
      </section>

      <section className="panel stack-xl">
        <div className="stack">
          <p className="section-label">Resolved contract</p>
          <h2>Template and brand inputs still resolve through the structured Basquio profile.</h2>
          <p className="muted">
            The summary below is the live profile the renderer works against today, including the current brand-token
            defaults for palette, typography, spacing, and logo treatment.
          </p>
        </div>

        {brandTokens ? (
          <div className="profile-grid">
            <article className="swatch-card stack">
              <p className="artifact-kind">Palette</p>
              <p>Text: {brandTokens.palette.text}</p>
              <p>Accent: {brandTokens.palette.accent}</p>
              <p>Highlight: {brandTokens.palette.highlight}</p>
            </article>
            <article className="swatch-card stack">
              <p className="artifact-kind">Typography</p>
              <p>{brandTokens.typography.headingFont}</p>
              <p className="muted">Body: {brandTokens.typography.bodyFont}</p>
              <p className="muted">Mono: {brandTokens.typography.monoFont}</p>
            </article>
            <article className="swatch-card stack">
              <p className="artifact-kind">Logo treatment</p>
              <p>{brandTokens.logo.treatment}</p>
              <p className="muted">{brandTokens.logo.wordmarkPath}</p>
            </article>
          </div>
        ) : null}

        <pre className="code-block">{JSON.stringify(template, null, 2)}</pre>
      </section>
    </div>
  );
}
