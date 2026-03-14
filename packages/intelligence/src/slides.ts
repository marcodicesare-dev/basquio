import { z } from "zod";

import {
  chartSpecSchema,
  slideSpecSchema,
  type AnalyticsResult,
  type ChartSpec,
  type InsightSpec,
  type ReportBrief,
  type ReportOutline,
  type SlideSpec,
  type StageTrace,
  type StorySpec,
  type TemplateProfile,
} from "@basquio/types";

import { generateStructuredStage } from "./model";
import { collectInsightEvidenceIds, compactUnique, getBusinessInsights } from "./utils";

type PlanSlidesInput = {
  analyticsResult: AnalyticsResult;
  story: StorySpec;
  outline: ReportOutline;
  insights: InsightSpec[];
  templateProfile: TemplateProfile;
  brief: ReportBrief;
  reviewFeedback?: string[];
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

const slideBlueprintSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  purpose: z.string(),
  emphasis: z.enum(["cover", "section", "content"]).default("content"),
  layoutId: z.string(),
  title: z.string(),
  subtitle: z.string().default(""),
  focusInsightIds: z.array(z.string()).default([]),
  includeSectionSummary: z.boolean().default(false),
  includeMethodology: z.boolean().default(false),
  includeRecommendations: z.boolean().default(false),
  transition: z.string().default(""),
});

type SlideBlueprint = z.infer<typeof slideBlueprintSchema>;

export async function planSlides(
  input: PlanSlidesInput,
  options: TraceOptions = {},
): Promise<{ slides: SlideSpec[]; charts: ChartSpec[] }> {
  const charts = buildCharts(input.analyticsResult, input.insights);
  const llmBlueprints = await planSlideBlueprints(input, charts, options);
  const blueprints = llmBlueprints.length > 0 ? llmBlueprints : buildFallbackBlueprints(input);
  const slides = materializeSlides(blueprints, input, charts);

  return {
    slides,
    charts,
  };
}

async function planSlideBlueprints(
  input: PlanSlidesInput,
  charts: ChartSpec[],
  options: TraceOptions,
) {
  const modelId = process.env.BASQUIO_SLIDE_MODEL || "gpt-5-mini";
  const sectionMap = new Map(input.outline.sections.map((section) => [section.id, section]));
  const result = await generateStructuredStage({
    stage: "slide-architect",
    schema: z.object({
      slides: z.array(slideBlueprintSchema).min(1).max(40),
    }),
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a slide architect planning an executive deck from an evidence package.",
      "Decide slide count, sectioning, transitions, and layout usage from the outline, insights, and template profile.",
      "Do not write generic filler slides. Every slide should have a narrative job.",
      "Use only section ids, insight ids, and layout ids provided below.",
      "",
      "## Brief",
      JSON.stringify(input.brief, null, 2),
      "",
      "## Story",
      JSON.stringify(input.story, null, 2),
      "",
      "## Outline",
      JSON.stringify(input.outline, null, 2),
      "",
      "## Template profile",
      JSON.stringify(
        {
          sourceType: input.templateProfile.sourceType,
          slideSize: input.templateProfile.slideSize,
          themeName: input.templateProfile.themeName,
          layouts: input.templateProfile.layouts,
          placeholderCatalog: input.templateProfile.placeholderCatalog,
          warnings: input.templateProfile.warnings,
        },
        null,
        2,
      ),
      "",
      "## Ranked insights",
      JSON.stringify(
        input.insights.map((insight) => ({
          id: insight.id,
          rank: insight.rank,
          title: insight.title,
          slideEmphasis: insight.slideEmphasis,
          businessMeaning: insight.businessMeaning,
          chartSuggestion: insight.chartSuggestion,
        })),
        null,
        2,
      ),
      "",
      "## Available charts",
      JSON.stringify(
        charts.map((chart) => ({
          id: chart.id,
          title: chart.title,
          family: chart.family,
          evidenceIds: chart.evidenceIds,
        })),
        null,
        2,
      ),
      "",
      ...(input.reviewFeedback?.length
        ? [
            "## Reviewer feedback to address",
            ...input.reviewFeedback.map((item) => `- ${item}`),
            "",
          ]
        : []),
      "Return slide blueprints only.",
    ].join("\n"),
  });
  options.onTrace?.(result.trace);

  return (result.object?.slides ?? [])
    .map((blueprint) => {
      const section = sectionMap.get(blueprint.sectionId);
      if (!section) {
        return null;
      }

      const layoutId = findLayout(input.templateProfile, blueprint.layoutId);
      return slideBlueprintSchema.parse({
        ...blueprint,
        layoutId,
        focusInsightIds: blueprint.focusInsightIds.filter((id) =>
          input.insights.some((insight) => insight.id === id),
        ),
      });
    })
    .filter((value): value is SlideBlueprint => Boolean(value));
}

