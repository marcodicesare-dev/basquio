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
  getSlides?: () => Promise<Array<{
    id: string;
    position: number;
    layoutId: string;
    title: string;
    chartId?: string;
    body?: string;
    bullets?: string[];
    metrics?: unknown[];
    speakerNotes?: string;
  }>>;
};

// ─── DENSITY VALIDATION ───────────────────────────────────────────

type DensityViolation = { field: string; rule: string };

function validateSlideDensity(params: {
  layout: string;
  title: string;
  body?: string;
  bullets?: string[];
  chartId?: string;
  metrics?: unknown[];
  speakerNotes?: string;
  evidenceIds?: string[];
}): DensityViolation[] {
  const violations: DensityViolation[] = [];
  const layout = params.layout;

  // Universal rules
  if (!params.title || params.title.split(/\s+/).length < 4) {
    violations.push({ field: "title", rule: "Title must be a sentence with at least 4 words (action title)" });
  }
  if (layout !== "cover" && !params.speakerNotes) {
    violations.push({ field: "speakerNotes", rule: "Speaker notes are required for all non-cover slides" });
  }
  if (layout !== "cover" && (!params.evidenceIds || params.evidenceIds.length === 0)) {
    violations.push({ field: "evidenceIds", rule: "At least one evidence ID is required for non-cover slides" });
  }

  // Layout-specific density requirements
  switch (layout) {
    case "cover":
      // No density requirement beyond title
      break;

    case "exec-summary":
    case "metrics":
      if (!params.metrics || params.metrics.length < 3) {
        violations.push({ field: "metrics", rule: `${layout} requires at least 3 metric cards` });
      }
      if (!params.body && (!params.bullets || params.bullets.length === 0)) {
        violations.push({ field: "body", rule: `${layout} requires body text or bullets alongside metrics` });
      }
      break;

    case "title-chart":
      if (!params.chartId) {
        violations.push({ field: "chartId", rule: "title-chart layout requires a chart" });
      }
      break;

    case "chart-split":
    case "two-column":
      if (!params.chartId) {
        violations.push({ field: "chartId", rule: `${layout} layout requires a chart (left side)` });
      }
      // chart-split should have at least body OR bullets on the right
      if (!params.body && (!params.bullets || params.bullets.length === 0)) {
        violations.push({ field: "body", rule: `${layout} requires body text or bullets for the right column` });
      }
      break;

    case "evidence-grid":
      // Dense slide — needs at least 2 of: chart, metrics, body/bullets
      {
        let contentSources = 0;
        if (params.chartId) contentSources++;
        if (params.metrics && params.metrics.length > 0) contentSources++;
        if (params.body || (params.bullets && params.bullets.length > 0)) contentSources++;
        if (contentSources < 2) {
          violations.push({ field: "content", rule: "evidence-grid requires at least 2 of: chart, metrics, body/bullets" });
        }
      }
      break;

    case "title-body":
      if (!params.body || params.body.split(/\s+/).length < 15) {
        violations.push({ field: "body", rule: "title-body requires at least 15 words of body text" });
      }
      break;

    case "title-bullets":
      if (!params.bullets || params.bullets.length < 2) {
        violations.push({ field: "bullets", rule: "title-bullets requires at least 2 bullets" });
      }
      break;

    case "table":
      if (!params.chartId) {
        violations.push({ field: "chartId", rule: "table layout requires a chart/table ID (use build_chart with type 'table')" });
      }
      break;

    case "summary":
      if (!params.body || params.body.split(/\s+/).length < 20) {
        violations.push({ field: "body", rule: "summary requires at least 20 words of synthesis" });
      }
      break;

    default:
      // Unknown layout — require at least body or bullets
      if (!params.body && (!params.bullets || params.bullets.length === 0) && !params.chartId) {
        violations.push({ field: "content", rule: "Slide must have at least one of: body, bullets, or chart" });
      }
  }

  return violations;
}

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
          headingFont: "Arial",
          bodyFont: "Arial",
          monoFont: "Courier New",
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

// ─── BUILD CHART (strict) ─────────────────────────────────────────

