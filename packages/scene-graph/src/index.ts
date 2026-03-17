import { z } from "zod";

import type { DeckSpecV2Slide, TemplateProfile } from "@basquio/types";
import { getLayoutRegions, SLIDE_W, SLIDE_H, type R } from "./layout-regions";

// ─── UNIFIED SLIDE SCENE GRAPH ────────────────────────────────────
// A fixed-size coordinate-based representation that both PPTX and PDF
// renderers consume. Uses the SAME layout regions as the PPTX renderer
// (from layout-regions.ts) to guarantee visual parity.

// ─── SCHEMA ───────────────────────────────────────────────────────

export const sceneNodeKindSchema = z.enum([
  "text",
  "title",
  "subtitle",
  "body",
  "bullet_list",
  "metric_card",
  "chart_placeholder",
  "image",
  "shape",
  "divider",
  "kicker",
  "callout",
  "table",
  "recommendation",
]);

export const textStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  lineHeight: z.number().optional(),
});

export const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const sceneNodeSchema: z.ZodType<SceneNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: sceneNodeKindSchema,
    frame: frameSchema,
    style: textStyleSchema.optional(),
    content: z.string().optional(),
    items: z.array(z.string()).optional(),
    metrics: z.array(z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      tone: z.enum(["default", "positive", "caution", "neutral"]).optional(),
    })).optional(),
    chartId: z.string().optional(),
    imageUrl: z.string().optional(),
    shapeType: z.enum(["rectangle", "rounded_rectangle", "line", "circle"]).optional(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
    calloutTone: z.enum(["accent", "green", "orange"]).optional(),
    tableData: z.object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }).optional(),
    recommendation: z.object({
      condition: z.string(),
      recommendation: z.string(),
      quantification: z.string(),
    }).optional(),
    children: z.array(z.lazy(() => sceneNodeSchema)).optional(),
  }),
);

export const slideSceneSchema = z.object({
  slideId: z.string(),
  position: z.number().int().positive(),
  width: z.number(),
  height: z.number(),
  background: z.string().optional(),
  nodes: z.array(sceneNodeSchema),
  speakerNotes: z.string().optional(),
});

export const deckSceneGraphSchema = z.object({
  slides: z.array(slideSceneSchema),
  slideWidth: z.number(),
  slideHeight: z.number(),
  brandTokens: z.object({
    palette: z.record(z.string(), z.string()),
    typography: z.object({
      headingFont: z.string(),
      bodyFont: z.string(),
      titleSize: z.number(),
      bodySize: z.number(),
    }),
    spacing: z.object({
      pageX: z.number(),
      pageY: z.number(),
      sectionGap: z.number(),
      blockGap: z.number(),
    }),
  }),
});

// ─── TYPES ────────────────────────────────────────────────────────

export type SceneNodeKind = z.infer<typeof sceneNodeKindSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type SceneNode = {
  id: string;
  kind: SceneNodeKind;
  frame: Frame;
  style?: TextStyle;
  content?: string;
  items?: string[];
  metrics?: Array<{
    label: string;
    value: string;
    delta?: string;
    tone?: "default" | "positive" | "caution" | "neutral";
  }>;
  chartId?: string;
  imageUrl?: string;
  shapeType?: "rectangle" | "rounded_rectangle" | "line" | "circle";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  calloutTone?: "accent" | "green" | "orange";
  tableData?: { headers: string[]; rows: string[][] };
  recommendation?: { condition: string; recommendation: string; quantification: string };
  children?: SceneNode[];
};
export type SlideScene = z.infer<typeof slideSceneSchema>;
export type DeckSceneGraph = z.infer<typeof deckSceneGraphSchema>;

// ─── LAYOUT ENGINE ────────────────────────────────────────────────
// Uses the SAME getLayoutRegions() as the PPTX renderer.
// Standardized on 10×5.625in (PPTX standard 16:9).

type LayoutContext = {
  typography: { headingFont: string; bodyFont: string; titleSize: number; bodySize: number };
  palette: Record<string, string>;
};