function buildFallbackBlueprints(input: PlanSlidesInput) {
  const blueprints: SlideBlueprint[] = [];
  let coverCreated = false;

  for (const section of input.outline.sections) {
    const focusInsightIds = section.supportingInsightIds.filter((id) =>
      input.insights.some((insight) => insight.id === id),
    );

    if (section.kind === "framing" && !coverCreated) {
      blueprints.push({
        id: "slide-cover",
        sectionId: section.id,
        purpose: "Cover and framing",
        emphasis: "cover",
        layoutId: findLayout(input.templateProfile, "cover"),
        title: input.story.title || input.brief.objective,
        subtitle: input.story.executiveSummary || section.summary,
        focusInsightIds: focusInsightIds.slice(0, 1),
        includeSectionSummary: true,
        includeMethodology: false,
        includeRecommendations: false,
        transition: "Move from the report headline into how the package evidence is organized.",
      });
      coverCreated = true;
    }

    if (section.kind === "methodology") {
      blueprints.push({
        id: `slide-${section.id}`,
        sectionId: section.id,
        purpose: section.objective,
        emphasis: "section",
        layoutId: findLayout(input.templateProfile, "summary"),
        title: section.title,
        subtitle: section.summary,
        focusInsightIds: [],
        includeSectionSummary: true,
        includeMethodology: true,
        includeRecommendations: false,
        transition: "With the package mechanics clear, move into the strongest findings.",
      });
      continue;
    }

    const needsSectionOpener =
      section.emphasis !== "light" &&
      section.kind !== "recommendations" &&
      section.suggestedSlideCount > 1;

    if (needsSectionOpener && !(section.kind === "framing" && coverCreated)) {
      blueprints.push({
        id: `slide-${section.id}-overview`,
        sectionId: section.id,
        purpose: `${section.title} overview`,
        emphasis: "section",
        layoutId: findLayout(input.templateProfile, "summary"),
        title: section.title,
        subtitle: section.summary,
        focusInsightIds: focusInsightIds.slice(0, 2),
        includeSectionSummary: true,
        includeMethodology: false,
        includeRecommendations: false,
        transition: `Move from ${section.title.toLowerCase()} into the evidence-backed slides.`,
      });
    }

    if (section.kind === "recommendations") {
      blueprints.push({
        id: `slide-${section.id}`,
        sectionId: section.id,
        purpose: section.objective,
        emphasis: "section",
        layoutId: findLayout(input.templateProfile, "summary"),
        title: section.title,
        subtitle: section.summary,
        focusInsightIds: focusInsightIds.slice(0, 3),
        includeSectionSummary: true,
        includeMethodology: false,
        includeRecommendations: true,
        transition: "Close on action, ownership, and the evidence that justifies it.",
      });
      continue;
    }

    if (section.kind === "implications") {
      blueprints.push({
        id: `slide-${section.id}`,
        sectionId: section.id,
        purpose: section.objective,
        emphasis: "content",
        layoutId: findLayout(input.templateProfile, "two-column"),
        title: section.title,
        subtitle: section.summary,
        focusInsightIds: focusInsightIds.slice(0, Math.max(2, section.suggestedSlideCount)),
        includeSectionSummary: true,
        includeMethodology: false,
        includeRecommendations: false,
        transition: "Translate the implications into specific action choices.",
      });
      continue;
    }

    const remainingSlots = Math.max(
      1,
      section.suggestedSlideCount - (needsSectionOpener && !(section.kind === "framing" && coverCreated) ? 1 : 0),
    );
    const selectedInsightIds = focusInsightIds.length > 0
      ? focusInsightIds.slice(0, remainingSlots)
      : getBusinessInsights(input.insights).slice(0, remainingSlots).map((insight) => insight.id);

    for (const [index, insightId] of selectedInsightIds.entries()) {
      const insight = input.insights.find((candidate) => candidate.id === insightId);
      blueprints.push({
        id: `slide-${section.id}-${index + 1}`,
        sectionId: section.id,
        purpose: insight?.title || section.objective,
        emphasis: "content",
        layoutId: findLayout(input.templateProfile, chartsForSection(section.kind).length > 0 ? "evidence-grid" : "summary"),
        title: insight?.title || section.title,
        subtitle: insight?.finding || insight?.claim || section.summary,
        focusInsightIds: [insightId],
        includeSectionSummary: index === 0 && section.kind === "framing",
        includeMethodology: false,
        includeRecommendations: false,
        transition: `Use ${insight?.title?.toLowerCase() || "this signal"} to bridge into the next proof point.`,
      });
    }
  }

  return dedupeBlueprints(blueprints);

  function chartsForSection(kind: string) {
    return kind === "findings" || kind === "analysis" ? ["evidence-grid"] : [];
  }
}

