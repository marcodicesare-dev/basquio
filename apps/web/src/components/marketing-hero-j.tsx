import Link from "next/link";
import Image from "next/image";

export function MarketingHeroJ() {
  return (
    <section className="hero-j" aria-labelledby="hero-j-headline">
      <Image
        className="hero-j-background"
        src="/marketing/hero-candidates/basquio-memory-context-01.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
      />
      <div className="hero-j-scrim" aria-hidden="true" />

      <div className="hero-j-copy">
        <p className="hero-j-eyebrow">For FMCG and CPG research teams</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          A workspace for teams that ship research outputs every month.
        </h1>
        <p className="hero-j-subhead">
          Basquio remembers briefs, stakeholders, templates, and prior reviews so each new deck
          starts with the context already in place.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/about">
            Talk about a team pilot
          </Link>
          <Link className="hero-j-secondary" href="/jobs/new">
            Start one output
          </Link>
        </div>

        <Link href="/security" className="hero-j-trust-link">
          <span className="hero-j-trust-dot" aria-hidden="true" />
          Security and data handling
        </Link>
      </div>
    </section>
  );
}
