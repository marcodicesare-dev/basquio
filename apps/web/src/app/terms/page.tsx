import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Terms Summary | Basquio",
  description: "A plain-English summary of the current Basquio service terms and acceptable use expectations.",
};

export default function TermsPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack">
            <p className="section-label">Terms summary</p>
            <h1>Plain-English terms for the current Basquio service.</h1>
            <p className="page-copy">
              These terms describe how the current product is expected to be used while Basquio is still rolling out.
              They are intended to set clear expectations around accounts, uploaded material, generated outputs, and
              responsible use.
            </p>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Current status</p>
            <p>Basquio is still evolving, so these terms may be updated as the product and commercial model mature.</p>
          </aside>
        </div>
      </section>

      <section className="cards">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Accounts</p>
            <h2>You are responsible for the activity in your workspace.</h2>
          </div>
          <ul className="clean-list">
            <li>Keep your sign-in details secure.</li>
            <li>Use the workspace only if you have the right to upload the underlying files.</li>
            <li>Do not attempt to access another workspace without permission.</li>
          </ul>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Your material</p>
            <h2>You keep ownership of the files you upload.</h2>
            <p className="muted">
              You grant Basquio the limited right to process those files only as needed to run analyses and return the
              requested outputs.
            </p>
          </div>
        </article>
      </section>

      <section className="cards">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Acceptable use</p>
            <h2>Use the product responsibly.</h2>
          </div>
          <ul className="clean-list">
            <li>Do not upload material you do not have the right to use.</li>
            <li>Do not try to abuse, disrupt, or reverse engineer the service.</li>
            <li>Do not use the service to create unlawful, deceptive, or harmful outputs.</li>
          </ul>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Service changes</p>
            <h2>The workflow will continue to improve.</h2>
            <p className="muted">
              Features, limits, and commercial details may change as Basquio develops. If a change materially affects
              how the product is used, the expectation is that it will be communicated clearly.
            </p>
          </div>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow="Need clarity"
        title="Questions about usage, access, or rollout?"
        copy="Use the footer contact link if you want to walk through how the current service works before uploading a package."
        primaryLabel="Get started"
        primaryHref="/get-started"
        secondaryLabel="Privacy"
        secondaryHref="/privacy"
      />
      <PublicSiteFooter />
    </div>
  );
}