function materializeSlides(
  blueprints: SlideBlueprint[],
  input: PlanSlidesInput,
  charts: ChartSpec[],
) {
  const sectionMap = new Map(input.outline.sections.map((section) => [section.id, section]));
  const insightMap = new Map(input.insights.map((insight) => [insight.id, insight]));

  return blueprints.map((blueprint, index) => {
    const section = sectionMap.get(blueprint.sectionId);
    const selectedInsights = compactInsightList(blueprint.focusInsightIds.map((id) => insightMap.get(id)).filter(Boolean));
    const chart = chooseChart(selectedInsights, charts);
    const evidenceIds = collectInsightEvidenceIds(selectedInsights);
    const claimIds = selectedInsights.flatMap((insight) => insight.claims.map((claim) => claim.id));
    const blocks = buildBlocks({
      blueprint,
      section,
      selectedInsights,
      chart,
      input,
      slideIndex: index,
    });

    return slideSpecSchema.parse({
      id: blueprint.id || `slide-${index + 1}`,
      purpose: blueprint.purpose,
      section: section?.title || input.outline.title,
      eyebrow: buildEyebrow(blueprint, section, index),
      emphasis: blueprint.emphasis,
      layoutId: findLayout(input.templateProfile, blueprint.layoutId),
      title: blueprint.title,
      subtitle: blueprint.subtitle || section?.summary,
      blocks,
      claimIds,
      evidenceIds,
      speakerNotes: buildSpeakerNotes(blueprint, section, selectedInsights, input.story),
      transition: blueprint.transition || buildTransition(section, selectedInsights, input.story),
    });
  });
}

