import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Manrope } from "next/font/google";
import Script from "next/script";

import { IntercomProvider } from "@/components/intercom/intercom-provider";

import "./global.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://basquio.com"),
  title: {
    default: "Basquio - Research Material to Finished Files",
    template: "%s | Basquio",
  },
  description:
    "Basquio keeps briefs, data, notes, templates, and past research work together, then turns a clear research direction into a deck, report, Excel workbook, charts, and review material.",
  icons: {
    icon: "/brand/svg/favicon/basquio-favicon.svg",
    shortcut: "/brand/png/favicon/basquio-favicon-32.png",
    apple: "/brand/png/favicon/basquio-favicon-192.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Basquio",
    title: "Basquio - Research Material to Finished Files",
    description:
      "Keep research material together and turn the next ask into a finished deck, report, and Excel file.",
    images: [{ url: "/brand/png/logo/basquio-logo-dark-bg-4x.png", width: 1200, height: 630, alt: "Basquio" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@basquio",
    creator: "@basquio",
    title: "Basquio - Research Material to Finished Files",
    description:
      "Keep research material together and turn the next ask into a finished deck, report, and Excel file.",
    images: ["/brand/png/logo/basquio-logo-dark-bg-4x.png"],
  },
  alternates: {
    canonical: "https://basquio.com",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://basquio.com/#organization",
      name: "Basquio",
      url: "https://basquio.com",
      logo: {
        "@type": "ImageObject",
        url: "https://basquio.com/brand/png/logo/basquio-logo-dark-bg-4x.png",
      },
      sameAs: [
        "https://twitter.com/basquio",
        "https://www.linkedin.com/company/basquio",
      ],
      description:
        "Basquio keeps research briefs, data, notes, templates, and past work together, then turns a clear research direction into decks, reports, Excel workbooks, charts, and review material.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://basquio.com/#software",
      name: "Basquio",
      url: "https://basquio.com",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Market Research Workspace",
      operatingSystem: "Web",
      offers: [
        {
          "@type": "Offer",
          name: "Pay as you go",
          price: "0",
          priceCurrency: "USD",
          description: "Estimate one output and buy credits per run.",
        },
        {
          "@type": "Offer",
          name: "Workspace Pro",
          price: "199",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description: "One-user workspace with recurring context.",
        },
        {
          "@type": "Offer",
          name: "Team Workspace",
          price: "500",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description: "Shared projects, roles, reviews, onboarding, and pilot support.",
        },
      ],
      featureList: [
        "Brief, data, notes, template, and past work kept together",
        "Finished deck output",
        "Narrative report output",
        "Excel workbook output",
        "Chart generation from source data",
        "Brand template support",
        "Review material for recurring research work",
      ],
      screenshot: "https://basquio.com/showcase/slide-showcase-chart.svg",
      creator: { "@id": "https://basquio.com/#organization" },
    },
    {
      "@type": "WebSite",
      "@id": "https://basquio.com/#website",
      url: "https://basquio.com",
      name: "Basquio",
      publisher: { "@id": "https://basquio.com/#organization" },
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://app.loamly.ai/t.js?d=basquio.com"
          strategy="afterInteractive"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${manrope.variable} ${jetbrainsMono.variable}`}>
        <IntercomProvider>
          <div className="site-wrap">{children}</div>
        </IntercomProvider>
      </body>
    </html>
  );
}
