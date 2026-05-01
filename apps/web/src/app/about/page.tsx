import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollReveal } from "@/components/scroll-reveal";

export const metadata: Metadata = {
  title: "About Basquio · The team behind it",
  description:
    "Basquio was built by analysts and brand managers who spent years writing FMCG and CPG category review decks by hand. The workspace they wanted to use is the workspace they built.",
  alternates: { canonical: "https://basquio.com/about" },
};

const TEAM_MEMBERS = [
  {
    initials: "MD",
    name: "Marco Di Cesare",
    role: "ex-NielsenIQ · research, insight, marketing, trade",
    background:
      "Spent years inside FMCG and CPG market research before building the pipeline that turns brief, data, notes and template into the deck, report and Excel file.",
  },
  {
    initials: "FP",
    name: "Francesco Procaccio",
    role: "Senior Consultant, NielsenIQ",
    background:
      "Senior consultant at NielsenIQ. The analyst who lives the brief, data, template and deadline cycle every week. Shapes the analyst experience inside Basquio.",
  },
  {
    initials: "NIQ",
    name: "The team",
    role: "ex-FMCG and CPG analysts",
    background:
      "A small team of analysts and brand contributors who used to ship category review decks by hand. They review every output, brand rule, and template profile that ships in Basquio.",
  },
] as const;

const EXPERIENCE_STATS = [
  { number: "20+", label: "years combined in FMCG and CPG market research" },
  { number: "500+", label: "category review decks built by hand by this team" },
  { number: "1", label: "engineer who said never again" },
] as const;

export default function AboutPage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <section className="section-j section-j-page-hero" aria-labelledby="about-page-heading">
        <ScrollReveal className="section-j-page-hero-inner">
          <p className="section-j-eyebrow">About</p>
          <h1 id="about-page-heading" className="section-j-page-title">
            Built by FMCG and CPG analysts who lived this work.
          </h1>
          <p className="section-j-body">
            Basquio comes from engineering, brand, category and market research work inside FMCG
            and CPG companies. We know what a category review looks like because we have presented
            hundreds of them.
          </p>
        </ScrollReveal>
      </section>

      <section className="section-j section-j-team" aria-labelledby="team-heading">
        <ScrollReveal className="section-j-team-head">
          <p className="section-j-eyebrow">The team</p>
          <h2 id="team-heading" className="section-j-title">
            A small team that used to make these decks by hand.
          </h2>
        </ScrollReveal>

        <ScrollReveal className="section-j-team-grid" delay={120}>
          {TEAM_MEMBERS.map((member) => (
            <article key={member.initials} className="team-card-j">
              <div className="team-card-j-avatar" aria-hidden="true">
                {member.initials}
              </div>
              <h3 className="team-card-j-name">{member.name}</h3>
              <p className="team-card-j-role">{member.role}</p>
              <p className="team-card-j-background">{member.background}</p>
            </article>
          ))}
        </ScrollReveal>
      </section>

      <section className="section-j section-j-experience" aria-labelledby="experience-heading">
        <ScrollReveal className="section-j-experience-inner">
          <h2 id="experience-heading" className="section-j-experience-heading sr-only">
            Combined experience
          </h2>
          <ul className="section-j-experience-row" role="list">
            {EXPERIENCE_STATS.map((stat) => (
              <li key={stat.label} className="section-j-experience-cell">
                <span className="section-j-experience-number">{stat.number}</span>
                <span className="section-j-experience-label">{stat.label}</span>
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-stage section-j-stage-dark"
        aria-labelledby="thesis-heading"
      >
        <ScrollReveal className="section-j-stage-inner section-j-stage-inner-narrow">
          <p className="section-j-eyebrow section-j-eyebrow-light">The thesis</p>
          <h2 id="thesis-heading" className="section-j-title section-j-title-light">
            Recurring research follows the same seven steps. Production takes longer than analysis.
          </h2>
          <p className="section-j-body section-j-body-light">
            Steps 1-3 are analysis. Steps 4-7 are production: pulling charts, writing slides,
            checking numbers, branding the deck, drafting the report, building the workbook.
            Basquio takes steps 4-7 so the team can stay in steps 1-3.
          </p>
        </ScrollReveal>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Start with one output. Or set up the workspace."
        copy="Upload the brief and files for one job. If the work comes back next month, keep the context in a workspace."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See the workspace"
        secondaryHref="/#workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
