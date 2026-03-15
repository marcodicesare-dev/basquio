import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Privacy Summary | Basquio",
  description:
    "A plain-English privacy summary covering how Basquio handles account information, uploaded files, and generated outputs.",
};

export default function PrivacyPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack">
            <p className="section-label">Privacy summary</p>
            <h1>How Basquio currently handles your information.</h1>
            <p className="page-copy">
              This page is a plain-English summary for the current product. It explains what Basquio stores to run the
              workspace, process uploaded evidence packages, and deliver finished artifacts.
            </p>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Contact</p>
            <p>
              Questions about privacy or data handling can be sent to{" "}
              <a href="mailto:marco.dicesare@loamly.ai">marco.dicesare@loamly.ai</a>.
            </p>
          </aside>
        </div>
      </section>

      <section className="cards">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">What we collect</p>
            <h2>Account details, uploaded files, and generated outputs.</h2>
          </div>
          <ul className="clean-list">
            <li>Basic account information such as your email address.</li>
            <li>Files you upload to run an analysis.</li>
            <li>Generated artifacts such as PPTX and PDF outputs.</li>
            <li>Operational records needed to show run history and workspace state.</li>
          </ul>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">How it is used</p>
            <h2>Only to operate the reporting workflow.</h2>
          </div>
          <ul className="clean-list">
            <li>To authenticate your account and protect the private workspace.</li>
            <li>To analyze uploaded evidence packages and generate deliverables.</li>
            <li>To store run history so you can revisit prior outputs.</li>
            <li>To improve reliability, security, and support for the product.</li>
          </ul>
        </article>
      </section>

      <section className="cards">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Sharing</p>
            <h2>Basquio does not publish your workspace data.</h2>
            <p className="muted">
              Data may be processed by the infrastructure providers required to run the product, but the intent is to
              use your files only to deliver the Basquio workflow you requested.
            </p>
          </div>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="section-label">Requests</p>
            <h2>Need access, deletion, or clarification?</h2>
            <p className="muted">
              Reach out directly and include the workspace email address or run details involved so the request can be
              handled quickly.
            </p>
          </div>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow="Questions"
        title="Need to talk through privacy or workspace setup?"
        copy="Use the contact link in the footer and we can walk through the current workflow together."
        primaryLabel="Get started"
        primaryHref="/get-started"
        secondaryLabel="Back to home"
        secondaryHref="/"
      />
      <PublicSiteFooter />
    </div>
  );
}