export function createBuildChartTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Create a chart from data. Returns a chart ID. The chart must have at least 3 data rows and at least 1 series column with numeric data. Use the chart ID in write_slide.",
    inputSchema: z.object({
      type: z.enum(["bar", "line", "pie", "doughnut", "scatter", "waterfall", "stacked_bar", "table"]),
      title: z.string().min(5).describe("Descriptive chart title"),
      intent: z.enum(["rank", "trend", "composition", "bridge", "correlation", "comparison", "detail"])
        .describe("What analytical story does this chart tell?"),
      data: z.array(z.record(z.unknown())).min(3).describe("Array of data objects — minimum 3 rows"),
      xAxis: z.string().describe("Column name for categories/x-axis"),
      series: z.array(z.string()).min(1).describe("Column names for numeric data series — minimum 1"),
      sort: z.enum(["none", "asc", "desc"]).default("none").describe("Sort data by first series value"),
      style: z
        .object({
          colors: z.array(z.string()).optional(),
          showLegend: z.boolean().optional(),
          showValues: z.boolean().optional(),
        })
        .optional(),
    }),
    async execute(params) {
      // Validate xAxis column exists in data
      if (params.data.length > 0 && !(params.xAxis in params.data[0])) {
        const availableKeys = Object.keys(params.data[0]).slice(0, 10).join(", ");
        return {
          error: `xAxis column "${params.xAxis}" not found in data. Available columns: ${availableKeys}`,
          chartId: null,
        };
      }

      // Validate series columns exist in data
      const missingSeries = params.series.filter((s) => params.data.length > 0 && !(s in params.data[0]));
      if (missingSeries.length > 0) {
        const availableKeys = Object.keys(params.data[0]).slice(0, 10).join(", ");
        return {
          error: `Series column(s) [${missingSeries.join(", ")}] not found in data. Available columns: ${availableKeys}`,
          chartId: null,
        };
      }

      // Validate data has numeric values in at least one series
      const hasNumeric = params.series.some((s) =>
        params.data.some((row) => {
          const v = row[s];
          return typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)));
        }),
      );

      if (!hasNumeric) {
        return {
          error: `No numeric data found in series columns [${params.series.join(", ")}]. Values must be numbers. Check column names.`,
          chartId: null,
        };
      }

      // Sort data if requested
      let sortedData = params.data as Record<string, unknown>[];
      if (params.sort !== "none" && params.series.length > 0) {
        const sortKey = params.series[0];
        sortedData = [...sortedData].sort((a, b) => {
          const va = Number(a[sortKey]) || 0;
          const vb = Number(b[sortKey]) || 0;
          return params.sort === "desc" ? vb - va : va - vb;
        });
      }

      const result = await ctx.persistChart({
        chartType: params.type,
        title: params.title,
        data: sortedData,
        xAxis: params.xAxis,
        series: params.series,
        style: params.style,
      });

      await ctx.persistNotebookEntry({
        toolName: "build_chart",
        toolInput: {
          type: params.type,
          intent: params.intent,
          title: params.title,
          dataRows: params.data.length,
          series: params.series,
          xAxis: params.xAxis,
        },
        toolOutput: result,
      });

      return {
        ...result,
        dataRows: sortedData.length,
        seriesCount: params.series.length,
        intent: params.intent,
      };
    },
  });
}

// ─── WRITE SLIDE (strict scene-graph commit) ──────────────────────

export function createWriteSlideTool(ctx: AuthoringToolContext) {
  return tool({
    description: `Commit a slide to the deck. STRICT: every non-cover slide must have speaker notes and evidence IDs. Layout-specific requirements are enforced — sparse slides will be REJECTED with validation errors. Fix violations before retrying.`,
    inputSchema: z.object({
      position: z.number().int().positive().describe("Slide position (1-indexed)"),
      layout: z.string().describe("Layout ID: cover, exec-summary, title-chart, chart-split, metrics, title-body, title-bullets, evidence-grid, table, summary"),
      title: z.string().min(4).describe("Action title: a complete sentence stating the takeaway — NOT a topic label"),
      subtitle: z.string().optional(),
      body: z.string().optional().describe("Executive prose — max 55 words for story slides, 80 for appendix"),
      bullets: z.array(z.string()).max(5).optional().describe("Key points — max 4-5 bullets, 8-12 words each"),
      chartId: z.string().optional().describe("Chart ID from build_chart"),
      metrics: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            delta: z.string().optional().describe("Change indicator, e.g. '+12.3%' or '↑2.6pp'"),
          }),
        )
        .optional(),
      evidenceIds: z.array(z.string()).describe("Evidence ref IDs supporting this slide — required for non-cover"),
      speakerNotes: z.string().optional().describe("Presenter narrative 60-140 words — caveats, transitions, backup data"),
      transition: z.string().optional().describe("Bridge sentence to next slide"),
    }),
    async execute(params) {
      // Validate density requirements
      const violations = validateSlideDensity(params);
      if (violations.length > 0) {
        return {
          error: "Slide rejected — density requirements not met",
          violations,
          hint: "Fix the listed violations and retry. Every non-cover slide needs speaker notes, evidence IDs, and content appropriate for the layout.",
        };
      }

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
        toolInput: {
          position: params.position,
          layout: params.layout,
          title: params.title,
          hasChart: Boolean(params.chartId),
          hasMetrics: Boolean(params.metrics?.length),
          hasBullets: Boolean(params.bullets?.length),
          hasBody: Boolean(params.body),
          hasSpeakerNotes: Boolean(params.speakerNotes),
          evidenceCount: params.evidenceIds?.length ?? 0,
        },
        toolOutput: result,
      });

      return {
        ...result,
        density: {
          hasChart: Boolean(params.chartId),
          hasMetrics: Boolean(params.metrics?.length),
          hasBullets: Boolean(params.bullets?.length),
          hasBody: Boolean(params.body),
          hasSpeakerNotes: Boolean(params.speakerNotes),
          evidenceCount: params.evidenceIds?.length ?? 0,
        },
      };
    },
  });
}

