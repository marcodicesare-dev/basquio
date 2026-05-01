import Link from "next/link";
import Image from "next/image";

import { HeroDemoFlow } from "@/components/hero-demo-flow";

export function MarketingHeroJ() {
  return (
    <section className="hero-j hero-j-with-demo" aria-labelledby="hero-j-headline">
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
        <p className="hero-j-eyebrow">Created by FMCG analysts</p>
        <h1 id="hero-j-headline" className="hero-j-headline">
          From scattered research files to a finished deck.
        </h1>
        <p className="hero-j-subhead">
          Basquio keeps the brief, data, notes, templates and past work together. When you know
          what needs to be said, it builds the slides, report and Excel file.
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

      <div className="hero-j-demo-stage">
        <HeroDemoFlow />
      </div>
    </section>
  );
}
