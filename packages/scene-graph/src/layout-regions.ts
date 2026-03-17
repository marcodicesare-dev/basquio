// ─── SHARED LAYOUT REGIONS ────────────────────────────────────────
// Single source of truth for slide content placement coordinates.
// Consumed by both the PPTX renderer (PptxGenJS) and the scene graph
// (which drives PDF rendering). Guarantees visual parity.

export const SLIDE_W = 10;
export const SLIDE_H = 5.625;

export type R = { x: number; y: number; w: number; h: number };

export type LayoutRegions = {
  title: R;
  subtitle?: R;
  body?: R;
  chart?: R;
  chart2?: R;
  table?: R;
  metrics?: R;
  callout?: R;
  bullets?: R;
};

export function getLayoutRegions(layoutId: string): LayoutRegions {
  switch (layoutId) {
    case "cover":
      return {
        title: { x: 0.45, y: 1.6, w: 9.1, h: 1.6 },
        subtitle: { x: 0.45, y: 3.1, w: 9.1, h: 0.7 },
      };
    case "title-body":
    case "title-bullets":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        body: { x: 0.45, y: 0.88, w: 9.1, h: 3.95 },
        callout: { x: 0.45, y: 4.85, w: 9.1, h: 0.28 },
      };
    case "title-chart":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        chart: { x: 0.35, y: 0.88, w: 9.25, h: 3.95 },
        callout: { x: 0.45, y: 4.85, w: 9.1, h: 0.28 },
      };
    case "chart-split":
    case "two-column":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        metrics: { x: 0.45, y: 0.82, w: 9.1, h: 0.85 },
        chart: { x: 0.35, y: 1.72, w: 5.75, h: 2.75 },
        table: { x: 6.2, y: 1.72, w: 3.2, h: 1.5 },
        body: { x: 6.2, y: 3.32, w: 3.2, h: 1.1 },
        callout: { x: 6.2, y: 4.5, w: 3.2, h: 0.46 },
      };
    case "evidence-grid":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        metrics: { x: 0.45, y: 0.82, w: 9.1, h: 0.85 },
        chart: { x: 0.35, y: 1.72, w: 5.75, h: 2.75 },
        body: { x: 6.2, y: 1.72, w: 3.2, h: 2.75 },
        callout: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
      };
    case "metrics":
    case "exec-summary":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        metrics: { x: 0.45, y: 0.88, w: 9.1, h: 1.35 },
        body: { x: 0.45, y: 2.35, w: 9.1, h: 1.65 },
        bullets: { x: 0.45, y: 2.35, w: 9.1, h: 1.65 },
        callout: { x: 0.45, y: 4.15, w: 9.1, h: 0.48 },
      };
    case "comparison":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        chart: { x: 0.35, y: 0.88, w: 4.6, h: 3.6 },
        chart2: { x: 5.05, y: 0.88, w: 4.5, h: 3.6 },
        callout: { x: 0.45, y: 4.55, w: 9.1, h: 0.42 },
      };
    case "table":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        table: { x: 0.35, y: 0.88, w: 9.25, h: 3.95 },
      };
    case "summary":
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        body: { x: 0.45, y: 0.88, w: 9.1, h: 2.6 },
        callout: { x: 0.45, y: 3.6, w: 9.1, h: 0.65 },
        bullets: { x: 0.45, y: 4.35, w: 9.1, h: 0.6 },
      };
    default:
      return {
        title: { x: 0.45, y: 0.22, w: 9.1, h: 0.56 },
        body: { x: 0.45, y: 0.88, w: 9.1, h: 3.95 },
      };
  }
}