export function buildDeckSceneGraph(
  slides: DeckSpecV2Slide[],
  templateProfile: TemplateProfile,
  charts: Array<{ id: string; chartType: string; title: string }> = [],
): DeckSceneGraph {
  const tokens = templateProfile.brandTokens ?? defaultBrandTokens;

  const typography = {
    headingFont: tokens.typography?.headingFont ?? "Arial",
    bodyFont: tokens.typography?.bodyFont ?? "Arial",
    titleSize: tokens.typography?.titleSize ?? 24,
    bodySize: tokens.typography?.bodySize ?? 11,
  };

  const palette: Record<string, string> = {
    text: tokens.palette?.text ?? "#111827",
    background: tokens.palette?.background ?? "#FFFFFF",
    surface: tokens.palette?.surface ?? "#F8FAFC",
    accent: tokens.palette?.accent ?? "#0F4C81",
    accentMuted: tokens.palette?.accentMuted ?? "#DCEAF7",
    border: tokens.palette?.border ?? "#D1D5DB",
    calloutGreen: "#16A34A",
    calloutOrange: "#EA580C",
  };

  const ctx: LayoutContext = { typography, palette };

  const slideScenes: SlideScene[] = slides.map((slide) => {
    const nodes = layoutSlideContent(slide, ctx);
    return {
      slideId: slide.id,
      position: slide.position,
      width: SLIDE_W,
      height: SLIDE_H,
      background: palette.background,
      nodes,
      speakerNotes: slide.speakerNotes ?? undefined,
    };
  });

  return {
    slides: slideScenes,
    slideWidth: SLIDE_W,
    slideHeight: SLIDE_H,
    brandTokens: {
      palette,
      typography,
      spacing: { pageX: 0.45, pageY: 0.22, sectionGap: 0.12, blockGap: 0.1 },
    },
  };
}

// ─── LAYOUT-REGION-BASED CONTENT PLACEMENT ───────────────────────
// Mirrors the PPTX renderer's renderContentSlide() logic exactly.
// Each layout ID maps to fixed regions from getLayoutRegions().

