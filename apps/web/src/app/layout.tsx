import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Caveat, JetBrains_Mono, Manrope } from "next/font/google";
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

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://basquio.com"),
  title: {
    default: "Basquio · From research files to finished decks, reports, and workbooks",
    template: "%s | Basquio",
  },
  description:
    "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for. For recurring research work, the workspace remembers the client, brand, template, and past reviews. Built by FMCG and CPG analysts.",
  icons: {
    icon: "/brand/svg/favicon/basquio-favicon.svg",
    shortcut: "/brand/png/favicon/basquio-favicon-32.png",
    apple: "/brand/png/favicon/basquio-favicon-192.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Basquio",
    title: "Basquio · From research files to finished decks, reports, and workbooks",
    description:
      "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for. For recurring research work, the workspace remembers the client, brand, template, and past reviews.",
    images: [{ url: "/brand/png/logo/basquio-logo-dark-bg-4x.png", width: 1200, height: 630, alt: "Basquio" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@basquio",
    creator: "@basquio",
    title: "Basquio · From research files to finished decks, reports, and workbooks",
    description:
      "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for.",
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
        "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for. For recurring research work, the workspace remembers the client, brand, template, and past reviews. Built by FMCG and CPG analysts.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://basquio.com/#software",
      name: "Basquio",
      url: "https://basquio.com",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Decks, reports, and workbooks for market research teams",
      operatingSystem: "Web",
      offers: [
        {
          "@type": "Offer",
          name: "Pay as you go",
          price: "0",
          priceCurrency: "USD",
          description:
            "Estimated after upload. Buy a credit pack for one deck, report, or Excel file. No subscription.",
        },
        {
          "@type": "Offer",
          name: "Workspace Pro",
          price: "199",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description:
            "Private workspace for solo consultants and independent research professionals. 7-day card-required trial.",
        },
        {
          "@type": "Offer",
          name: "Team Workspace",
          price: "500",
          priceCurrency: "USD",
          billingIncrement: "P1M",
          description:
            "Shared workspace for teams preparing recurring research outputs. From 500 per month, multi-user, concierge onboarding.",
        },
      ],
      featureList: [
        "Workspace memory for clients, brands, stakeholders, templates, and prior reviews",
        "Brief, data, notes, and old decks stay together across recurring work",
        "Editable PowerPoint with charts, storyline, and recommendations",
        "Written report explaining what changed, why it matters, and what to do next",
        "Audit-ready Excel workbook with the tables behind every chart",
        "Brand template and brand-rule interpretation",
        "Built first for FMCG and CPG market research work",
      ],
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
      <body className={`${manrope.variable} ${jetbrainsMono.variable} ${caveat.variable}`}>
        <IntercomProvider>
          <div className="site-wrap">{children}</div>
        </IntercomProvider>
      </body>
    </html>
  );
}
