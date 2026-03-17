import type { Metadata } from "next";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "About | Basquio",
  description:
    "The team behind Basquio: six people who spent years building category review decks by hand, now building the tool that does it right.",
};

const team = [
  {
    name: "Marco Di Cesare",
    title: "Founder & CTO",
    background:
      "Full-stack engineer. Builds the entire system — AI pipeline, infrastructure, frontend, everything.",
    contact: "marco@basquio.com",
  },
  {
    name: "Francesco",
    title: "Finance Advisor",
    background:
      "NielsenIQ. Financial modeling, pricing strategy, and unit economics.",
  },
  {
    name: "Rossella",
    title: "Product Advisor",
    background:
      "NielsenIQ. Product management and quality — if the output wouldn't pass her review, it ships again.",
  },
  {
    name: "Alessandro",
    title: "Commercial Advisor",
    background:
      "NielsenIQ. Enterprise sales. Knows what it takes to get a CPG team to trust a new tool.",
  },
  {
    name: "Veronica",
    title: "Domain Expert — Buyer Side",
    background:
      "Victorinox. Brings the buyer perspective — what brand teams actually need from a category review deck.",
  },
  {
    name: "Giulia",
    title: "Domain Expert — Brand Side",
    background:
      "Mondelez. Brand strategy and marketing — ensures Basquio speaks the language CPG teams use.",
  },
] as const;

export default function AboutPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">About</p>
              <h1>Built by the people who used to make these decks by hand.</h1>
              <p className="page-copy">
                Three NielsenIQ analysts, a Mondelez brand manager, a Victorinox buyer, and one engineer
                who got tired of the gap between having the data and having a deck people can use. We know
                what a good category review looks like because we&apos;ve presented hundreds of them.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">The team</p>
            <h2>1 founder-engineer + 5 domain advisors</h2>
            <p className="muted">
              Domain experts shaping AI tools for work they already know — not engineers guessing at a domain.
            </p>
          </aside>
        </div>
      </section>

      <section className="stack-lg">
        <div className="stack-xs">
          <p className="section-label">The team</p>
          <h2>Six people, one problem</h2>
        </div>
        <div className="cards">
          {team.map((member) => (
            <article key={member.name} className="panel stack-xs">
              <p className="artifact-kind">{member.title}</p>
              <h2>{member.name}</h2>
              <p className="muted">{member.background}</p>
              {"contact" in member && member.contact ? (
                <p className="muted">
                  <a href={`mailto:${member.contact}`}>{member.contact}</a>
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="stack-lg">
        <div className="stack-xs">
          <p className="section-label">How we build</p>
          <h2>Three things we will not compromise on</h2>
        </div>
        <div className="cards">
          <article className="panel stack">
            <h2>Evidence first, always</h2>
            <p className="muted">
              Every chart, every claim, every slide traces back to your actual
              data. We built Basquio to start from real files — not prompts and
              prayers. If the numbers don&apos;t support it, it doesn&apos;t
              make the deck.
            </p>
          </article>
          <article className="panel stack">
            <h2>Math before narrative</h2>
            <p className="muted">
              The system computes before it writes. Statistical tests run first,
              the story forms around what the data can actually support. We have
              seen too many decks where the narrative led and the numbers were
              bent to fit.
            </p>
          </article>
          <article className="panel stack">
            <h2>Usable on day one</h2>
            <p className="muted">
              The output is a real PPTX or PDF you can open, review, edit, and
              present. No screenshots of dashboards. No &ldquo;export
              coming soon.&rdquo; If your team can&apos;t use it tomorrow
              morning, we have not done our job.
            </p>
          </article>
        </div>
      </section>

      <section className="panel dark-panel stack-lg">
        <div className="stack">
          <p className="section-label light">Why this team</p>
          <h2>We&apos;ve been on both sides of the table.</h2>
          <p className="muted">
            The analysts who built the decks. The brand teams who received them. The engineer who automates
            the bridge between data and story.
          </p>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="See where it fits"
        title="Find the reporting workflow that looks most like your team."
        copy="If you want to know whether Basquio fits your world, the persona pages show the kinds of teams we are building for."
        secondaryLabel="Who it's for"
        secondaryHref="/for"
      />
      <PublicSiteFooter />
    </div>
  );
}
