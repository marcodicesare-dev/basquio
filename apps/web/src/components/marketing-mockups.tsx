/**
 * Variant J · Path J
 * Product mockups now use Claude-Design SVG vector files for the four static
 * artefacts (slide, workbook, report, security) so they scale infinitely
 * without raster blur. The workspace stays as the live MotionWorkspaceMockup
 * (cursor + typing + click + spinner + output reveal) because Marco was
 * explicit: SVG is for the low-res rasters, not the animations.
 *
 * Pellini and other real-prospect references in the workspace, report and
 * security SVGs were anonymized to Northstar Coffee, Aurora Espresso, Caffè
 * Belvedere, Mulini Vetta, Anna Ricci, marco@northstar.it, anna@example.it,
 * luca@example.com, client:Northstar.
 *
 * Numbers reconcile across all five mockups (the 1.9 share points on the
 * slide ties to workbook row 4 and report section 2).
 */

import { MotionMockupFrame } from "@/components/motion-mockup-frame";
import { MotionWorkspaceMockup } from "@/components/motion-workspace-mockup";

export { MotionWorkspaceMockup as WorkspaceHomeMockup };

type SvgMockupProps = {
  src: string;
  alt: string;
  className: string;
  priority?: boolean;
};

function SvgMockup({ src, alt, className, priority = false }: SvgMockupProps) {
  return (
    <MotionMockupFrame className={`mockup-frame ${className}`}>
      {/* Using a plain <img> rather than next/image because next/image
          treats SVG as a special case (requires dangerouslyAllowSVG) and
          we just want the vector to render at whatever CSS size we give
          the wrapper. SVG scales infinitely so there is no res penalty.
          Figcaption removed: the on-image label is part of the SVG; the
          extra "deck.pptx · slide 04 of 12" caption underneath read as
          AI slop. */}
      <img
        className="mockup-frame-image"
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
      />
    </MotionMockupFrame>
  );
}

export function ProductSlideMockup() {
  return (
    <SvgMockup
      src="/marketing/screenshots/slide.svg"
      alt="Slide 04 of an Espresso Q4 review deck. Headline reads 'Private label takes 1.9 share points from branded espresso in Q4', with a quarterly share chart and a recommendation block."
      className="mockup-frame-slide"
      priority
    />
  );
}

export function WorkbookMockup() {
  return (
    <SvgMockup
      src="/marketing/screenshots/workbook.svg"
      alt="data_tables.xlsx Share sheet. Row 4 'Private label' is highlighted in amber with +1.9 points and an embedded chart on the right; the footer notes 'reconciled to slide 04 · report §02'."
      className="mockup-frame-workbook"
    />
  );
}

export function ReportExcerptMockup() {
  return (
    <SvgMockup
      src="/marketing/screenshots/report.svg"
      alt="Narrative report excerpt with three sections: What changed, Why it matters, What we recommend. The 1.9 share-point shift is highlighted with bold body text."
      className="mockup-frame-report"
    />
  );
}

export function SecurityAuditMockup() {
  return (
    <SvgMockup
      src="/marketing/screenshots/security.svg"
      alt="Basquio admin security view. Five status badges (TLS 1.3, AES-256, tenant isolated, SOC 2 planned 2026 Q3, EU-West no replication), an audit log of 247 events with one MODEL.TRAIN row blocked at 11:14:22, and sub-processors panel."
      className="mockup-frame-security"
    />
  );
}
