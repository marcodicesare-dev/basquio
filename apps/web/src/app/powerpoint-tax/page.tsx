import type { Metadata } from "next";

import { PowerPointTaxCalculator } from "@/app/powerpoint-tax/calculator";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

const faqs = [
  {
    question: "How is The PowerPoint Tax calculated?",
    answer:
      "The calculator takes decks per month, multiplies by 12, then by hours per deck. That gives annual hours. It then turns those hours into dollars using your hourly rate. The Basquio estimate assumes about 70% of deck time is the work of getting the deck built.",
  },
  {
    question: "What counts as a deck in this calculator?",
    answer:
      "Any recurring presentation built from data counts: category reviews, QBRs, client reports, board decks, competitive updates, or internal readouts.",
  },
  {
    question: "Is 12 hours per deck realistic?",
    answer:
      "Yes. Once you include pulling the numbers, building charts, formatting slides, and fixing review comments, 12 hours is a conservative number for a 15-slide deck.",
  },
  {
    question: "How does Basquio reduce the time?",
    answer:
      "Basquio reads the files, builds the charts, drafts the pages, and gives your team a first deck to review and edit.",
  },
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://basquio.com",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "The PowerPoint Tax",
          item: "https://basquio.com/powerpoint-tax",
        },
      ],
    },
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
      applicationSubCategory: "ROI Calculator",
      operatingSystem: "Web",
      description:
        "Calculate how many hours, dollars, and work weeks your team loses to manual deck production every year.",
      url: "https://basquio.com/powerpoint-tax",
      isAccessibleForFree: true,
      inLanguage: "en-US",
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
    "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year. The average analyst spends 580 hours a year on manual decks, or about 14 work weeks.",
  keywords: [
    "PowerPoint tax",
    "PowerPoint tax calculator",
    "manual deck production",
    "presentation time calculator",
    "analyst deck hours",
    "consulting deck time",
    "slide production cost",
  ],
  alternates: { canonical: "https://basquio.com/powerpoint-tax" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "The PowerPoint Tax — How Much Are You Losing to Manual Decks?",
    description:
      "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year. The average analyst gives up about 14 work weeks.",
    type: "website",
    url: "https://basquio.com/powerpoint-tax",
    images: [
      {
        url: "/powerpoint-tax/opengraph-image",
        width: 1200,
        height: 630,
        alt: "The PowerPoint Tax calculator by Basquio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "The PowerPoint Tax — How Much Are You Losing to Manual Decks?",
    description:
      "Calculate how many hours, weeks, and dollars your team loses to manual deck production every year. The average analyst gives up about 14 work weeks.",
    images: ["/powerpoint-tax/opengraph-image"],
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
            If the number feels high, lower the inputs. The point is to make the time visible, not to force a scary
            answer.
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
        eyebrow="Ready to stop doing this by hand"
        title="Bring the files. Start from a real draft."
        copy="Basquio turns the source files behind the next review into charts, pages, and a deck your team can edit."
        primaryLabel="Try Basquio free"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
