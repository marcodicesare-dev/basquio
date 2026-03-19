// ─── SHARED LAYOUT REGIONS ────────────────────────────────────────
// Single source of truth for slide content placement coordinates.
// All regions derived from a 12-column grid system.
// Consumed by both the PPTX renderer and the scene graph (PDF).

export const SLIDE_W = 10;
export const SLIDE_H = 5.625;

// ─── 12-COLUMN GRID SYSTEM ──────────────────────────────────────
// Consulting-grade grid: consistent margins, gutters, column widths.
// Both PPTX and PDF render from these exact coordinates.

export const GRID = {
  // Outer margins
  marginL: 0.55,           // left margin
  marginR: 0.55,           // right margin
  marginTop: 0.35,         // top margin (below header rule)
  marginBottom: 0.28,      // bottom margin (above footer)

  // Grid dimensions
  columns: 12,
  gutter: 0.12,            // gutter between columns

  // Reserved zones
  headerRuleH: 0.03,       // accent rule at top
  footerZoneH: 0.22,       // footer (source note + page number)

  // Derived
  get contentW() { return SLIDE_W - this.marginL - this.marginR; },
  get contentH() { return SLIDE_H - this.marginTop - this.marginBottom - this.headerRuleH - this.footerZoneH; },
  get colW() { return (this.contentW - (this.columns - 1) * this.gutter) / this.columns; },

  // Helpers: convert column spans to absolute coordinates
  colX(startCol: number): number { return this.marginL + (startCol - 1) * (this.colW + this.gutter); },
  colSpanW(nCols: number): number { return nCols * this.colW + (nCols - 1) * this.gutter; },
  contentY: 0.35 + 0.03, // marginTop + headerRule
  contentBottom: SLIDE_H - 0.28 - 0.22, // above footer
} as const;

export type R = { x: number; y: number; w: number; h: number };

export type LayoutRegions = {
  title: R;
  subtitle?: R;
  kicker?: R;
  body?: R;
  chart?: R;
  chart2?: R;
  table?: R;
  metrics?: R;
  callout?: R;
  bullets?: R;
};

/**
 * Get the layout regions for a given layout ID.
 * These coordinates are the canonical placement positions used by both
 * PPTX and PDF renderers. They match the slot archetype frames exactly.
 */
export function getLayoutRegions(layoutId: string): LayoutRegions {
  switch (layoutId) {
    case "cover":
      return {
        title: { x: 0.45, y: 1.6, w: 9.1, h: 1.6 },
        subtitle: { x: 0.45, y: 3.3, w: 9.1, h: 0.5 },
      };

    case "section-divider":
      return {
        title: { x: 0.45, y: 1.8, w: 9.1, h: 1.2 },
        subtitle: { x: 0.45, y: 3.1, w: 9.1, h: 0.6 },
      };

    case "exec-summary":
    case "metrics":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.52 },
        metrics: { x: 0.45, y: 0.95, w: 9.1, h: 1.3 },
        body: { x: 0.45, y: 2.35, w: 9.1, h: 1.65 },
        bullets: { x: 0.45, y: 2.35, w: 9.1, h: 1.65 },
        callout: { x: 0.45, y: 4.15, w: 9.1, h: 0.45 },
      };

    case "title-chart":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        chart: { x: 0.35, y: 0.92, w: 9.25, h: 3.5 },
        callout: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
      };

    case "chart-split":
    case "two-column":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        chart: { x: 0.35, y: 0.92, w: 5.75, h: 3.5 },
        body: { x: 6.25, y: 0.92, w: 3.2, h: 2.6 },
        callout: { x: 6.25, y: 3.65, w: 3.2, h: 0.46 },
      };

    case "evidence-grid":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        metrics: { x: 0.45, y: 0.92, w: 9.1, h: 0.85 },
        chart: { x: 0.35, y: 1.85, w: 5.75, h: 2.55 },
        body: { x: 6.25, y: 1.85, w: 3.2, h: 2.55 },
        callout: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
      };

    case "comparison":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        chart: { x: 0.35, y: 0.92, w: 4.55, h: 3.2 },
        chart2: { x: 5.05, y: 0.92, w: 4.55, h: 3.2 },
        callout: { x: 0.45, y: 4.25, w: 9.1, h: 0.42 },
      };

    case "title-body":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        body: { x: 0.45, y: 0.92, w: 9.1, h: 3.5 },
        callout: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
      };

    case "title-bullets":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        bullets: { x: 0.45, y: 0.92, w: 9.1, h: 3.5 },
        callout: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
      };

    case "table":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        table: { x: 0.35, y: 0.92, w: 9.25, h: 3.95 },
      };

    case "summary":
      return {
        kicker: { x: 0.45, y: 0.12, w: 9.1, h: 0.18 },
        title: { x: 0.45, y: 0.32, w: 9.1, h: 0.52 },
        body: { x: 0.45, y: 0.92, w: 9.1, h: 2.4 },
        bullets: { x: 0.45, y: 3.45, w: 9.1, h: 0.95 },
        callout: { x: 0.45, y: 4.5, w: 9.1, h: 0.42 },
      };

    default:
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        body: { x: 0.45, y: 0.88, w: 9.1, h: 3.95 },
      };
  }
}