function buildBlocks(input: {
  blueprint: SlideBlueprint;
  section?: ReportOutline["sections"][number];
  selectedInsights: InsightSpec[];
  chart?: ChartSpec;
  slideIndex: number;
  input: PlanSlidesInput;
}) {
  const { blueprint, section, selectedInsights, chart } = input;
  const blocks: SlideSpec["blocks"] = [];
  const evidenceIds = collectInsightEvidenceIds(selectedInsights);

  if (blueprint.emphasis === "cover") {
    blocks.push(block({
      kind: "callout",
      content:
        input.input.story.thesis ||
        input.input.story.keyMessages[0] ||
        selectedInsights[0]?.claim ||
        input.input.brief.objective,
      tone: "positive",
      evidenceIds,
    }));
    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        `Audience: ${input.input.brief.audience}`,
        input.input.brief.stakes ? `Stakes: ${input.input.brief.stakes}` : undefined,
        `Planned depth: ${input.input.story.recommendedSlideCount} slides`,
      ]),
      evidenceIds,
    }));
    return blocks;
  }

  if (blueprint.includeMethodology) {
    const sourceFileCount = new Set(input.input.analyticsResult.evidenceRefs.map((ref) => ref.fileName).filter(Boolean)).size;
    const evidenceGroupCount = new Set(
      input.input.analyticsResult.evidenceRefs.map((ref) => `${ref.fileName}:${ref.sheet}`).filter(Boolean),
    ).size;
    blocks.push(
      block({
        kind: "metric",
        label: "Files",
        value: String(sourceFileCount || 1),
        evidenceIds: [],
      }),
      block({
        kind: "metric",
        label: "Evidence Views",
        value: String(evidenceGroupCount || input.input.outline.sections.length),
        evidenceIds: [],
      }),
      block({
        kind: "metric",
        label: "Metrics",
        value: String(input.input.analyticsResult.metrics.length),
        evidenceIds: [],
      }),
    );
    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        "Interpret package semantics before choosing metrics.",
        "Compute the metric plan deterministically and preserve evidence refs.",
        "Use reviewer feedback to re-plan instead of rendering weak claims.",
        input.input.story.narrativeArc[0],
      ]),
      evidenceIds: [],
    }));
    return blocks;
  }

  if (blueprint.includeSectionSummary) {
    blocks.push(block({
      kind: "callout",
      content:
        section?.summary ||
        selectedInsights[0]?.businessMeaning ||
        input.input.story.keyMessages[0] ||
        input.input.brief.objective,
      tone: section?.kind === "implications" ? "caution" : "positive",
      evidenceIds,
    }));
  }

  if (chart) {
    blocks.push(block({
      kind: "chart",
      chartId: chart.id,
      evidenceIds: chart.evidenceIds,
    }));
  }

  if (selectedInsights.length > 0 && (section?.kind === "findings" || section?.kind === "analysis" || chart)) {
    blocks.push(block({
      kind: "evidence-list",
      items: selectedInsights.flatMap((insight) =>
        insight.evidence.slice(0, 2).map((evidence) => `${evidence.fileName || evidence.sheet}: ${evidence.summary}`),
      ).slice(0, 5),
      evidenceIds,
    }));
  }

  if (blueprint.includeRecommendations || section?.kind === "recommendations") {
    blocks.push(block({
      kind: "bullet-list",
      items: input.input.story.recommendedActions.slice(0, Math.max(3, selectedInsights.length)),
      evidenceIds,
    }));
    blocks.push(block({
      kind: "evidence-list",
      items: selectedInsights.slice(0, 3).map((insight) => `${insight.title}: ${insight.finding || insight.claim}`),
      evidenceIds,
    }));
    return compactUniqueBlocks(blocks);
  }

  if (section?.kind === "implications") {
    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        ...selectedInsights.map((insight) => insight.implication || insight.businessMeaning),
        input.input.brief.stakes,
      ]).slice(0, 5),
      evidenceIds,
    }));
    return compactUniqueBlocks(blocks);
  }

  if (selectedInsights.length > 0) {
    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        ...selectedInsights.map((insight) => insight.finding || insight.claim),
        ...selectedInsights.map((insight) => insight.businessMeaning),
      ]).slice(0, chart ? 4 : 6),
      evidenceIds,
    }));
  } else {
    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        section?.objective,
        section?.summary,
        input.input.story.keyMessages[input.slideIndex % input.input.story.keyMessages.length],
      ]),
      evidenceIds,
    }));
  }

  return compactUniqueBlocks(blocks);
}

function buildCharts(analyticsResult: AnalyticsResult, insights: InsightSpec[]) {
  return insights
    .map((insight) => {
      const metric = analyticsResult.metrics.find((candidate) => {
        const evidenceOverlap = candidate.evidenceRefIds.some((id) => insight.evidenceRefIds.includes(id));
        const nameOverlap =
          insight.id.includes(candidate.name) ||
          insight.title.toLowerCase().includes(candidate.name.replaceAll("_", " "));
        return evidenceOverlap || nameOverlap;
      });

      if (!metric) {
        return null;
      }

      const dimensionKey = Object.keys(metric.byDimension)[0];
      const rows = metric.byDimension[dimensionKey] || [];
      const family = inferChartFamily(insight, dimensionKey, rows.length);

      return chartSpecSchema.parse({
        id: `chart-${insight.id}`,
        title: insight.title,
        family,
        editableInPptx: family === "bar" || family === "line" || family === "area",
        categories: rows.map((row) => row.key),
        series: [
          {
            name: metric.name,
            values: rows.map((row) => row.value),
          },
        ],
        xKey: dimensionKey,
        yKeys: [metric.name],
        summary: insight.finding || insight.claim,
        annotation: insight.implication || insight.businessMeaning,
        evidenceIds: metric.evidenceRefIds,
        dataBinding: {
          derivedTable: `${metric.name}_table`,
          categoryColumn: "key",
          valueColumns: ["value"],
        },
        bindings: metric.evidenceRefIds.map((evidenceId, index) => ({
          id: `${metric.name}-binding-${index + 1}`,
          evidenceId,
          sourceFileId: analyticsResult.evidenceRefs.find((ref) => ref.id === evidenceId)?.sourceFileId || "",
          fileName: analyticsResult.evidenceRefs.find((ref) => ref.id === evidenceId)?.fileName || "",
          sheet: analyticsResult.evidenceRefs.find((ref) => ref.id === evidenceId)?.sheet || metric.name,
          metric: metric.name,
          statistic: inferBindingStatistic(metric.metricType),
        })),
      });
    })
    .filter((value): value is ChartSpec => Boolean(value));
}

