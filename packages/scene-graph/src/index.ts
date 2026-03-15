import { z } from "zod";

import type { DeckSpecV2Slide, TemplateProfile } from "@basquio/types";

// ─── UNIFIED SLIDE SCENE GRAPH ────────────────────────────────────
// A fixed-size coordinate-based representation that both PPTX and PDF
// renderers consume. This eliminates the 12-slide → 28-page divergence
// bug caused by the PDF renderer using free-flow HTML.
//
// Every slide is a fixed-size canvas (same dimensions as the template).
// Content is placed at absolute positions within that canvas.
// Both renderers read the same scene graph and produce matching output.

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
]);

export const textStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(), // points
  fontWeight: z.enum(["normal", "bold"]).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  color: z.string().optional(), // hex
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  lineHeight: z.number().optional(), // multiplier
});

export const frameSchema = z.object({
  x: z.number(), // inches from left
  y: z.number(), // inches from top
  w: z.number(), // width in inches
  h: z.number(), // height in inches
});

export const sceneNodeSchema: z.ZodType<SceneNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: sceneNodeKindSchema,
    frame: frameSchema,
    style: textStyleSchema.optional(),
    content: z.string().optional(),
    items: z.array(z.string()).optional(), // for bullet lists
    metrics: z.array(z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      tone: z.enum(["default", "positive", "caution", "neutral"]).optional(),
    })).optional(),
    chartId: z.string().optional(),
    imageUrl: z.string().optional(),
    shapeType: z.enum(["rectangle", "rounded_rectangle", "line", "circle"]).optional(),
    fill: z.string().optional(), // hex color
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
    children: z.array(z.lazy(() => sceneNodeSchema)).optional(),
  }),
);

