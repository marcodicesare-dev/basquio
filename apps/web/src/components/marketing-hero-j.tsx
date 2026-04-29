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
        <p className="hero-j-eyebrow">For market research teams</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          From scattered research files to a finished deck.
        </h1>
        <p className="hero-j-subhead">
          Basquio turns the brief, data, notes, and templates into the deck, report, and Excel file
          your stakeholder asked for.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/jobs/new">
            Start one output
          </Link>
          <Link className="hero-j-secondary" href="#workspace">
            See the workspace
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
