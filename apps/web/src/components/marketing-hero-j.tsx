import Link from "next/link";
import Image from "next/image";

export function MarketingHeroJ() {
  return (
    <section className="hero-j hero-j-image-only" aria-labelledby="hero-j-headline">
      <Image
        className="hero-j-background"
        src="/marketing/hero-candidates/basquio-memory-context-06.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        quality={95}
        sizes="100vw"
      />
      <div className="hero-j-scrim" aria-hidden="true" />

      <div className="hero-j-copy">
        <p className="hero-j-eyebrow">AI per chi fa ricerca di mercato</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          Il tuo braccio destro per le analisi.
        </h1>
        <p className="hero-j-subhead">
          Due settimane di analisi, consegnate in poche ore. Carica brief, dati, appunti e
          template. Basquio scrive la presentazione, il report e il file Excel.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/jobs/new">
            Avvia un output
          </Link>
          <Link className="hero-j-secondary" href="#how-it-works">
            Scopri come funziona
          </Link>
        </div>

        <Link href="/security" className="hero-j-trust-link">
          <span className="hero-j-trust-dot" aria-hidden="true" />
          Sicurezza e gestione dei dati
        </Link>
      </div>
    </section>
  );
}
