import type { Metadata, Viewport } from "next";
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
    default: "Basquio - Research Workspace for Finished Outputs",
    template: "%s | Basquio",
  },
  description:
    "Basquio keeps briefs, data, notes, templates, brand rules, stakeholder preferences, and past reviews together so research teams can prepare decks, reports, Excel files, charts, and evidence packages from the same workspace.",
  icons: {
    icon: "/brand/svg/favicon/basquio-favicon.svg",
    shortcut: "/brand/png/favicon/basquio-favicon-32.png",
    apple: "/brand/png/favicon/basquio-favicon-192.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Basquio",
    title: "Basquio - Research Workspace for Finished Outputs",
    description:
      "Keep research context together and prepare decks, reports, Excel files, charts, and evidence packages from one workspace.",
    images: [{ url: "/brand/png/logo/basquio-logo-dark-bg-4x.png", width: 1200, height: 630, alt: "Basquio" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@basquio",
    creator: "@basquio",
    title: "Basquio - Research Workspace for Finished Outputs",
    description:
      "Keep research context together and prepare decks, reports, Excel files, charts, and evidence packages from one workspace.",
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        "Basquio is a vertical workspace for market research teams. It keeps briefs, data, transcripts, notes, templates, brand rules, stakeholder preferences, past reviews, and approved formats together.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://basquio.com/#software",
      name: "Basquio",
      url: "https://basquio.com",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Market Research Workspace",
      operatingSystem: "Web",
      featureList: [
        "Brief, data, transcript, note, and template context",
        "Brand rules and approved output formats",
        "Stakeholder preferences and past review memory",
        "Deck, report, Excel file, chart, and evidence package preparation",
        "Source-backed research output workspace",
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
      <body className={`${manrope.variable} ${jetbrainsMono.variable}`}>
        <IntercomProvider>
          <div className="site-wrap">{children}</div>
        </IntercomProvider>
      </body>
    </html>
  );
}