function layoutSlideContent(
  slide: DeckSpecV2Slide,
  ctx: LayoutContext,
): SceneNode[] {
  const nodes: SceneNode[] = [];
  const layoutId = slide.layoutId ?? "title-body";
  const regions = getLayoutRegions(layoutId);
  const isCover = layoutId === "cover";
  let nodeIndex = 0;
  const makeId = () => `${slide.id}-node-${nodeIndex++}`;

  // Kicker (above title)
  if (slide.kicker && regions.title) {
    nodes.push({
      id: makeId(),
      kind: "kicker",
      frame: { x: regions.title.x, y: regions.title.y - 0.18, w: regions.title.w, h: 0.16 },
      content: slide.kicker.toUpperCase(),
      style: { fontFamily: ctx.typography.bodyFont, fontSize: 8.5, fontWeight: "bold", color: ctx.palette.accent, align: "left" },
    });
  }

  // Title (always)
  if (slide.title && regions.title) {
    nodes.push({
      id: makeId(),
      kind: "title",
      frame: regions.title,
      content: slide.title,
      style: {
        fontFamily: ctx.typography.headingFont,
        fontSize: isCover ? 32 : ctx.typography.titleSize,
        fontWeight: "bold",
        color: isCover ? "#FFFFFF" : ctx.palette.text,
        align: "left",
        valign: "top",
      },
    });
  }

  // Subtitle
  if (slide.subtitle && regions.subtitle) {
    nodes.push({
      id: makeId(),
      kind: "subtitle",
      frame: regions.subtitle,
      content: slide.subtitle,
      style: { fontFamily: ctx.typography.bodyFont, fontSize: 12, color: isCover ? "#FFFFFF" : ctx.palette.text, align: "left" },
    });
  }

  // Layout-specific content placement (mirrors render-v2.ts renderContentSlide)
  switch (layoutId) {
    case "cover":
      // Title + subtitle only, handled above
      break;

    case "title-chart": {
      if (slide.chartId && regions.chart) {
        nodes.push({ id: makeId(), kind: "chart_placeholder", frame: regions.chart, chartId: slide.chartId });
      }
      if (slide.callout && regions.callout) {
        pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
      }
      break;
    }

    case "chart-split":
    case "two-column": {
      // Metrics at top
      if (slide.metrics && slide.metrics.length > 0 && regions.metrics) {
        nodes.push({ id: makeId(), kind: "metric_card", frame: regions.metrics, metrics: slide.metrics,
          style: { fontFamily: ctx.typography.headingFont, fontSize: 28, color: ctx.palette.accent } });
      }
      // Chart on left
      if (slide.chartId && regions.chart) {
        nodes.push({ id: makeId(), kind: "chart_placeholder", frame: regions.chart, chartId: slide.chartId });
      }
      // Body on right
      if (slide.body && regions.body) {
        nodes.push({ id: makeId(), kind: "body", frame: regions.body, content: slide.body,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
      } else if (slide.bullets && slide.bullets.length > 0 && regions.body) {
        nodes.push({ id: makeId(), kind: "bullet_list", frame: regions.body, items: slide.bullets,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
      }
      // Callout
      if (regions.callout) {
        if (slide.callout) {
          pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
        }
      }
      break;
    }

    case "evidence-grid": {
      if (slide.metrics && slide.metrics.length > 0 && regions.metrics) {
        nodes.push({ id: makeId(), kind: "metric_card", frame: regions.metrics, metrics: slide.metrics,
          style: { fontFamily: ctx.typography.headingFont, fontSize: 28, color: ctx.palette.accent } });
      }
      if (slide.chartId && regions.chart) {
        nodes.push({ id: makeId(), kind: "chart_placeholder", frame: regions.chart, chartId: slide.chartId });
      }
      if (regions.body) {
        if (slide.bullets && slide.bullets.length > 0) {
          nodes.push({ id: makeId(), kind: "bullet_list", frame: regions.body, items: slide.bullets,
            style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
        } else if (slide.body) {
          nodes.push({ id: makeId(), kind: "body", frame: regions.body, content: slide.body,
            style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
        }
      }
      if (slide.callout && regions.callout) {
        pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
      }
      break;
    }

    case "metrics":
    case "exec-summary": {
      if (slide.metrics && slide.metrics.length > 0 && regions.metrics) {
        nodes.push({ id: makeId(), kind: "metric_card", frame: regions.metrics, metrics: slide.metrics,
          style: { fontFamily: ctx.typography.headingFont, fontSize: 28, color: ctx.palette.accent } });
      }
      if (slide.bullets && slide.bullets.length > 0 && regions.bullets) {
        nodes.push({ id: makeId(), kind: "bullet_list", frame: regions.bullets, items: slide.bullets,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
      } else if (slide.body && regions.body) {
        nodes.push({ id: makeId(), kind: "body", frame: regions.body, content: slide.body,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
      }
      if (slide.callout && regions.callout) {
        pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
      }
      break;
    }

    case "title-body":
    case "title-bullets": {
      if (slide.bullets && slide.bullets.length > 0 && regions.body) {
        nodes.push({ id: makeId(), kind: "bullet_list", frame: regions.body, items: slide.bullets,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
      }
      if (slide.body && regions.body) {
        // If bullets exist, offset body below them
        const bodyY = slide.bullets?.length ? regions.body.y + Math.min(slide.bullets.length * 0.3, 1.5) : regions.body.y;
        const bodyH = slide.bullets?.length ? regions.body.h - Math.min(slide.bullets.length * 0.3, 1.5) : regions.body.h;
        if (bodyH > 0.3) {
          nodes.push({ id: makeId(), kind: "body", frame: { ...regions.body, y: bodyY, h: bodyH }, content: slide.body,
            style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
        }
      }
      if (slide.callout && regions.callout) {
        pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
      }
      break;
    }

    case "table": {
      if (slide.chartId && regions.table) {
        nodes.push({ id: makeId(), kind: "chart_placeholder", frame: regions.table, chartId: slide.chartId });
      }
      break;
    }

    case "comparison": {
      if (slide.chartId && regions.chart) {
        nodes.push({ id: makeId(), kind: "chart_placeholder", frame: regions.chart, chartId: slide.chartId });
      }
      if (regions.chart2) {
        if (slide.bullets && slide.bullets.length > 0) {
          nodes.push({ id: makeId(), kind: "bullet_list", frame: regions.chart2, items: slide.bullets,
            style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
        } else if (slide.body) {
          nodes.push({ id: makeId(), kind: "body", frame: regions.chart2, content: slide.body,
            style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
        }
      }
      if (slide.callout && regions.callout) {
        pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
      }
      break;
    }

    case "summary": {
      if (slide.body && regions.body) {
        nodes.push({ id: makeId(), kind: "body", frame: regions.body, content: slide.body,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
      }
      if (slide.callout && regions.callout) {
        pushCallout(nodes, makeId(), slide.callout, regions.callout, ctx);
      }
      if (slide.bullets && slide.bullets.length > 0 && regions.bullets) {
        nodes.push({ id: makeId(), kind: "bullet_list", frame: regions.bullets, items: slide.bullets,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
      }
      break;
    }

    default: {
      // Fallback: chart or body
      if (slide.chartId) {
        const region = regions.chart ?? regions.body ?? { x: 0.45, y: 0.88, w: 9.1, h: 3.95 };
        nodes.push({ id: makeId(), kind: "chart_placeholder", frame: region, chartId: slide.chartId });
      } else if (slide.body && regions.body) {
        nodes.push({ id: makeId(), kind: "body", frame: regions.body, content: slide.body,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left", valign: "top" } });
      } else if (slide.bullets && slide.bullets.length > 0) {
        const region = regions.bullets ?? regions.body ?? { x: 0.45, y: 0.88, w: 9.1, h: 3.95 };
        nodes.push({ id: makeId(), kind: "bullet_list", frame: region, items: slide.bullets,
          style: { fontFamily: ctx.typography.bodyFont, fontSize: ctx.typography.bodySize, color: ctx.palette.text, align: "left" } });
      }
      break;
    }
  }

  return nodes;
}

// ─── CALLOUT HELPER ──────────────────────────────────────────────

function pushCallout(
  nodes: SceneNode[],
  id: string,
  callout: { text: string; tone?: "accent" | "green" | "orange" },
  region: R,
  ctx: LayoutContext,
) {
  const toneColors: Record<string, string> = {
    accent: ctx.palette.accent,
    green: ctx.palette.calloutGreen ?? "#16A34A",
    orange: ctx.palette.calloutOrange ?? "#EA580C",
  };
  nodes.push({
    id,
    kind: "callout",
    frame: region,
    content: callout.text,
    fill: toneColors[callout.tone ?? "accent"] ?? ctx.palette.accent,
    calloutTone: callout.tone ?? "accent",
    style: { fontFamily: ctx.typography.bodyFont, fontSize: 10, fontWeight: "bold", color: "#FFFFFF", align: "left" },
  });
}

// ─── SPATIAL AUDIT ───────────────────────────────────────────────
// Returns per-zone fill analysis for the author's preview feedback.

export type ZoneAudit = {
  kind: string;
  frame: Frame;
  areaSqIn: number;
  filled: boolean;
  fillDetail: string;
};

export type SlideAudit = {
  position: number;
  layout: string;
  zones: ZoneAudit[];
  filledZoneCount: number;
  totalZoneCount: number;
  verticalUsagePct: number;
  leftRightBalance: string; // e.g. "balanced", "left-heavy", "right-heavy"
  collisions: string[];
  hasOverflowRisk: boolean;
  overflowDetails: string[];
  warnings: string[];
};

export function auditSlideScene(
  slide: DeckSpecV2Slide,
): SlideAudit {
  const layoutId = slide.layoutId ?? "title-body";
  const regions = getLayoutRegions(layoutId);
  const isCover = layoutId === "cover";

  const zones: ZoneAudit[] = [];
  const overflowDetails: string[] = [];
  const warnings: string[] = [];

  // Check each region
  if (regions.title) {
    const titleWords = slide.title?.split(/\s+/).length ?? 0;
    zones.push({ kind: "title", frame: regions.title, areaSqIn: regions.title.w * regions.title.h, filled: titleWords > 0, fillDetail: `${titleWords} words` });
    if (titleWords > 20) overflowDetails.push(`Title ${titleWords} words (max ~16)`);
    if (!isCover && titleWords > 0 && !/\d/.test(slide.title)) warnings.push("Title has no number — not a data-driven action title");
  }

  if (regions.metrics) {
    const count = slide.metrics?.length ?? 0;
    zones.push({ kind: "metrics", frame: regions.metrics, areaSqIn: regions.metrics.w * regions.metrics.h, filled: count > 0, fillDetail: `${count} cards` });
    if (count > 0 && count < 3) warnings.push(`Only ${count} metric cards — 3-4 recommended`);
  }

  if (regions.chart) {
    const hasChart = Boolean(slide.chartId);
    zones.push({ kind: "chart", frame: regions.chart, areaSqIn: regions.chart.w * regions.chart.h, filled: hasChart, fillDetail: hasChart ? "chart present" : "EMPTY" });
    if (!hasChart && !isCover && layoutId !== "title-body" && layoutId !== "title-bullets" && layoutId !== "summary") {
      warnings.push("Chart region allocated but no chart — add a visualization or change layout");
    }
  }

  if (regions.body) {
    const bodyWords = slide.body?.split(/\s+/).length ?? 0;
    const hasBullets = (slide.bullets?.length ?? 0) > 0;
    const filled = bodyWords > 0 || hasBullets;
    zones.push({ kind: "body", frame: regions.body, areaSqIn: regions.body.w * regions.body.h, filled, fillDetail: bodyWords > 0 ? `${bodyWords} words` : hasBullets ? `${slide.bullets!.length} bullets` : "EMPTY" });
    if (bodyWords > 80) overflowDetails.push(`Body ${bodyWords} words (max 80)`);
    if ((slide.bullets?.length ?? 0) > 5) overflowDetails.push(`${slide.bullets!.length} bullets (max 5)`);
  }

  if (regions.callout) {
    const hasCallout = Boolean(slide.callout?.text);
    zones.push({ kind: "callout", frame: regions.callout, areaSqIn: regions.callout.w * regions.callout.h, filled: hasCallout, fillDetail: hasCallout ? `"${slide.callout!.text.slice(0, 40)}..."` : "EMPTY" });
    if (!hasCallout && !isCover) warnings.push("No callout — every content slide needs a 'so what' banner");
  }

  // Vertical usage: how much of the slide height is used
  const allFrames = zones.filter(z => z.filled).map(z => z.frame);
  const maxY = allFrames.length > 0 ? Math.max(...allFrames.map(f => f.y + f.h)) : 0;
  const verticalUsagePct = Math.round((maxY / SLIDE_H) * 100);

  // Collision detection: check for overlapping zones
  const collisions: string[] = [];
  const filledFrames = zones.filter(z => z.filled);
  for (let i = 0; i < filledFrames.length; i++) {
    for (let j = i + 1; j < filledFrames.length; j++) {
      const a = filledFrames[i].frame;
      const b = filledFrames[j].frame;
      // Check AABB overlap
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        collisions.push(`${filledFrames[i].kind} overlaps ${filledFrames[j].kind}`);
      }
    }
  }
  if (collisions.length > 0) {
    warnings.push(`Overlapping zones detected: ${collisions.join(", ")}`);
  }

  // Left/right balance: compare content weight on each side of the slide midpoint
  const midX = SLIDE_W / 2;
  let leftWeight = 0;
  let rightWeight = 0;
  for (const z of filledFrames) {
    const centerX = z.frame.x + z.frame.w / 2;
    const weight = z.frame.w * z.frame.h;
    if (centerX < midX) leftWeight += weight;
    else rightWeight += weight;
  }
  const totalWeight = leftWeight + rightWeight;
  let leftRightBalance = "balanced";
  if (totalWeight > 0) {
    const ratio = leftWeight / totalWeight;
    if (ratio > 0.7) leftRightBalance = "left-heavy";
    else if (ratio < 0.3) leftRightBalance = "right-heavy";
  }

  // Low vertical usage warning
  if (verticalUsagePct < 60 && !isCover) {
    warnings.push(`Only ${verticalUsagePct}% vertical usage — slide has too much empty space at bottom`);
  }

  const filledZoneCount = zones.filter(z => z.filled).length;

  return {
    position: slide.position,
    layout: layoutId,
    zones,
    filledZoneCount,
    totalZoneCount: zones.length,
    verticalUsagePct,
    leftRightBalance,
    collisions,
    hasOverflowRisk: overflowDetails.length > 0,
    overflowDetails,
    warnings,
  };
}

// ─── DEFAULTS ────────────────────────────────────────────────────

const defaultBrandTokens = {
  palette: {
    text: "#111827",
    background: "#FFFFFF",
    surface: "#F8FAFC",
    accent: "#0F4C81",
    accentMuted: "#DCEAF7",
    border: "#D1D5DB",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Arial",
    titleSize: 24,
    bodySize: 11,
  },
  spacing: {
    pageX: 0.45,
    pageY: 0.22,
    sectionGap: 0.12,
    blockGap: 0.1,
    cardRadius: 0.06,
  },
  logo: {},
};
