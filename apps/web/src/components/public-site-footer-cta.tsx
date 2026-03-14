import Link from "next/link";

export function PublicSiteFooterCta() {
  return (
    <section className="dark-panel cta-footer">
      <div className="stack">
        <p className="section-label light">Start with real evidence</p>
        <h2>Upload your data. Get your first analysis in minutes.</h2>
        <p className="muted">
          Evidence package in. Executive-ready PPTX and PDF out.
        </p>
      </div>

      <div className="row">
        <Link className="button" href="/jobs/new">
          Try Basquio free
        </Link>
        <Link className="button secondary inverted" href="/how-it-works">
          Read the full story
        </Link>
      </div>
    </section>
  );
}
