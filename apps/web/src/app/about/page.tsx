import type { Metadata } from "next";
import Image from "next/image";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "About Basquio — Built by Analysts and Brand Managers Who Lived the Problem",
  description:
    "Basquio was built by market research analysts and brand managers who spent years building category review decks manually. Now the workflow is automated.",
  alternates: { canonical: "https://basquio.com/about" },
};

const teamMembers = [
  { initials: "MD", name: "Marco", role: "CTO & Engineering", background: "Full-stack engineer. Built the pipeline that turns data files into finished decks." },
  { initials: "AD", name: "Alessandro", role: "Data & Analytics", background: "Market research analyst. Spent years building category review decks from syndicated data." },
  { initials: "RB", name: "Rossella", role: "Analytics & Insights", background: "Data analyst. Knows exactly what a leadership-ready category story looks like." },
  { initials: "FM", name: "Francesco", role: "Analytics & Strategy", background: "Research analyst. Built the evidence frameworks that underpin every deck." },
  { initials: "GC", name: "Giulia", role: "Brand Management", background: "Brand manager. The person who receives the deck and presents it in the room." },
  { initials: "VM", name: "Veronica", role: "Strategic Buying", background: "Category buyer. Knows what decisions the deck needs to support." },
] as const;

const experienceStats = [
  { number: "6", label: "co-founders" },
  { number: "40+", label: "years combined in market research & CPG" },
  { number: "500+", label: "category review decks built by hand" },
  { number: "1", label: "engineer who said 'never again'" },
] as const;

export default function AboutPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack-xl">
          <div className="stack">
            <p className="section-label">About</p>
            <h1>Built by the people who used to make these decks by hand.</h1>
            <p className="page-copy" style={{ maxWidth: "540px" }}>
              We know what a good category review looks like because we&apos;ve presented hundreds of them.
              Basquio exists because we got tired of spending 30 hours on production when the analysis took three.
            </p>
          </div>
        </div>
      </section>

      <section style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border)", background: "var(--canvas-2)" }}>
        <Image
          src="/illustrations/page-about.png"
          alt="Atmospheric illustration of a round table with six different chairs suggesting different disciplines, scattered data and reports on the surface, warm light through arched windows"
          width={1536}
          height={1024}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </section>

      <section>
        <div className="stack-xl">
          <div className="stack" style={{ textAlign: "center" }}>
            <p className="section-label" style={{ justifyContent: "center" }}>The team</p>
            <h2>Market research analysts, brand managers, and one engineer.</h2>
          </div>

          <div className="team-grid">
            {teamMembers.map((member) => (
              <article key={member.initials} className="team-card">
                <div className="team-avatar">{member.initials}</div>
                <h3>{member.name}</h3>
                <p style={{ fontWeight: 600, color: "var(--blue)", fontSize: "0.78rem", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{member.role}</p>
                <p>{member.background}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="experience-badges">
          {experienceStats.map((stat) => (
            <div key={stat.label} className="experience-badge">
              <span className="experience-badge-number">{stat.number}</span>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel dark-panel">
        <div className="stack" style={{ maxWidth: "640px" }}>
          <p className="section-label light">Why this team</p>
          <h2>We&apos;ve been on both sides of the table.</h2>
          <p className="muted">
            The analysts who built the decks. The brand teams who received them. The engineer who automates
            the bridge between data and story. We built Basquio because we lived the problem for years
            and knew exactly what the solution needed to do.
          </p>
        </div>
      </section>

      <section className="panel" style={{ textAlign: "center" }}>
        <div className="stack">
          <h2>The thesis</h2>
          <p style={{ maxWidth: "600px", margin: "0 auto", fontSize: "1.08rem", lineHeight: 1.7 }}>
            Every team that produces recurring data-driven decks follows the same seven steps.
            Steps 1-3 are analysis. Steps 4-7 are production. Production takes 3-5x longer than analysis.
            Basquio automates the production so your team can focus on the story.
          </p>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="See where it fits"
        title="Find the workflow that matches your team."
        secondaryLabel="Who it's for"
        secondaryHref="/for"
      />
      <PublicSiteFooter />
    </div>
  );
}