// ─── RENDER DECK PREVIEW ──────────────────────────────────────────

export function createRenderDeckPreviewTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Audit the deck so far. Returns density stats, layout distribution, and issues for each slide. Call after building all slides to check quality before finishing.",
    inputSchema: z.object({}),
    async execute() {
      const slides = ctx.getSlides ? await ctx.getSlides() : [];

      if (slides.length === 0) {
        return {
          error: "No slides found. Build slides first using write_slide.",
          slideCount: 0,
        };
      }

      // Compute density stats
      const layoutCounts: Record<string, number> = {};
      const issues: string[] = [];
      let chartsUsed = 0;
      let metricsUsed = 0;
      let slidesWithNotes = 0;
      let slidesWithBody = 0;

      for (const s of slides) {
        layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
        if (s.chartId) chartsUsed++;
        if (s.metrics && (s.metrics as unknown[]).length > 0) metricsUsed++;
        if (s.speakerNotes) slidesWithNotes++;
        if (s.body) slidesWithBody++;
      }

      // Check layout diversity
      const contentSlides = slides.filter((s) => s.layoutId !== "cover");
      const maxLayoutPct = Math.max(...Object.values(layoutCounts)) / slides.length;
      if (maxLayoutPct > 0.5 && slides.length > 5) {
        const dominant = Object.entries(layoutCounts).sort((a, b) => b[1] - a[1])[0];
        issues.push(`Layout monotony: ${dominant[0]} used ${dominant[1]}/${slides.length} times (${Math.round(maxLayoutPct * 100)}%). Use more variety.`);
      }

      // Check title quality
      for (const s of contentSlides) {
        if (s.title.split(/\s+/).length < 5) {
          issues.push(`Slide ${s.position}: title too short — "${s.title}" is not an action title`);
        }
      }

      // Check notes coverage
      const notesPct = slidesWithNotes / Math.max(contentSlides.length, 1);
      if (notesPct < 0.8) {
        issues.push(`Only ${Math.round(notesPct * 100)}% of content slides have speaker notes. Target 100%.`);
      }

      // Check chart density
      if (chartsUsed < slides.length * 0.4 && slides.length > 4) {
        issues.push(`Only ${chartsUsed} charts across ${slides.length} slides. Data-driven decks need more visualizations.`);
      }

      const titleReadThrough = slides.map((s) => `${s.position}. ${s.title}`).join("\n");

      await ctx.persistNotebookEntry({
        toolName: "render_deck_preview",
        toolInput: {},
        toolOutput: {
          slideCount: slides.length,
          issueCount: issues.length,
          chartsUsed,
          metricsUsed,
        },
      });

      return {
        slideCount: slides.length,
        layoutDistribution: layoutCounts,
        density: {
          chartsUsed,
          metricsUsed,
          slidesWithNotes,
          slidesWithBody,
          notesCoverage: `${Math.round(notesPct * 100)}%`,
        },
        titleReadThrough,
        issues: issues.length > 0 ? issues : ["No issues found. Deck quality looks good."],
        qualityScore: issues.length === 0 ? "PASS" : issues.length <= 3 ? "ACCEPTABLE" : "NEEDS_WORK",
      };
    },
  });
}
