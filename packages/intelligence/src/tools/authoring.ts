import { tool } from "ai";
import { z } from "zod";

import { auditSlideScene } from "@basquio/scene-graph";
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
    kicker?: string;
    body?: string;
    bullets?: string[];
    chartId?: string;
    metrics?: { label: string; value: string; delta?: string }[];
    callout?: { text: string; tone?: "accent" | "green" | "orange" };
    evidenceIds: string[];
    speakerNotes?: string;
    transition?: string;
    pageIntent?: string;
    governingThought?: string;
    chartIntent?: string;
    focalObject?: string;
    decisionAsk?: string;
    riskNote?: string;
    highlightCategories?: string[];
    recommendationBlock?: { condition: string; recommendation: string; quantification: string };
  }) => Promise<{ slideId: string; previewUrl?: string; warnings?: string[] }>;
  persistChart: (chart: {
    chartType: string;
    title: string;
    data: Record<string, unknown>[];
    xAxis?: string;
    yAxis?: string;
    series?: string[];
    style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean; highlightCategories?: string[] };
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
    callout?: { text: string; tone?: string };
    kicker?: string;
    pageIntent?: string;
    governingThought?: string;
    chartIntent?: string;
    focalObject?: string;
    highlightCategories?: string[];
  }>>;
  listEvidence?: () => Promise<Array<{
    evidenceRefId: string;
    toolName: string;
    summary: string;
    label?: string;
    value?: unknown;
    confidence?: number | null;
  }>>;
  getNotebookEntries?: (evidenceRefId: string) => Promise<{ toolName: string; toolOutput: Record<string, unknown> } | null>;
  renderContactSheet?: () => Promise<{ available: boolean; slideCount: number; thumbnailDescriptions: string[]; deckLevelIssues: string[] } | null>;
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
      highlightCategories: z.array(z.string()).optional()
        .describe("Category values to highlight (e.g. ['Affinity'] to spotlight the client brand in charts and tables)"),
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
        style: {
          ...params.style,
          highlightCategories: params.highlightCategories,
        },
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
      kicker: z.string().optional().describe("Section label above title in UPPERCASE (e.g. 'MARKET OVERVIEW', 'RECOMMENDATION'). Use to create section rhythm."),
      body: z.string().optional().describe("Executive prose — max 55 words for story slides, 80 for appendix. First sentence will be bolded."),
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
      callout: z.object({
        text: z.string().describe("Bold insight or recommendation — max 25 words"),
        tone: z.enum(["accent", "green", "orange"]).optional().describe("Color: accent (blue), green (positive), orange (warning)"),
      }).optional().describe("Colored callout banner at the bottom of the slide. Use for key insight, recommendation, or warning."),
      evidenceIds: z.array(z.string()).describe("Evidence ref IDs supporting this slide — required for non-cover"),
      speakerNotes: z.string().optional().describe("Presenter narrative 60-140 words — caveats, transitions, backup data"),
      transition: z.string().optional().describe("Bridge sentence to next slide"),
      pageIntent: z.enum(["inform", "persuade", "recommend", "context"]).optional().describe("The communication purpose of this slide"),
      governingThought: z.string().optional().describe("The single claim this slide must communicate"),
      chartIntent: z.string().optional().describe("rank, trend, composition, bridge, correlation, comparison, kpi, table, none"),
      focalObject: z.string().optional().describe("The entity/metric that is the star of this slide"),
      decisionAsk: z.string().optional().describe("What decision this slide asks the audience to make"),
      riskNote: z.string().optional().describe("Key risk or caveat the audience should know"),
      highlightCategories: z.array(z.string()).optional().describe("Entities to visually highlight on charts"),
      recommendationBlock: z.object({
        condition: z.string(),
        recommendation: z.string(),
        quantification: z.string(),
      }).optional().describe("Structured recommendation for recommendation slides"),
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

      // Evidence validation: verify each evidence ID actually exists in the notebook
      if (ctx.getNotebookEntries && params.evidenceIds && params.evidenceIds.length > 0) {
        const missingIds: string[] = [];
        for (const eid of params.evidenceIds) {
          const entry = await ctx.getNotebookEntries(eid);
          if (!entry) {
            missingIds.push(eid);
          }
        }
        if (missingIds.length > 0) {
          return {
            error: `Evidence validation failed: ${missingIds.length} evidence ID(s) not found in notebook: [${missingIds.join(", ")}]. Use list_evidence to see available evidence, or use compute_metric/query_data to create new evidence first.`,
            missingIds,
          };
        }
      }

      const result = await ctx.persistSlide({
        position: params.position,
        layoutId: params.layout,
        title: params.title,
        subtitle: params.subtitle,
        kicker: params.kicker,
        body: params.body,
        bullets: params.bullets,
        chartId: params.chartId,
        metrics: params.metrics,
        callout: params.callout,
        evidenceIds: params.evidenceIds ?? [],
        speakerNotes: params.speakerNotes,
        transition: params.transition,
        pageIntent: params.pageIntent,
        governingThought: params.governingThought,
        chartIntent: params.chartIntent,
        focalObject: params.focalObject,
        decisionAsk: params.decisionAsk,
        riskNote: params.riskNote,
        highlightCategories: params.highlightCategories,
        recommendationBlock: params.recommendationBlock,
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
          hasKicker: Boolean(params.kicker),
          hasCallout: Boolean(params.callout),
          hasSpeakerNotes: Boolean(params.speakerNotes),
          evidenceCount: params.evidenceIds?.length ?? 0,
        },
        toolOutput: result,
      });

      // Spatial audit: immediate feedback on layout fill, overflow, and warnings
      const audit = auditSlideScene({
        id: result.slideId ?? "unknown",
        runId: ctx.runId,
        position: params.position,
        layoutId: params.layout,
        title: params.title,
        subtitle: params.subtitle ?? null,
        kicker: params.kicker ?? null,
        body: params.body ?? null,
        bullets: params.bullets ?? null,
        chartId: params.chartId ?? null,
        metrics: params.metrics ?? null,
        callout: params.callout ?? null,
        evidenceIds: params.evidenceIds ?? [],
        speakerNotes: params.speakerNotes ?? null,
        qaStatus: "pending" as const,
        revision: 1,
      } as Parameters<typeof auditSlideScene>[0]);

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
        spatialAudit: {
          filledZones: `${audit.filledZoneCount}/${audit.totalZoneCount}`,
          verticalUsage: `${audit.verticalUsagePct}%`,
          balance: audit.leftRightBalance,
          collisions: audit.collisions,
          overflowRisk: audit.hasOverflowRisk,
          overflowDetails: audit.overflowDetails,
          warnings: audit.warnings,
          zones: audit.zones.map(z => `${z.kind}: ${z.filled ? z.fillDetail : "EMPTY"}`),
        },
      };
    },
  });
}

