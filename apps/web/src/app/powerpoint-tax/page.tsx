import type { Metadata } from "next";

import { PowerPointTaxCalculator } from "@/app/powerpoint-tax/calculator";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

const faqs = [
  {
    question: "How is The PowerPoint Tax calculated?",
    answer:
      "The calculator multiplies decks per month by 12, then scales by hours per deck and deck size. It converts that annual time into dollars using your hourly rate and estimates Basquio savings at 70% of the production burden.",
  },
  {
    question: "What counts as a deck in this calculator?",
    answer:
      "Any recurring data-driven presentation counts: category reviews, QBRs, client reports, board decks, competitive analyses, or internal performance readouts.",
  },
  {
    question: "Is 12 hours per deck realistic?",
    answer:
      "Yes. Consulting and insight teams routinely spend 8 to 30 hours building data-heavy presentations once prep, charting, formatting, and review cycles are included. The 12-hour default is conservative for a 15-slide review deck.",
  },
  {
    question: "How does Basquio reduce the time?",
    answer:
      "Basquio automates the production phase: it reads the source files, computes the metrics, generates charts, writes the first narrative draft, and applies the output structure. The team still owns the final judgment on what matters.",
  },
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
    {
      "@type": "WebApplication",
      name: "The PowerPoint Tax Calculator",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year.",
      url: "https://basquio.com/powerpoint-tax",
      publisher: {
        "@type": "Organization",
        name: "Basquio",
        url: "https://basquio.com",
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "The PowerPoint Tax — How Much Are You Losing to Manual Decks?",
  description:
    "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year. The average analyst spends 580 hours — that's 14 work weeks.",
  alternates: { canonical: "https://basquio.com/powerpoint-tax" },
  openGraph: {
    title: "The PowerPoint Tax — How Much Are You Losing to Manual Decks?",
    description:
      "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year.",
    type: "website",
    url: "https://basquio.com/powerpoint-tax",
  },
  twitter: {
    card: "summary_large_image",
    title: "The PowerPoint Tax — How Much Are You Losing to Manual Decks?",
    description:
      "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year.",
  },
};

export default async function PowerPointTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialQuery = {
    d: typeof params.d === "string" ? params.d : undefined,
    s: typeof params.s === "string" ? params.s : undefined,
    h: typeof params.h === "string" ? params.h : undefined,
    r: typeof params.r === "string" ? params.r : undefined,
  };

  return (
    <div className="page-shell public-page power-tax-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PublicSiteNav />
      <PowerPointTaxCalculator initialQuery={initialQuery} />

      <section className="technical-panel power-tax-faq-panel">
        <div className="stack">
          <p className="section-label light">FAQ</p>
          <h2>The skeptical questions are the right questions.</h2>
          <p className="muted">
            If the number feels high, change the inputs. The point is not to win with a heroic assumption. The point is
            to make the deck labor visible.
          </p>
        </div>

        <div className="faq-list">
          {faqs.map((faq) => (
            <details key={faq.question} className="faq-item">
              <summary>{faq.question}</summary>
              <p className="muted">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to redirect the time"
        title="Turn deck labor back into analysis."
        copy="Bring the spreadsheet package behind the next review. Basquio handles the production pass so the team can focus on what changed and why."
        primaryLabel="Try Basquio free"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