function chooseChart(insights: InsightSpec[], charts: ChartSpec[]) {
  const evidenceIds = new Set(collectInsightEvidenceIds(insights));
  return charts.find((chart) => chart.evidenceIds.some((id) => evidenceIds.has(id))) ?? charts.find((chart) =>
    insights.some((insight) => chart.id === `chart-${insight.id}`),
  );
}

function inferChartFamily(insight: InsightSpec, dimensionKey: string, rowCount: number) {
  const suggestion = (insight.chartSuggestion || "").toLowerCase();
  if (suggestion.includes("line") || dimensionKey.includes("date") || dimensionKey.includes("month")) {
    return "line" as const;
  }
  if (suggestion.includes("area")) {
    return "area" as const;
  }
  if (suggestion.includes("scatter")) {
    return "scatter" as const;
  }
  if (suggestion.includes("waterfall")) {
    return "waterfall" as const;
  }
  if (rowCount > 8) {
    return "bar" as const;
  }
  return "bar" as const;
}

function buildEyebrow(
  blueprint: SlideBlueprint,
  section: ReportOutline["sections"][number] | undefined,
  index: number,
) {
  if (blueprint.emphasis === "cover") {
    return section?.title || "Executive Report";
  }

  const kind = section?.kind || "analysis";
  const prefix =
    kind === "findings" || kind === "analysis"
      ? "Evidence"
      : kind === "implications"
        ? "Implications"
        : kind === "recommendations"
          ? "Recommendations"
          : section?.title || "Section";

  return `${prefix} ${index + 1}`;
}

function buildSpeakerNotes(
  blueprint: SlideBlueprint,
  section: ReportOutline["sections"][number] | undefined,
  selectedInsights: InsightSpec[],
  story: StorySpec,
) {
  return compactUnique([
    blueprint.purpose,
    section?.objective,
    ...selectedInsights.map((insight) => insight.finding || insight.claim),
    ...selectedInsights.map((insight) => insight.implication || insight.businessMeaning),
    story.executiveSummary,
  ]).join(" ");
}

function buildTransition(
  section: ReportOutline["sections"][number] | undefined,
  selectedInsights: InsightSpec[],
  story: StorySpec,
) {
  return (
    selectedInsights[0]?.businessMeaning ||
    section?.objective ||
    story.narrativeArc[1] ||
    "Move into the next evidence-backed step."
  );
}

function findLayout(templateProfile: TemplateProfile, requestedLayoutId: string) {
  const available = new Map(templateProfile.layouts.map((layout) => [layout.id, layout]));
  if (available.has(requestedLayoutId)) {
    return requestedLayoutId;
  }

  const byPlaceholder = templateProfile.layouts.find((layout) =>
    layout.placeholders.some((placeholder) => requestedLayoutId.includes(placeholder) || placeholder.includes(requestedLayoutId)),
  );

  return byPlaceholder?.id ?? templateProfile.layouts[0]?.id ?? requestedLayoutId;
}

function compactInsightList(insights: Array<InsightSpec | undefined>) {
  const seen = new Set<string>();
  return insights.filter((insight): insight is InsightSpec => {
    if (!insight || seen.has(insight.id)) {
      return false;
    }
    seen.add(insight.id);
    return true;
  });
}

function compactUniqueBlocks(blocks: Array<SlideSpec["blocks"][number] | undefined>) {
  return blocks.filter(Boolean) as SlideSpec["blocks"];
}

function block(
  input: Omit<SlideSpec["blocks"][number], "items" | "tone" | "evidenceIds"> &
    Partial<Pick<SlideSpec["blocks"][number], "items" | "tone" | "evidenceIds">>,
) {
  return {
    items: [],
    tone: "default" as const,
    evidenceIds: [],
    ...input,
  };
}

function dedupeBlueprints(blueprints: SlideBlueprint[]) {
  const seen = new Set<string>();
  return blueprints.filter((blueprint) => {
    const key = blueprint.id || `${blueprint.sectionId}:${blueprint.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferBindingStatistic(metricType: AnalyticsResult["metrics"][number]["metricType"]) {
  switch (metricType) {
    case "sum":
    case "rank":
      return "sum" as const;
    case "count":
      return "numericCount" as const;
    case "count_distinct":
      return "distinctCount" as const;
    case "average":
    case "ratio":
    case "share":
    case "delta":
    default:
      return "average" as const;
  }
}
