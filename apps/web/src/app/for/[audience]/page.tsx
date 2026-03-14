import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { personas } from "@/app/site-content";
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
              <h1>{persona.summary}</h1>
              <p className="page-copy">{persona.challenge}</p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Why it fits</p>
            <p>{persona.outcome}</p>
          </aside>
        </div>
      </section>

      <section className="cards">
        <article className="panel stack">
          <p className="section-label">Ideal use cases</p>
          <h2>Where the workflow compounds.</h2>
          <ul className="clean-list">
            {persona.bestFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="technical-panel stack">
          <p className="section-label light">What Basquio handles</p>
          <h2>Data, narrative, and deliverables stay aligned.</h2>
          <p className="muted">{persona.outcome}</p>
        </article>
      </section>

      <section className="panel stack">
        <p className="section-label">Next step</p>
        <h2>Try the workflow with your own reporting package.</h2>
        <div className="row">
          <Link className="button" href="/jobs/new">
            Try with your data
          </Link>
          <Link className="button secondary" href="/how-it-works">
            See the pipeline
          </Link>
        </div>
      </section>

      <PublicSiteFooterCta />
    </div>
  );
}
