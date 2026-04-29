import Link from "next/link";
import Image from "next/image";

export function MarketingHeroJ() {
  return (
    <section className="hero-j" aria-labelledby="hero-j-headline">
      <div className="hero-j-copy">
        <p className="hero-j-eyebrow">For market research teams</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          From scattered research files to a finished deck.
        </h1>
        <p className="hero-j-subhead">
          Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and
          Excel file your stakeholder asked for. The workspace remembers the client, brand, template,
          and last review.
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

      <div className="hero-j-stage">
        <figure className="hero-j-photo-card" aria-label="Basquio turns research material into finished work">
          <Image
            className="hero-j-photo"
            src="/marketing/basquio-hero-research-still-life-v1.jpg"
            alt=""
            aria-hidden="true"
            fill
            priority
            sizes="(max-width: 960px) 100vw, 54vw"
          />
          <figcaption className="hero-j-photo-caption">
            <span className="hero-j-photo-caption-kicker">One run</span>
            <span className="hero-j-photo-caption-title">Deck, report, and Excel workbook</span>
            <span className="hero-j-photo-caption-copy">
              The same work produces the presentation, the written readout, and the workbook behind it.
            </span>
          </figcaption>
          <ul className="hero-j-output-strip" aria-label="Outputs from the same run">
            <li>
              <span>Deck</span>
              <small>Editable slides</small>
            </li>
            <li>
              <span>Report</span>
              <small>Written narrative</small>
            </li>
            <li>
              <span>Excel</span>
              <small>Tables and charts</small>
            </li>
          </ul>
        </figure>
      </div>
    </section>
  );
}