export const slideSceneSchema = z.object({
  slideId: z.string(),
  position: z.number().int().positive(),
  width: z.number(), // inches
  height: z.number(), // inches
  background: z.string().optional(), // hex color
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
  children?: SceneNode[];
};
export type SlideScene = z.infer<typeof slideSceneSchema>;
export type DeckSceneGraph = z.infer<typeof deckSceneGraphSchema>;

// ─── LAYOUT ENGINE ────────────────────────────────────────────────
// Converts DeckSpecV2 slides into a positioned scene graph using
// template layout regions.

export function buildDeckSceneGraph(
  slides: DeckSpecV2Slide[],
  templateProfile: TemplateProfile,
  charts: Array<{ id: string; chartType: string; title: string }> = [],
): DeckSceneGraph {
  const slideWidth = templateProfile.slideWidthInches || 13.333;
  const slideHeight = templateProfile.slideHeightInches || 7.5;
  const tokens = templateProfile.brandTokens ?? defaultBrandTokens;

  const spacing = {
    pageX: tokens.spacing?.pageX ?? 0.6,
    pageY: tokens.spacing?.pageY ?? 0.5,
    sectionGap: tokens.spacing?.sectionGap ?? 0.32,
    blockGap: tokens.spacing?.blockGap ?? 0.2,
  };

  const typography = {
    headingFont: tokens.typography?.headingFont ?? "Aptos",
    bodyFont: tokens.typography?.bodyFont ?? "Aptos",
    titleSize: tokens.typography?.titleSize ?? 24,
    bodySize: tokens.typography?.bodySize ?? 12,
  };

  const palette: Record<string, string> = {
    text: tokens.palette?.text ?? "#0F172A",
    background: tokens.palette?.background ?? "#F8FAFC",
    surface: tokens.palette?.surface ?? "#FFFFFF",
    accent: tokens.palette?.accent ?? "#2563EB",
    accentMuted: tokens.palette?.accentMuted ?? "#DBEAFE",
    highlight: tokens.palette?.highlight ?? "#F0CC27",
    border: tokens.palette?.border ?? "#CBD5E1",
  };

  const slideScenes: SlideScene[] = slides.map((slide) => {
    const layout = templateProfile.layouts.find((l) => l.id === slide.layoutId)
      ?? templateProfile.layouts[0];

    const nodes = layoutSlideContent(slide, layout, {
      slideWidth,
      slideHeight,
      spacing,
      typography,
      palette,
    });

    return {
      slideId: slide.id,
      position: slide.position,
      width: slideWidth,
      height: slideHeight,
      background: palette.background,
      nodes,
      speakerNotes: slide.speakerNotes ?? undefined,
    };
  });

  return {
    slides: slideScenes,
    slideWidth,
    slideHeight,
    brandTokens: {
      palette,
      typography,
      spacing,
    },
  };
}

// ─── CONTENT LAYOUT ───────────────────────────────────────────────

type LayoutContext = {
  slideWidth: number;
  slideHeight: number;
  spacing: { pageX: number; pageY: number; sectionGap: number; blockGap: number };
  typography: { headingFont: string; bodyFont: string; titleSize: number; bodySize: number };
  palette: Record<string, string>;
};

type LayoutDef = TemplateProfile["layouts"][number];

function layoutSlideContent(
  slide: DeckSpecV2Slide,
  layout: LayoutDef,
  ctx: LayoutContext,
): SceneNode[] {
  const nodes: SceneNode[] = [];
  const { pageX, pageY, sectionGap, blockGap } = ctx.spacing;
  const contentWidth = ctx.slideWidth - 2 * pageX;
  let cursorY = pageY;
  let nodeIndex = 0;

  const makeId = () => `${slide.id}-node-${nodeIndex++}`;

  // Title
  if (slide.title) {
    const titleHeight = estimateTextHeight(slide.title, ctx.typography.titleSize, contentWidth);
    nodes.push({
      id: makeId(),
      kind: "title",
      frame: { x: pageX, y: cursorY, w: contentWidth, h: titleHeight },
      content: slide.title,
      style: {
        fontFamily: ctx.typography.headingFont,
        fontSize: ctx.typography.titleSize,
        fontWeight: "bold",
        color: ctx.palette.text,
        align: "left",
        valign: "top",
      },
    });
    cursorY += titleHeight + blockGap;
  }

  // Subtitle
  if (slide.subtitle) {
    const subHeight = estimateTextHeight(slide.subtitle, ctx.typography.bodySize + 2, contentWidth);
    nodes.push({
      id: makeId(),
      kind: "subtitle",
      frame: { x: pageX, y: cursorY, w: contentWidth, h: subHeight },
      content: slide.subtitle,
      style: {
        fontFamily: ctx.typography.bodyFont,
        fontSize: ctx.typography.bodySize + 2,
        color: ctx.palette.text,
        align: "left",
      },
    });
    cursorY += subHeight + blockGap;
  }

  // Metrics row
  if (slide.metrics && slide.metrics.length > 0) {
    const metricHeight = 1.0;
    const metricWidth = contentWidth / Math.min(slide.metrics.length, 4);

    nodes.push({
      id: makeId(),
      kind: "metric_card",
      frame: { x: pageX, y: cursorY, w: contentWidth, h: metricHeight },
      metrics: slide.metrics,
      style: {
        fontFamily: ctx.typography.headingFont,
        fontSize: ctx.typography.titleSize - 4,
        color: ctx.palette.accent,
      },
    });
    cursorY += metricHeight + sectionGap;
  }

  // Chart
  if (slide.chartId) {
    const chartHeight = Math.min(ctx.slideHeight - cursorY - pageY, 4.0);
    const chartWidth = slide.body ? contentWidth * 0.55 : contentWidth;

    nodes.push({
      id: makeId(),
      kind: "chart_placeholder",
      frame: {
        x: slide.body ? pageX + contentWidth * 0.45 + blockGap : pageX,
        y: cursorY,
        w: chartWidth,
        h: chartHeight,
      },
      chartId: slide.chartId,
    });

    // If there's both a chart and body, place body on the left
    if (slide.body) {
      const bodyWidth = contentWidth * 0.45 - blockGap;
      nodes.push({
        id: makeId(),
        kind: "body",
        frame: { x: pageX, y: cursorY, w: bodyWidth, h: chartHeight },
        content: slide.body,
        style: {
          fontFamily: ctx.typography.bodyFont,
          fontSize: ctx.typography.bodySize,
          color: ctx.palette.text,
          align: "left",
          valign: "top",
        },
      });
      cursorY += chartHeight + blockGap;
    } else {
      cursorY += chartHeight + blockGap;
    }
  } else {
    // Body (full width if no chart)
    if (slide.body) {
      const bodyHeight = estimateTextHeight(slide.body, ctx.typography.bodySize, contentWidth);
      nodes.push({
        id: makeId(),
        kind: "body",
        frame: { x: pageX, y: cursorY, w: contentWidth, h: bodyHeight },
        content: slide.body,
        style: {
          fontFamily: ctx.typography.bodyFont,
          fontSize: ctx.typography.bodySize,
          color: ctx.palette.text,
          align: "left",
          valign: "top",
        },
      });
      cursorY += bodyHeight + blockGap;
    }
  }

  // Bullet list
  if (slide.bullets && slide.bullets.length > 0) {
    const bulletHeight = slide.bullets.length * (ctx.typography.bodySize / 72 + 0.15);
    nodes.push({
      id: makeId(),
      kind: "bullet_list",
      frame: { x: pageX, y: cursorY, w: contentWidth, h: bulletHeight },
      items: slide.bullets,
      style: {
        fontFamily: ctx.typography.bodyFont,
        fontSize: ctx.typography.bodySize,
        color: ctx.palette.text,
        align: "left",
      },
    });
    cursorY += bulletHeight + blockGap;
  }

  return nodes;
}

// ─── HELPERS ──────────────────────────────────────────────────────

function estimateTextHeight(text: string, fontSizePt: number, widthInches: number): number {
  const charsPerInch = 72 / fontSizePt * 8; // rough estimate
  const charsPerLine = Math.floor(widthInches * charsPerInch);
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  const lineHeightInches = fontSizePt / 72 * 1.4;
  return Math.max(0.4, lines * lineHeightInches);
}

const defaultBrandTokens = {
  palette: {
    text: "#0F172A",
    background: "#F8FAFC",
    surface: "#FFFFFF",
    accent: "#2563EB",
    accentMuted: "#DBEAFE",
    highlight: "#F0CC27",
    border: "#CBD5E1",
  },
  typography: {
    headingFont: "Aptos",
    bodyFont: "Aptos",
    monoFont: "Aptos",
    titleSize: 24,
    bodySize: 12,
  },
  spacing: {
    pageX: 0.6,
    pageY: 0.5,
    sectionGap: 0.32,
    blockGap: 0.2,
    cardRadius: 0.12,
  },
  logo: {},
};
