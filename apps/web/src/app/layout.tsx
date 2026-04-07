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
    default: "Basquio — Turn Data into Finished Analysis Decks",
    template: "%s | Basquio",
  },
  description:
    "Upload CSV, Excel, or spreadsheet data and a brief. Get a finished analysis deck with real charts, a written report, an editable PowerPoint, and a data workbook. The only tool that does the analysis AND builds the presentation.",
  icons: {
    icon: "/brand/svg/favicon/basquio-favicon.svg",
    shortcut: "/brand/png/favicon/basquio-favicon-32.png",
    apple: "/brand/png/favicon/basquio-favicon-192.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Basquio",
    title: "Basquio — Turn Data into Finished Analysis Decks",
    description:
      "Upload CSV, Excel, or spreadsheet data and a brief. Get a finished analysis deck with real charts, a written report, and an editable PowerPoint.",
    images: [{ url: "/brand/png/logo/basquio-logo-dark-bg-4x.png", width: 1200, height: 630, alt: "Basquio" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@basquio",
    creator: "@basquio",
    title: "Basquio — Turn Data into Finished Analysis Decks",
    description:
      "Upload CSV, Excel, or spreadsheet data and a brief. Get a finished analysis deck with real charts, a written report, and an editable PowerPoint.",
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
        "Basquio turns raw CSV and Excel data into finished PowerPoint decks with real charts, written narrative analysis, and branded templates. Upload a spreadsheet, describe the analysis in two sentences, get a 10-15 slide presentation with methodology, findings, and recommendations.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://basquio.com/#software",
      name: "Basquio",
      url: "https://basquio.com",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Data Analysis & Presentation Generation",
      operatingSystem: "Web",
      offers: [
        {
          "@type": "Offer",
          name: "Starter",
          price: "19",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description: "30 credits/month. No branding. 2 template slots.",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: "149",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description: "200 credits/month. Priority queue. 5 templates.",
        },
        {
          "@type": "Offer",
          name: "Enterprise",
          price: "0",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description: "Custom workspace, billing, and template setup.",
        },
      ],
      featureList: [
        "Upload CSV, Excel, and XLSX data files",
        "Automated data analysis with real computed metrics",
        "Chart generation from actual data (matplotlib, PptxGenJS)",
        "Branded PPTX presentation output",
        "Narrative markdown report output",
        "Data workbook with traceable source references",
        "Brand template interpretation",
        "Zero-prompt operation",
        "Audience-aware narrative generation",
        "Syndicated and market research data support",
        "Category review deck automation",
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
