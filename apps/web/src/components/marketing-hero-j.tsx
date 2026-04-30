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
        <p className="hero-j-eyebrow">Creato da analisti FMCG</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          Dai file sparsi a una presentazione pronta.
        </h1>
        <p className="hero-j-subhead">
          Basquio tiene insieme brief, dati, appunti, template e lavori passati. Quando sai cosa
          devi dire, prepara slide, report e file Excel.
        </p>

        <div className="hero-j-actions">
          <Link className="hero-j-primary" href="/jobs/new">
            Avvia un output
          </Link>
          <Link className="hero-j-secondary" href="#workspace">
            Vedi il workspace
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
