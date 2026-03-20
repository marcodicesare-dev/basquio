// ─── SHARED LAYOUT REGIONS ────────────────────────────────────────
// Single source of truth for slide content placement coordinates.
// All regions derived from a 12-column grid system on 13.333×7.5" widescreen.
// Consumed by both the PPTX renderer and the scene graph (PDF).
//
// Design system: agency-grade specs from .context/agency-grade-design-research.md
// Typography: Title 24pt, Body 14pt, KPI 44pt, Source 8pt
// Palette: "Slate" house template (default) — see render-v2.ts DEFAULT_TOKENS

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

// ─── 12-COLUMN GRID SYSTEM ──────────────────────────────────────
// Agency-grade grid: generous margins, consistent spacing, 8pt baseline.
// Coordinates from research: 0.6" L/R, 0.5" T, 0.4" B.

export const GRID = {
  // Outer margins
  marginL: 0.6,             // left margin
  marginR: 0.6,             // right margin
  marginTop: 0.5,           // top margin
  marginBottom: 0.4,        // bottom margin (above footer)

  // Grid dimensions
  columns: 12,
  gutter: 0.25,             // gutter between columns (8pt system)

  // Reserved zones
  headerRuleH: 0.0,         // no header rule — clean premium look
  footerZoneH: 0.3,         // footer (source note + page number)

  // Derived
  get contentW() { return SLIDE_W - this.marginL - this.marginR; },
  get contentH() { return SLIDE_H - this.marginTop - this.marginBottom - this.footerZoneH; },
  get colW() { return (this.contentW - (this.columns - 1) * this.gutter) / this.columns; },

  // Helpers: convert column spans to absolute coordinates
  colX(startCol: number): number { return this.marginL + (startCol - 1) * (this.colW + this.gutter); },
  colSpanW(nCols: number): number { return nCols * this.colW + (nCols - 1) * this.gutter; },
  contentY: 0.5,             // marginTop (no header rule)
  contentBottom: 7.5 - 0.4 - 0.3, // above footer = 6.8"
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
  // All coordinates for 13.333×7.5" widescreen slide.
  // Content area: 12.133" wide (0.6" L/R margins), starts at y=0.5".
  // Footer zone: y=6.8" (source notes + slide number).
  // Agency-grade specs from .context/agency-grade-design-research.md
  const cw = 12.133; // content width
  const ml = 0.6;    // margin left

  switch (layoutId) {
    case "cover":
      return {
        title: { x: ml + 0.5, y: 2.6, w: 9.0, h: 1.8 },
        subtitle: { x: ml + 0.5, y: 4.5, w: 8.0, h: 0.6 },
      };

    case "section-divider":
      return {
        title: { x: ml, y: 3.0, w: 10.0, h: 1.2 },
        subtitle: { x: ml, y: 4.4, w: 8.0, h: 0.6 },
      };

    case "exec-summary":
    case "metrics":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        metrics: { x: ml, y: 1.8, w: cw, h: 1.6 },
        chart: { x: ml, y: 3.6, w: 7.5, h: 2.8 },
        body: { x: ml, y: 3.6, w: 7.5, h: 2.4 },
        bullets: { x: ml, y: 3.6, w: 7.5, h: 2.4 },
        callout: { x: 8.4, y: 3.6, w: 4.333, h: 2.4 },
      };

    case "title-chart":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        chart: { x: ml, y: 1.75, w: cw, h: 4.55 },           // shrunk to avoid footer
        callout: { x: ml, y: 6.40, w: 6.0, h: 0.35 },        // moved up: bottom=6.75, safe from footer@7.1
      };

    case "chart-split":
    case "two-column":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        chart: { x: ml, y: 1.5, w: 6.8, h: 4.8 },            // slightly narrower for breathing room
        body: { x: 7.6, y: 1.5, w: 5.133, h: 3.5 },          // wider body (was 4.733), less dense
        table: { x: 7.6, y: 1.5, w: 5.133, h: 3.5 },         // table same region as body
        callout: { x: 7.6, y: 5.2, w: 5.133, h: 1.0 },       // moved up from 5.5
      };

    case "evidence-grid":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        metrics: { x: ml, y: 1.5, w: cw, h: 1.3 },
        chart: { x: ml, y: 3.0, w: 7.2, h: 3.2 },
        body: { x: 7.5, y: 3.0, w: 5.233, h: 2.0 },          // wider body
        callout: { x: 7.5, y: 5.2, w: 5.233, h: 0.9 },       // moved up
      };

    case "comparison":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        chart: { x: ml, y: 1.5, w: 5.817, h: 4.8 },          // slightly shorter
        chart2: { x: 6.717, y: 1.5, w: 5.817, h: 4.8 },
        callout: { x: ml, y: 6.40, w: 6.0, h: 0.35 },        // moved up from 6.7
      };

    case "title-body":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        body: { x: ml, y: 1.75, w: cw, h: 4.55 },            // shrunk: bottom=6.30
        callout: { x: ml, y: 6.40, w: cw, h: 0.35 },         // moved up: bottom=6.75
      };

    case "title-bullets":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        bullets: { x: ml, y: 1.75, w: cw, h: 4.55 },         // shrunk: bottom=6.30
        callout: { x: ml, y: 6.40, w: cw, h: 0.35 },         // moved up: bottom=6.75
      };

    case "table":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        table: { x: ml, y: 1.75, w: cw, h: 4.85 },
      };

    case "summary":
      return {
        kicker: { x: ml, y: 0.5, w: cw, h: 0.25 },
        title: { x: ml, y: 0.8, w: cw, h: 0.7 },
        body: { x: ml, y: 1.75, w: cw, h: 2.8 },
        bullets: { x: ml, y: 4.7, w: cw, h: 1.5 },
        callout: { x: ml, y: 6.30, w: cw, h: 0.40 },         // moved up: bottom=6.70
      };

    default:
      return {
        title: { x: ml, y: 0.5, w: cw, h: 0.7 },
        body: { x: ml, y: 1.5, w: cw, h: 5.1 },
      };
  }
}
