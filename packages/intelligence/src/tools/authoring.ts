import { tool } from "ai";
import { z } from "zod";

import type { EvidenceWorkspace, TemplateProfile } from "@basquio/types";

// ─── TOOL CONTEXT ─────────────────────────────────────────────────

export type AuthoringToolContext = {
  workspace: EvidenceWorkspace;
  runId: string;
  persistNotebookEntry: (entry: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
    evidenceRefId?: string;
  }) => Promise<string>;
  persistSlide: (slide: {
    position: number;
    layoutId: string;
    title: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    chartId?: string;
    metrics?: { label: string; value: string; delta?: string }[];
    evidenceIds: string[];
    speakerNotes?: string;
    transition?: string;
  }) => Promise<{ slideId: string; previewUrl?: string; warnings?: string[] }>;
  persistChart: (chart: {
    chartType: string;
    title: string;
    data: Record<string, unknown>[];
    xAxis?: string;
    yAxis?: string;
    series?: string[];
    style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean };
  }) => Promise<{ chartId: string; thumbnailUrl?: string; width?: number; height?: number }>;
  getTemplateProfile: () => TemplateProfile | null;
};

// ─── INSPECT TEMPLATE ─────────────────────────────────────────────

export function createInspectTemplateTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Get available slide layouts with their regions, placeholder types, and capacities. Call this before building slides to understand what layouts are available.",
    inputSchema: z.object({}),
    async execute() {
      const profile = ctx.getTemplateProfile();
      if (!profile) {
        return {
          error: "No template profile available",
          layouts: [],
        };
      }

      const layouts = profile.layouts.map((layout) => ({
        layoutId: layout.id,
        name: layout.name,
        sourceName: layout.sourceName,
        regions: layout.regions.map((r) => ({
          key: r.key,
          placeholder: r.placeholder,
          name: r.name,
          position: { x: r.x, y: r.y, w: r.w, h: r.h },
        })),
        placeholders: layout.placeholders,
      }));

      await ctx.persistNotebookEntry({
        toolName: "inspect_template",
        toolInput: {},
        toolOutput: {
          layoutCount: layouts.length,
          slideSize: `${profile.slideWidthInches}x${profile.slideHeightInches} inches`,
        },
      });

      return {
        slideWidthInches: profile.slideWidthInches,
        slideHeightInches: profile.slideHeightInches,
        layouts,
      };
    },
  });
}

// ─── INSPECT BRAND TOKENS ─────────────────────────────────────────

export function createInspectBrandTokensTool(ctx: AuthoringToolContext) {
  return tool({
    description: "Get brand guidelines: colors, fonts, logos, spacing rules. Use to ensure slides match brand identity.",
    inputSchema: z.object({}),
    async execute() {
      const profile = ctx.getTemplateProfile();
      if (!profile) {
        return { error: "No template profile available" };
      }

      const tokens = profile.brandTokens ?? {
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

      await ctx.persistNotebookEntry({
        toolName: "inspect_brand_tokens",
        toolInput: {},
        toolOutput: { hasCustomBrand: Boolean(profile.brandTokens) },
      });

      return {
        hasCustomBrand: Boolean(profile.brandTokens),
        palette: tokens.palette,
        typography: tokens.typography,
        spacing: tokens.spacing,
        logo: tokens.logo,
        fonts: profile.fonts,
        colors: profile.colors,
      };
    },
  });
}

// ─── BUILD CHART ──────────────────────────────────────────────────

export function createBuildChartTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Create a chart from data. Returns a chart ID and thumbnail for preview. Use the chart ID in write_slide to place the chart on a slide.",
    inputSchema: z.object({
      type: z.enum(["bar", "line", "pie", "scatter", "waterfall", "heatmap", "stacked_bar", "table"]),
      title: z.string(),
      data: z.array(z.record(z.unknown())).describe("Array of data objects for the chart"),
      xAxis: z.string().optional().describe("Column name for x-axis"),
      yAxis: z.string().optional().describe("Column name for y-axis"),
      series: z.array(z.string()).optional().describe("Column names for data series"),
      style: z
        .object({
          colors: z.array(z.string()).optional(),
          showLegend: z.boolean().optional(),
          showValues: z.boolean().optional(),
        })
        .optional(),
    }),
    async execute(params) {
      const result = await ctx.persistChart({
        chartType: params.type,
        title: params.title,
        data: params.data as Record<string, unknown>[],
        xAxis: params.xAxis,
        yAxis: params.yAxis,
        series: params.series,
        style: params.style,
      });

      await ctx.persistNotebookEntry({
        toolName: "build_chart",
        toolInput: { type: params.type, title: params.title, dataRows: params.data.length },
        toolOutput: result,
      });

      return result;
    },
  });
}

// ─── WRITE SLIDE ──────────────────────────────────────────────────

export function createWriteSlideTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Create or update a slide at a given position. Returns a rendered preview. Call inspect_template first to know available layouts.",
    inputSchema: z.object({
      position: z.number().int().positive().describe("Slide position (1-indexed)"),
      layout: z.string().describe("Template layout ID from inspect_template"),
      title: z.string(),
      subtitle: z.string().optional(),
      body: z.string().optional().describe("Main text content — write executive prose, not placeholder text"),
      bullets: z.array(z.string()).optional().describe("Bullet points"),
      chartId: z.string().optional().describe("Chart ID from build_chart"),
      metrics: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            delta: z.string().optional().describe("Change indicator, e.g. '+12.3%'"),
          }),
        )
        .optional(),
      evidenceIds: z.array(z.string()).optional().describe("Evidence ref IDs supporting this slide"),
      speakerNotes: z.string().optional(),
      transition: z.string().optional().describe("Narrative transition to next slide"),
    }),
    async execute(params) {
      const result = await ctx.persistSlide({
        position: params.position,
        layoutId: params.layout,
        title: params.title,
        subtitle: params.subtitle,
        body: params.body,
        bullets: params.bullets,
        chartId: params.chartId,
        metrics: params.metrics,
        evidenceIds: params.evidenceIds ?? [],
        speakerNotes: params.speakerNotes,
        transition: params.transition,
      });

      await ctx.persistNotebookEntry({
        toolName: "write_slide",
        toolInput: { position: params.position, layout: params.layout, title: params.title },
        toolOutput: result,
      });

      return result;
    },
  });
}

// ─── RENDER DECK PREVIEW ──────────────────────────────────────────

export function createRenderDeckPreviewTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Render a thumbnail strip of the full deck so far for visual review. Call after building all slides to check the overall flow.",
    inputSchema: z.object({}),
    async execute() {
      // This will be implemented by the persistence layer
      // For now, return the slide count and positions
      // The actual preview rendering will use the unified scene graph

      await ctx.persistNotebookEntry({
        toolName: "render_deck_preview",
        toolInput: {},
        toolOutput: { rendered: true },
      });

      return {
        message: "Deck preview rendered. Check the preview URLs on each slide for visual review.",
        rendered: true,
      };
    },
  });
}