// ─── RENDER DECK PREVIEW ──────────────────────────────────────────

export function createRenderDeckPreviewTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Audit the deck: returns per-slide composition report (content zones filled/empty, estimated overflow, highlight coverage), deck-level density stats, layout distribution, issues, and the title read-through. Call after building all slides to check quality before finishing. Fix any issues found, then call again to verify.",
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

      // Per-slide composition reports
      const slideCompositions: Array<{
        position: number;
        layout: string;
        title: string;
        zones: { chart: boolean; body: boolean; bullets: boolean; metrics: boolean; notes: boolean; callout: boolean; kicker: boolean };
        filledZones: number;
        totalZones: number;
        estimatedOverflow: boolean;
        focalHighlighted: boolean;
        titleWordCount: number;
        bodyWordCount: number;
        grade: "A" | "B" | "C" | "F";
      }> = [];

      for (const s of slides) {
        layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
        if (s.chartId) chartsUsed++;
        if (s.metrics && (s.metrics as unknown[]).length > 0) metricsUsed++;
        if (s.speakerNotes) slidesWithNotes++;
        if (s.body) slidesWithBody++;

        // Per-slide composition
        if (s.layoutId !== "cover") {
          const hasChart = Boolean(s.chartId);
          const hasBody = Boolean(s.body && s.body.trim().length > 10);
          const hasBullets = Boolean(s.bullets && s.bullets.length > 0);
          const hasMetrics = Boolean(s.metrics && (s.metrics as unknown[]).length > 0);
          const hasNotes = Boolean(s.speakerNotes);
          const hasHighlight = Boolean(s.highlightCategories && s.highlightCategories.length > 0);
          const hasCallout = Boolean(s.callout && s.callout.text);
          const hasKicker = Boolean(s.kicker);

          const bodyWords = s.body ? s.body.split(/\s+/).length : 0;
          const titleWords = s.title.split(/\s+/).length;

          // Estimate overflow: body >80 words, title >20 words, >5 bullets
          const estimatedOverflow = bodyWords > 80 || titleWords > 20 || (s.bullets?.length ?? 0) > 5;

          // Count filled content zones (excluding notes which is a separate concern)
          const zones = { chart: hasChart, body: hasBody, bullets: hasBullets, metrics: hasMetrics, notes: hasNotes, callout: hasCallout, kicker: hasKicker };
          const filledContent = [hasChart, hasBody, hasBullets, hasMetrics, hasCallout].filter(Boolean).length;

          // Grade: A = 3+ content zones + notes + callout, B = 2 zones + notes, C = 1 zone or no notes, F = empty
          let grade: "A" | "B" | "C" | "F" = "F";
          if (filledContent >= 3 && hasNotes && hasCallout) grade = "A";
          else if (filledContent >= 2 && hasNotes) grade = "B";
          else if (filledContent >= 1) grade = "C";

          slideCompositions.push({
            position: s.position,
            layout: s.layoutId,
            title: s.title.slice(0, 60),
            zones,
            filledZones: filledContent,
            totalZones: 4,
            estimatedOverflow,
            focalHighlighted: hasHighlight,
            titleWordCount: titleWords,
            bodyWordCount: bodyWords,
            grade,
          });
        }
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
        // Check for topic-label titles (no number)
        if (!/\d/.test(s.title) && s.title.split(/\s+/).length >= 3) {
          issues.push(`Slide ${s.position}: title has no number — "${s.title}" — action titles need specific data`);
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

      // Check consecutive layout repetition
      for (let i = 1; i < contentSlides.length; i++) {
        if (contentSlides[i].layoutId === contentSlides[i - 1].layoutId &&
            contentSlides[i].layoutId !== "chart-split") {
          issues.push(`Slides ${contentSlides[i - 1].position} and ${contentSlides[i].position} both use "${contentSlides[i].layoutId}" — vary layouts for visual rhythm.`);
        }
      }

      // Check highlight coverage (focal entity must be highlighted)
      const slidesWithoutHighlight = slideCompositions.filter((s) => s.zones.chart && !s.focalHighlighted);
      if (slidesWithoutHighlight.length > 0) {
        issues.push(`${slidesWithoutHighlight.length} chart slide(s) without highlightCategories — focal entity won't stand out: slides ${slidesWithoutHighlight.map((s) => s.position).join(", ")}`);
      }

      // Check callout coverage (every content slide should have a callout)
      const slidesWithoutCallout = slideCompositions.filter((s) => !s.zones.callout);
      if (slidesWithoutCallout.length > 2) {
        issues.push(`${slidesWithoutCallout.length} content slide(s) without callout — every analytical slide needs a "so what" banner: slides ${slidesWithoutCallout.map((s) => s.position).join(", ")}`);
      }

      // Check for overflow risks
      const overflowSlides = slideCompositions.filter((s) => s.estimatedOverflow);
      if (overflowSlides.length > 0) {
        issues.push(`${overflowSlides.length} slide(s) with estimated text overflow — trim content: slides ${overflowSlides.map((s) => s.position).join(", ")}`);
      }

      // Check summary/recommendation slides
      for (const s of slides) {
        if ((s.layoutId === "summary" || s.layoutId === "exec-summary") && !s.body) {
          issues.push(`Slide ${s.position} (${s.layoutId}) has no body text — summary slides need synthesis prose.`);
        }
      }

      // Grade distribution
      const gradeDistribution = { A: 0, B: 0, C: 0, F: 0 };
      for (const comp of slideCompositions) {
        gradeDistribution[comp.grade]++;
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
          gradeDistribution,
        },
      });

      return {
        slideCount: slides.length,
        layoutDistribution: layoutCounts,
        gradeDistribution,
        density: {
          chartsUsed,
          metricsUsed,
          slidesWithNotes,
          slidesWithBody,
          notesCoverage: `${Math.round(notesPct * 100)}%`,
        },
        slideCompositions,
        titleReadThrough,
        issues: issues.length > 0 ? issues : ["No issues found. Deck quality looks good."],
        qualityScore: gradeDistribution.F > 0 ? "NEEDS_WORK" : gradeDistribution.C > 2 ? "NEEDS_WORK" : issues.length <= 3 ? "ACCEPTABLE" : "NEEDS_WORK",
      };
    },
  });
}

