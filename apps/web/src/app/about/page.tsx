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
    title: "CTO",
    background: "Full-stack engineer. Builds the entire system solo — AI pipeline, infrastructure, frontend, everything.",
    contact: "marco.dicesare@loamly.ai",
  },
  {
    name: "Francesco",
    title: "CFO",
    background: "NielsenIQ. Financial modeling, pricing strategy, and making sure the unit economics actually work.",
  },
  {
    name: "Rossella",
    title: "CPO",
    background: "NielsenIQ. Product manager and the team's #1 dogfooder — if the output wouldn't pass her review, it ships again.",
  },
  {
    name: "Alessandro",
    title: "CRO",
    background: "NielsenIQ. Enterprise sales. Knows what it takes to get a CPG category team to trust a new tool.",
  },
  {
    name: "Veronica",
    title: "Head of Product Intelligence",
    background: "Victorinox. Brings the buyer side — what brand teams actually need from a category review deck.",
  },
  {
    name: "Giulia",
    title: "CMO",
    background: "Mondelez. Brand strategy, growth marketing, and making sure Basquio speaks the language CPG teams already use.",
  },
] as const;

export default function AboutPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      {/* ── Hero: the founding story ── */}
      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">About</p>
              <h1>
                We spent years building category review decks by hand. Now we
                are building the tool we wish we had.
              </h1>
              <p className="page-copy">
                Three of us come from NielsenIQ — the world&apos;s largest
                market research firm. We lived the reporting cycle: pull
                syndicated data, build the deck, recheck the numbers, rewrite
                the narrative, restyle everything for brand guidelines, present,
                repeat. Every quarter. For years.
              </p>
              <p className="page-copy">
                One of us managed brands at Mondelez, a Fortune 500 CPG
                company. One was a buyer at Victorinox, a Swiss CPG brand. We
                all sat on different sides of the same table, and we all knew
                the deck was the bottleneck.
              </p>
              <p className="page-copy">
                Basquio exists because we got tired of the gap between having
                the analysis and having a deck people can actually use. The
                CTO builds the entire system. The rest of the team knows
                exactly what right looks like — because we were the ones
                presenting those decks.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">The short version</p>
            <h2>3 NielsenIQ analysts + 1 Mondelez brand manager + 1 Victorinox buyer + 1 CTO</h2>
            <p className="muted">
              Domain experts building AI tools for the work they already know
              how to do — not engineers guessing at a domain from the outside.
            </p>
          </aside>
        </div>
      </section>

      {/* ── The team ── */}
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

      {/* ── Principles ── */}
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

      {/* ── Why this team ── */}
      <section className="panel dark-panel stack-lg">
        <div className="stack">
          <p className="section-label light">Why this team</p>
          <h2>
            Domain experts building AI tools is fundamentally different from
            engineers building AI tools for domains they don&apos;t understand.
          </h2>
        </div>
        <div className="stack">
          <p className="muted">
            Most AI tools for business reporting are built by engineers who have
            never sat in a category review. They optimize for speed, not for
            whether a category director would actually trust the output. They
            demo well and fall apart in the meeting.
          </p>
          <p className="muted">
            Our team has collectively spent decades on both sides of the table —
            the analysts building the decks and the brand teams receiving them.
            We know what a good category review looks like because we have
            presented hundreds of them. We know what makes a buyer trust a
            chart because we have been the buyer.
          </p>
          <p className="muted">
            The CTO builds the system. Everyone else makes sure it would
            actually survive a real review meeting. That feedback loop — build,
            dogfood, tear apart, rebuild — is why Basquio works differently
            from tools built by people who have never had to defend a number
            in front of a retailer.
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
