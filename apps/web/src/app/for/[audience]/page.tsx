import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { personas } from "@/app/site-content";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

type PersonaPageProps = {
  params: Promise<{
    audience: string;
  }>;
};

export function generateStaticParams() {
  return personas.map((persona) => ({ audience: persona.slug }));
}

export async function generateMetadata({ params }: PersonaPageProps): Promise<Metadata> {
  const { audience } = await params;
  const persona = personas.find((candidate) => candidate.slug === audience);

  if (!persona) {
    return {};
  }

  return {
    title: `${persona.title} | Basquio`,
    description: persona.summary,
  };
}

export default async function PersonaPage({ params }: PersonaPageProps) {
  const { audience } = await params;
  const persona = personas.find((candidate) => candidate.slug === audience);

  if (!persona) {
    notFound();
  }

  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">For {persona.title}</p>
              <h1>{persona.heroTitle}</h1>
              <p className="page-copy">{persona.heroCopy}</p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try with your data
              </Link>
              <Link className="button secondary" href={persona.secondaryHref}>
                {persona.secondaryLabel}
              </Link>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Best when</p>
            <ul className="clean-list">
              {persona.bestWhen.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="cards">
        <article className="panel persona-detail-card stack-lg">
          <div className="stack">
            <p className="section-label">Pressure point</p>
            <h2>{persona.pressureTitle}</h2>
            <p className="muted">{persona.pressureCopy}</p>
          </div>
        </article>

        <article className="panel persona-detail-card stack-lg">
          <div className="stack">
            <p className="section-label">Typical package</p>
            <h2>{persona.packageTitle}</h2>
            <p className="muted">{persona.packageCopy}</p>
          </div>
        </article>
      </section>

      <section className="cards">
        <article className="technical-panel stack-lg">
          <div className="stack">
            <p className="section-label light">Why it fits</p>
            <h2>{persona.valueTitle}</h2>
            <p className="muted">{persona.valueCopy}</p>
          </div>
        </article>

        <article className="panel persona-detail-card stack-lg">
          <div className="stack">
            <p className="section-label">Good match for</p>
            <h2>Common reporting moments</h2>
          </div>

          <ul className="clean-list">
            {persona.valuePoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow={`For ${persona.title}`}
        title={persona.ctaTitle}
        copy={persona.ctaCopy}
        primaryLabel="Try with your data"
        primaryHref="/jobs/new"
        secondaryLabel={persona.secondaryLabel}
        secondaryHref={persona.secondaryHref}
      />
      <PublicSiteFooter />
    </div>
  );
}
