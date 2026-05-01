import Link from "next/link";
import Image from "next/image";

export function MarketingHeroJ() {
  return (
    <section className="hero-j hero-j-image-only" aria-labelledby="hero-j-headline">
      <Image
        className="hero-j-background"
        src="/marketing/hero-candidates/basquio-memory-context-01.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        quality={95}
        sizes="100vw"
      />
      <div className="hero-j-scrim" aria-hidden="true" />

      <div className="hero-j-copy">
        <p className="hero-j-eyebrow">AI for market research professionals</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          Your right arm for analysis.
        </h1>
        <p className="hero-j-subhead">
          Two weeks of analysis, delivered in hours. Drop the brief, the data, the notes, and the
          brand template. Basquio writes the deck, the narrative report, and the Excel workbook.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/jobs/new">
            Start one output
          </Link>
          <Link className="hero-j-secondary" href="#how-it-works">
            See how it works
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
