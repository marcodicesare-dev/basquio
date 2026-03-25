import type { Metadata } from "next";
import Link from "next/link";

import { evidencePackageInputs, gettingStartedSteps } from "@/app/site-content";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Get Started | Basquio",
  description: "See what to upload, what happens next, and how to start your first Basquio reporting workflow.",
};

export default function GetStartedPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">Get started</p>
              <h1>Start with one live reporting cycle.</h1>
              <p className="page-copy">
                Basquio works best when you begin with the files behind a real review. Upload one evidence package,
                check the first output, and decide from there whether the workflow should repeat.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try with your data
              </Link>
              <Link className="button secondary" href="/compare">
                Compare the alternatives
              </Link>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Evidence package</p>
            <p>
              An evidence package is simply the set of files behind one reporting cycle. Basquio reads them as one
              package instead of one disconnected upload at a time.
            </p>
          </aside>
        </div>
      </section>

      <section className="cards">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">What to bring</p>
            <h2>The files your team already uses.</h2>
          </div>

          <ul className="clean-list">
            {evidencePackageInputs.map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
        </article>

        <article className="technical-panel stack-lg">
          <div className="stack">
            <p className="section-label light">How the first run works</p>
            <h2>Three steps from package to output.</h2>
          </div>

          <div className="stack">
            {gettingStartedSteps.map((step, index) => (
              <div key={step.title} className="stage-row">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div className="stack-xs">
                  <strong>{step.title}</strong>
                  <p className="muted">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="cards">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">What you receive</p>
            <h2>An editable PPTX and a polished PDF.</h2>
            <p className="muted">
              The PowerPoint stays workable for your internal team. The PDF is ready for sharing when the story is
              locked.
            </p>
          </div>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Timeline</p>
            <h2>Track the run from upload to download.</h2>
            <p className="muted">
              Upload your files, fill in the brief, and Basquio generates both deliverables while you follow the run state end to end.
            </p>
          </div>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Pricing</p>
            <h2>Your first standard report is free.</h2>
            <p className="muted">
              No card needed. Start with live data, review the first draft, and decide from there whether the workflow should repeat.
            </p>
            <p className="muted">
              Standard reports are $10, Pro reports are $24, and team workspaces start at $149 per month.{" "}
              <a href="/pricing">See full pricing.</a>
            </p>
            <p className="muted">
              Credits and report type depend on slide count, scope, and workflow complexity.
            </p>
          </div>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Bring the files behind your next review."
        copy="Start with one live package and see how much of the reporting loop Basquio can take off the team."
        primaryLabel="Try with your data"
        primaryHref="/jobs/new"
        secondaryLabel="How it works"
        secondaryHref="/how-it-works"
      />
      <PublicSiteFooter />
    </div>
  );
}