// ─── LIST EVIDENCE ───────────────────────────────────────────────

export function createListEvidenceTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "List all evidence entries collected during analysis. Returns evidence ref IDs, labels, values, and summaries. Use these EXACT ref IDs in write_slide's evidenceIds parameter. Also shows the computed value so you can use real numbers in slide titles and body text without re-querying.",
    inputSchema: z.object({}),
    async execute() {
      if (!ctx.listEvidence) {
        return { error: "listEvidence callback not available", entries: [] };
      }

      const entries = await ctx.listEvidence();

      await ctx.persistNotebookEntry({
        toolName: "list_evidence",
        toolInput: {},
        toolOutput: { entryCount: entries.length },
      });

      return { entryCount: entries.length, entries };
    },
  });
}

// ─── RENDER CONTACT SHEET (visual preview) ──────────────────────

export function createRenderContactSheetTool(ctx: AuthoringToolContext) {
  return tool({
    description:
      "Render a visual contact sheet of all slides. Returns per-slide thumbnail descriptions and deck-level visual issues. Call AFTER render_deck_preview passes to get actual visual feedback. Only available if Browserless is configured.",
    inputSchema: z.object({}),
    async execute() {
      if (!ctx.renderContactSheet) {
        return {
          error: "Contact sheet rendering not available (Browserless not configured)",
          available: false,
        };
      }

      const result = await ctx.renderContactSheet();
      if (!result) {
        return {
          error: "Contact sheet rendering failed",
          available: false,
        };
      }

      await ctx.persistNotebookEntry({
        toolName: "render_contact_sheet",
        toolInput: {},
        toolOutput: { slideCount: result.slideCount, issueCount: result.deckLevelIssues.length },
      });

      return result;
    },
  });
}
