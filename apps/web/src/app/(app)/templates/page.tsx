import Image from "next/image";
import Link from "next/link";

import { createSystemTemplateProfile } from "@basquio/template-engine";

export default function TemplatesPage() {
  const template = createSystemTemplateProfile();

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Brand system</h1>

        <Link className="button" href="/jobs/new">
          New report
        </Link>
      </section>

      <section className="workspace-board">
        <article className="panel stack-xl">
          <div className="stack">
            <p className="artifact-kind">Current design system</p>
            <h2>Every report uses a clean, editorial style with your brand colors applied automatically.</h2>
            <p className="muted">Upload a custom brand template (PPTX, JSON, or CSS) when creating a new report. Basquio extracts your colors, fonts, and style tokens and applies them to the deck.</p>
          </div>

          <div className="brand-preview-strip">
            {template.colors.slice(0, 4).map((color) => (
              <div key={color} className="brand-preview-swatch">
                <span className="swatch-color" style={{ backgroundColor: color }} />
                <span>{color}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel stack-xl default-brand-preview">
          <div className="row split">
            <div className="stack-xs">
              <p className="artifact-kind">Preview</p>
              <h2>Clean slides, paired PPTX and PDF, consistent typography.</h2>
            </div>
            <Image src="/brand/svg/logo/basquio-logo-light-bg-mono.svg" alt="Basquio" width={150} height={24} />
          </div>

          <div className="default-brand-slide" aria-hidden>
            <div className="deck-kicker">Executive summary</div>
            <div className="deck-line long" />
            <div className="deck-line medium" />
            <div className="mini-brand-chart">
              <span />
              <span />
              <span className="accent" />
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
