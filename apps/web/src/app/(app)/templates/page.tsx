import Image from "next/image";
import Link from "next/link";

import { createSystemTemplateProfile } from "@basquio/template-engine";

export default function TemplatesPage() {
  const template = createSystemTemplateProfile();

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Brand templates are coming soon</h1>

        <Link className="button" href="/jobs/new">
          Use the default brand system
        </Link>
      </section>

      <section className="workspace-board">
        <article className="panel stack-xl">
          <div className="stack">
            <h2>Basquio is currently using its default brand system for every presentation.</h2>
            <p className="muted">Template upload will land here once branded presentation previews are ready.</p>
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
              <p className="artifact-kind">Default output</p>
              <h2>Clean editorial slides, Basquio colors, and paired deliverables.</h2>
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
