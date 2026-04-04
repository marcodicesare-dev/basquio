import type { Metadata } from "next";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Trust — How Basquio Protects Your Data",
  description:
    "Your data is encrypted, never used for AI training, and processed in temporary containers that are destroyed after each run. Here is exactly what happens to your files.",
  alternates: { canonical: "https://basquio.com/trust" },
};

const commitments = [
  {
    title: "Your data is never used for training",
    detail:
      "Basquio uses the Anthropic API to analyze your files. Anthropic does not use API data to train models. This is not an opt-out. It is their default policy for all commercial API customers.",
    source: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training",
    sourceLabel: "Anthropic policy",
  },
  {
    title: "Processing happens in a temporary container",
    detail:
      "When you start a run, your files are loaded into a sandboxed container. The analysis runs, the deck is built, and the container is destroyed. Your source data does not persist inside the AI system after the run completes.",
  },
  {
    title: "AI-side data is auto-deleted within 7 days",
    detail:
      "Anthropic retains API logs for up to 7 days for safety monitoring, then deletes them automatically. Zero-retention agreements are available for enterprise customers who need immediate deletion.",
    source: "https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention",
    sourceLabel: "Anthropic retention policy",
  },
  {
    title: "Encrypted in transit and at rest",
    detail:
      "Files are encrypted with TLS 1.3 during upload and download. Stored files are encrypted at rest with AES-256 on AWS infrastructure.",
  },
  {
    title: "Your files stay yours",
    detail:
      "Basquio does not share, sell, or expose your data to third parties. Your uploaded files and generated decks are visible only to you and your workspace members.",
  },
] as const;

export default function TrustPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack-xl">
          <div className="stack">
            <p className="section-label">Trust</p>
            <h1>Your data is safe. Here is exactly what happens to it.</h1>
            <p className="page-copy" style={{ maxWidth: "560px" }}>
              We built Basquio for analysts who work with sensitive commercial data every day.
              We know what is at stake when you upload a file. This page explains precisely
              where your data goes, how it is protected, and when it is deleted.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="stack-xl">
          <div className="stack">
            <p className="section-label">Commitments</p>
            <h2>Five things that are always true.</h2>
          </div>

          <div className="trust-grid">
            {commitments.map((item) => (
              <article key={item.title} className="trust-card">
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                {"source" in item && item.source && (
                  <a
                    href={item.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="trust-source-link"
                  >
                    {item.sourceLabel} &rarr;
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel dark-panel">
        <div className="stack" style={{ maxWidth: "640px" }}>
          <p className="section-label light">How it works</p>
          <h2>What happens when you upload a file.</h2>
        </div>
        <div className="trust-flow">
          <div className="trust-flow-step">
            <span className="trust-flow-number">1</span>
            <div>
              <p className="trust-flow-title">You upload your Excel or CSV</p>
              <p className="muted">Encrypted with TLS 1.3 during transfer. Stored encrypted (AES-256) in your workspace.</p>
            </div>
          </div>
          <div className="trust-flow-step">
            <span className="trust-flow-number">2</span>
            <div>
              <p className="trust-flow-title">A temporary container processes your data</p>
              <p className="muted">The file is loaded into a sandboxed environment. The AI reads your data, runs the analysis, builds the charts, and writes the deck.</p>
            </div>
          </div>
          <div className="trust-flow-step">
            <span className="trust-flow-number">3</span>
            <div>
              <p className="trust-flow-title">The container is destroyed</p>
              <p className="muted">After the run completes, the processing environment is deleted. Your source data does not persist in the AI system.</p>
            </div>
          </div>
          <div className="trust-flow-step">
            <span className="trust-flow-number">4</span>
            <div>
              <p className="trust-flow-title">You download your deck</p>
              <p className="muted">The finished PPTX, narrative report, and data workbook are stored encrypted in your workspace until you delete them.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="stack-xl">
          <div className="stack">
            <p className="section-label">Infrastructure</p>
            <h2>Who processes what.</h2>
          </div>

          <div className="trust-infra-grid">
            <div className="trust-infra-card">
              <p className="trust-infra-name">Anthropic (Claude API)</p>
              <p className="trust-infra-role">AI analysis and deck generation</p>
              <ul>
                <li>SOC 2 Type II certified</li>
                <li>ISO 27001 certified</li>
                <li>ISO 42001 certified (AI management)</li>
                <li>No training on API data</li>
                <li>7-day auto-deletion</li>
              </ul>
              <a href="https://trust.anthropic.com/" target="_blank" rel="noopener noreferrer" className="trust-source-link">
                Anthropic Trust Center &rarr;
              </a>
            </div>

            <div className="trust-infra-card">
              <p className="trust-infra-name">AWS (via Supabase)</p>
              <p className="trust-infra-role">File storage and database</p>
              <ul>
                <li>AES-256 encryption at rest</li>
                <li>TLS 1.3 in transit</li>
                <li>SOC 2, ISO 27001, HIPAA eligible</li>
                <li>US-East-1 region</li>
              </ul>
            </div>

            <div className="trust-infra-card">
              <p className="trust-infra-name">Vercel</p>
              <p className="trust-infra-role">Web application hosting</p>
              <ul>
                <li>SOC 2 Type II certified</li>
                <li>Edge network with TLS</li>
                <li>No persistent data storage</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="stack" style={{ maxWidth: "640px" }}>
          <p className="section-label">Enterprise</p>
          <h2>Need more? We are building for it.</h2>
          <p style={{ lineHeight: 1.7 }}>
            We are working toward SOC 2 Type II certification for Basquio itself.
            Enterprise features like SSO, audit logs, and the option to route AI
            processing through your own cloud account (AWS Bedrock, Google Vertex AI)
            are on the roadmap.
          </p>
          <p style={{ lineHeight: 1.7 }}>
            If your organization has specific security requirements,{" "}
            <a href="mailto:marco@basquio.com">reach out directly</a>.
            We will walk through the architecture with your security team.
          </p>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Try it with your own data."
        copy="Upload a real file. If the output is strong enough to present, the workflow is doing its job."
        primaryLabel="Try it free"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
