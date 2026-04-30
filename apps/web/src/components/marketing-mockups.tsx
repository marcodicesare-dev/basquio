/**
 * Variant J · Path C
 * Approved Claude Design product mockups, rendered as static images.
 * Each PNG is exported from the Claude Design comp set on 2026-04-30 and
 * intentionally chosen over CSS-built fakes: the typography, hierarchy and
 * highlight treatments survive the rebuild better at this fidelity.
 * No CSS-built UI fakes here. See the PNG list below.
 *
 * All numbers reconcile across mockups (slide's 1.9 share points appears
 * in the report's first paragraph and in the workbook's Q4 share row).
 *
 * Source PNGs:
 *   public/marketing/screenshots/slide.png      850x490
 *   public/marketing/screenshots/workspace.png  920x520
 *   public/marketing/screenshots/report.png     367x520  (portrait)
 *   public/marketing/screenshots/workbook.png   834x515
 *   public/marketing/screenshots/security.png   924x506
 */

import Image from "next/image";

type MockupFrameProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  className: string;
  priority?: boolean;
};

function MockupFrame({
  src,
  alt,
  width,
  height,
  caption,
  className,
  priority = false,
}: MockupFrameProps) {
  return (
    <figure className={`mockup-frame ${className}`}>
      <Image
        className="mockup-frame-image"
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes="(min-width: 1280px) 640px, (min-width: 768px) 50vw, 100vw"
        priority={priority}
      />
      <figcaption className="mockup-frame-caption">{caption}</figcaption>
    </figure>
  );
}

export function ProductSlideMockup() {
  return (
    <MockupFrame
      src="/marketing/screenshots/slide.png"
      alt="Slide 04 of an Espresso Q4 review deck. Headline reads 'Private label takes 1.9 share points from branded espresso in Q4', with a quarterly share chart and a recommendation block."
      width={850}
      height={490}
      caption="deck.pptx · slide 04 of 12"
      className="mockup-frame-slide"
    />
  );
}

export function WorkspaceHomeMockup() {
  return (
    <MockupFrame
      src="/marketing/screenshots/workspace.png"
      alt="Basquio workspace home for Pellini Caffè. Six pinned facts (client, brand, template, last meeting, past reviews, approved formats) sit alongside a chat composer with a 'No training on customer data' note."
      width={920}
      height={520}
      caption="workspace · Pellini Caffè · 6 facts pinned"
      className="mockup-frame-workspace"
    />
  );
}

export function ReportExcerptMockup() {
  return (
    <MockupFrame
      src="/marketing/screenshots/report.png"
      alt="Narrative report excerpt with three sections: What changed, Why it matters, What we recommend. The 1.9 share-point shift is highlighted with an amber underline."
      width={367}
      height={520}
      caption="narrative_report.md · 2,400 words · 6 sections"
      className="mockup-frame-report"
    />
  );
}

export function WorkbookMockup() {
  return (
    <MockupFrame
      src="/marketing/screenshots/workbook.png"
      alt="data_tables.xlsx Share sheet. Row 4 'Private label' is highlighted in amber with +1.9 points and an embedded chart on the right; the footer notes 'reconciled to slide 04 · report §02'."
      width={834}
      height={515}
      caption="data_tables.xlsx · 4 sheets · auto-reconciled"
      className="mockup-frame-workbook"
    />
  );
}

export function SecurityAuditMockup() {
  return (
    <MockupFrame
      src="/marketing/screenshots/security.png"
      alt="Basquio admin security view. Five status badges (TLS 1.3, AES-256, tenant isolated, SOC 2 planned 2026 Q3, EU-West no replication), an audit log of 247 events with one MODEL.TRAIN row blocked at 11:14:22, and sub-processors panel."
      width={924}
      height={506}
      caption="admin · security · last 24 hours · 247 events"
      className="mockup-frame-security"
    />
  );
}
