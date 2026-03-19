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
import { collectInsightEvidenceIds, compactUnique, getBusinessInsights, sanitizeAudienceCopy } from "./utils";

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

const llmSlideBlueprintSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  purpose: z.string(),
  emphasis: z.enum(["cover", "section", "content"]),
  layoutId: z.string(),
  title: z.string(),
  subtitle: z.string(),
  focusInsightIds: z.array(z.string()),
  includeSectionSummary: z.boolean(),
  includeMethodology: z.boolean(),
  includeRecommendations: z.boolean(),
  transition: z.string(),
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
      slides: z.array(llmSlideBlueprintSchema).min(1).max(100),
    }),
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a slide architect planning an executive deck from an evidence package.",
      "Decide slide count, sectioning, transitions, and layout usage from the outline, insights, and template profile.",
      `Target exactly ${input.story.recommendedSlideCount} slides unless the evidence package makes that impossible.`,
      "Do not write divider, transition, section-break, or filler slides. Every slide must carry substantive analytical content.",
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

      if (section.id === "section-cover") {
        continue;
      }
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

    if (section.id === "section-executive-summary") {
      blueprints.push({
        id: `slide-${section.id}`,
        sectionId: section.id,
        purpose: section.objective,
        emphasis: "content",
        layoutId: findLayout(input.templateProfile, "two-column"),
        title: section.title,
        subtitle: section.summary,
        focusInsightIds: focusInsightIds.slice(0, 4),
        includeSectionSummary: true,
        includeMethodology: false,
        includeRecommendations: false,
        transition: "Move from the top-line summary into the evidence behind each growth and risk signal.",
      });
      continue;
    }

    const needsSectionOpener =
      false;

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
    const requestedLayoutId = findLayout(input.templateProfile, blueprint.layoutId);
    const draftBlocks = buildBlocks({
      blueprint,
      section,
      selectedInsights,
      chart,
      input,
      slideIndex: index,
    });
    const layoutId = chooseLayoutForBlocks(input.templateProfile, requestedLayoutId, draftBlocks, blueprint.emphasis === "cover");
    const blocks = bindBlocksToTemplateRegions(draftBlocks, input.templateProfile, layoutId);

    return slideSpecSchema.parse({
      id: blueprint.id || `slide-${index + 1}`,
      purpose: blueprint.purpose,
      section: section?.title || input.outline.title,
      eyebrow: buildEyebrow(blueprint, section, index),
      emphasis: blueprint.emphasis,
      layoutId,
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

function bindBlocksToTemplateRegions(
  blocks: SlideSpec["blocks"],
  templateProfile: TemplateProfile,
  layoutId: string,
) {
  const layout = resolveTemplateLayoutVariant(templateProfile, layoutId);

  if (!layout) {
    return blocks;
  }

  const reservedKeys = new Set<string>();
  const reusablePlaceholders = new Set(["metric-strip"]);

  return blocks.map((block) => {
    const region = resolveRegionForBlock(layout, block, reservedKeys);

    if (!region) {
      return block;
    }

    if (!reusablePlaceholders.has(region.placeholder)) {
      reservedKeys.add(region.key);
    }

    return {
      ...block,
      templateBinding: {
        layoutId,
        regionKey: region.key,
        placeholder: region.placeholder,
        placeholderIndex: region.placeholderIndex,
        name: region.name,
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        source: region.source,
      },
    };
  });
}

function chooseLayoutForBlocks(
  templateProfile: TemplateProfile,
  requestedLayoutId: string,
  blocks: SlideSpec["blocks"],
  allowCoverLayouts = false,
) {
  const requestedLayout = resolveTemplateLayoutVariant(templateProfile, requestedLayoutId);

  const textBlockCount = blocks.filter((block) =>
    block.kind !== "chart" &&
    block.kind !== "metric" &&
    block.kind !== "divider" &&
    block.kind !== "title" &&
    block.kind !== "subtitle",
  ).length;

  const scoredLayouts = templateProfile.layouts
    .map((layout) => ({
      layout,
      score: scoreLayoutForBlocks(layout, blocks, textBlockCount, allowCoverLayouts),
    }))
    .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score);

  const bestLayout = scoredLayouts[0]?.layout;

  if (!bestLayout) {
    return requestedLayout ? getTemplateLayoutKey(requestedLayout) : requestedLayoutId;
  }

  if (requestedLayout && scoreLayoutForBlocks(requestedLayout, blocks, textBlockCount, allowCoverLayouts) >= scoredLayouts[0]!.score) {
    return getTemplateLayoutKey(requestedLayout);
  }

  return getTemplateLayoutKey(bestLayout);
}

function scoreLayoutForBlocks(
  layout: TemplateProfile["layouts"][number],
  blocks: SlideSpec["blocks"],
  textBlockCount: number,
  allowCoverLayouts: boolean,
) {
  if (!allowCoverLayouts && layout.id === "cover") {
    return Number.NEGATIVE_INFINITY;
  }

  const placeholders = new Set(layout.placeholders);
  const chartCount = blocks.filter((block) => block.kind === "chart").length;
  const hasChartRegion = layoutHasChartRegion(layout);
  const textCapacity = countTextCapacity(layout);

  if (chartCount > 0 && !hasChartRegion) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (chartCount > 0) {
    score += 40;
  }

  if (hasChartRegion) {
    score += 12;
  }

  score += Math.min(textCapacity, textBlockCount) * 6;
  score -= Math.max(0, textBlockCount - textCapacity) * 9;

  for (const block of blocks) {
    const candidates = candidatePlaceholdersForBlock(block);
    if (candidates.some((placeholder) => placeholders.has(placeholder))) {
      score += 3;
      continue;
    }

    if (
      (block.kind === "bullet-list" || block.kind === "body" || block.kind === "callout" || block.kind === "evidence-list") &&
      hasTextPlaceholder(layout)
    ) {
      score += 1;
      continue;
    }

    score -= 8;
  }

  if (layout.id === "two-column") {
    score += 4;
  }

  if (layout.id === "evidence-grid" && textBlockCount <= 2) {
    score += 2;
  }

  return score;
}

function getTemplateLayoutKey(layout: TemplateProfile["layouts"][number]) {
  const variant = (layout.sourceName || layout.name || layout.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${layout.id}::${variant || "default"}`;
}

function resolveTemplateLayoutVariant(templateProfile: TemplateProfile, layoutId: string) {
  const [baseId, variant] = layoutId.split("::");
  const byVariant = variant
    ? templateProfile.layouts.find((layout) => layout.id === baseId && getTemplateLayoutKey(layout) === layoutId)
    : undefined;

  if (byVariant) {
    return byVariant;
  }

  return templateProfile.layouts.find((layout) => layout.id === baseId || getTemplateLayoutKey(layout) === layoutId);
}

function layoutHasChartRegion(layout: TemplateProfile["layouts"][number]) {
  return layout.regions.some((region) => region.placeholder === "chart" || (region.w >= 3 && region.h >= 2 && (region.w * region.h) >= 8));
}

function hasTextPlaceholder(layout: TemplateProfile["layouts"][number]) {
  return layout.regions.some((region) =>
    (region.placeholder === "body" ||
      region.placeholder === "body-left" ||
      region.placeholder === "body-right" ||
      region.placeholder === "callout" ||
      region.placeholder === "evidence-list") &&
    region.h >= 0.7 &&
    region.w >= 2.2,
  );
}

function countTextCapacity(layout: TemplateProfile["layouts"][number]) {
  return layout.regions.filter((region) =>
    (region.placeholder === "body" ||
      region.placeholder === "body-left" ||
      region.placeholder === "body-right" ||
      region.placeholder === "callout" ||
      region.placeholder === "evidence-list") &&
    region.h >= 0.7 &&
    region.w >= 2.2,
  ).length;
}

function resolveRegionForBlock(
  layout: TemplateProfile["layouts"][number],
  block: SlideSpec["blocks"][number],
  reservedKeys: Set<string>,
) {
  const candidates = candidatePlaceholdersForBlock(block);

  for (const placeholder of candidates) {
    const match = pickBestRegion(
      layout.regions.filter(
        (region) =>
          region.placeholder === placeholder &&
          !reservedKeys.has(region.key) &&
          isViableRegionForBlock(region, block),
      ),
      block,
    );
    if (match) {
      return match;
    }
  }

  for (const placeholder of candidates) {
    const fallbackMatch = pickBestRegion(
      layout.regions.filter((region) => region.placeholder === placeholder && isViableRegionForBlock(region, block)),
      block,
    );
    if (fallbackMatch) {
      return fallbackMatch;
    }
  }

  if (isTextualContentBlock(block)) {
    return pickBestRegion(
      layout.regions.filter(
        (region) =>
          (region.placeholder.startsWith("body") ||
            region.placeholder === "evidence-list" ||
            region.placeholder === "callout") &&
          !reservedKeys.has(region.key) &&
          isViableRegionForBlock(region, block),
      ),
      block,
    );
  }

  if (isTextualContentBlock(block)) {
    return pickBestRegion(
      layout.regions.filter(
        (region) =>
          (region.placeholder.startsWith("body") || region.placeholder === "evidence-list" || region.placeholder === "callout") &&
          isViableRegionForBlock(region, block),
      ),
      block,
    );
  }

  return undefined;
}

function candidatePlaceholdersForBlock(block: SlideSpec["blocks"][number]) {
  switch (block.kind) {
    case "chart":
      return ["chart", "body-left", "body-right", "body"];
    case "metric":
      return ["metric-strip", "callout", "body"];
    case "evidence-list":
      return ["evidence-list", "body-right", "body-left", "callout", "body"];
    case "callout":
      return ["callout", "body-left", "body-right", "body"];
    case "table":
      return ["table", "body-left", "body-right", "body"];
    case "body":
    case "bullet-list":
      return ["body-left", "body-right", "body", "callout", "evidence-list"];
    default:
      return ["body-left", "body-right", "body"];
  }
}

function isTextualContentBlock(block: SlideSpec["blocks"][number]) {
  return block.kind === "bullet-list" || block.kind === "body" || block.kind === "callout" || block.kind === "evidence-list";
}

function isViableRegionForBlock(
  region: TemplateProfile["layouts"][number]["regions"][number],
  block: SlideSpec["blocks"][number],
) {
  const area = region.w * region.h;

  switch (block.kind) {
    case "chart":
      return region.w >= 3 && region.h >= 2 && area >= 8;
    case "metric":
      return region.w >= 1.6 && region.h >= 0.5 && area >= 1;
    case "bullet-list":
    case "body":
    case "callout":
    case "evidence-list":
    case "table":
      return region.w >= 2.2 && region.h >= 0.7 && area >= 2;
    default:
      return area >= 1;
  }
}

function pickBestRegion(
  regions: TemplateProfile["layouts"][number]["regions"],
  block: SlideSpec["blocks"][number],
) {
  return [...regions].sort((left, right) => scoreRegionForBlock(right, block) - scoreRegionForBlock(left, block))[0];
}

function scoreRegionForBlock(
  region: TemplateProfile["layouts"][number]["regions"][number],
  block: SlideSpec["blocks"][number],
) {
  let score = region.w * region.h;

  if (region.source === "layout") {
    score += 4;
  }

  if (region.source === "master") {
    score += 2;
  }

  if (block.kind === "chart" && region.placeholder === "chart") {
    score += 20;
  }

  if ((block.kind === "bullet-list" || block.kind === "body" || block.kind === "callout") && region.placeholder === "callout") {
    score += 10;
  }

  if (block.kind === "evidence-list" && region.placeholder === "evidence-list") {
    score += 10;
  }

  if ((block.kind === "bullet-list" || block.kind === "body") && region.placeholder === "body-left") {
    score += 8;
  }

  if (block.kind === "evidence-list" && region.placeholder === "body-right") {
    score += 8;
  }

  if (region.y > 4.75) {
    score -= 25;
  }

  return score;
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
  const retailMode = isRetailSlideContext(selectedInsights, input.input.analyticsResult, input.input.brief);
  const safeStoryThesis = sanitizeAudienceCopy(input.input.story.thesis);
  const safeExecutiveSummary = sanitizeAudienceCopy(input.input.story.executiveSummary);
  const safeStakes = sanitizeAudienceCopy(input.input.brief.stakes);

  if (blueprint.emphasis === "cover") {
    blocks.push(block({
      kind: "callout",
      content:
        retailMode
          ? selectedInsights[0]?.businessMeaning || selectedInsights[0]?.claim || safeExecutiveSummary || input.input.brief.objective
          : safeStoryThesis ||
            input.input.story.keyMessages[0] ||
            selectedInsights[0]?.claim ||
            safeExecutiveSummary ||
            input.input.brief.objective,
      tone: "positive",
      evidenceIds,
    }));
    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        retailMode ? `Audience: ${input.input.brief.audience}`.replace("Audience", "Destinatari") : `Audience: ${input.input.brief.audience}`,
        retailMode
          ? safeStakes
            ? `Mandato: ${safeStakes}`
            : undefined
          : safeStakes
            ? `Stakes: ${safeStakes}`
            : undefined,
        retailMode
          ? `Ampiezza prevista: ${input.input.story.recommendedSlideCount} slide`
          : `Planned depth: ${input.input.story.recommendedSlideCount} slides`,
      ]),
      evidenceIds,
    }));
    return blocks;
  }

  if (section?.id === "section-executive-summary" && retailMode) {
    return buildRetailExecutiveSummaryBlocks(input, evidenceIds);
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
        `Analysis covers ${sourceFileCount || 1} source file${sourceFileCount === 1 ? "" : "s"} across ${evidenceGroupCount || input.input.outline.sections.length} evidence views.`,
        `The deck is grounded in ${input.input.analyticsResult.metrics.length} verified metrics linked back to source evidence.`,
        "Recommendations are prioritized by business impact, evidence strength, and execution risk.",
        sanitizeAudienceCopy(input.input.story.narrativeArc[0]) || input.input.story.keyMessages[0],
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

  if (chart && (blueprint.emphasis === "content" || section?.kind === "implications")) {
    blocks.push(block({
      kind: "chart",
      chartId: chart.id,
      evidenceIds: chart.evidenceIds,
    }));
  }

  if (selectedInsights.length > 0 && (section?.kind === "findings" || section?.kind === "analysis" || chart)) {
    blocks.push(block({
      kind: "evidence-list",
      items: retailMode
        ? buildCompactEvidenceLines(selectedInsights, 4)
        : selectedInsights.flatMap((insight) =>
            insight.evidence.slice(0, 2).map((evidence) => `${evidence.fileName || evidence.sheet}: ${evidence.summary}`),
          ).slice(0, 5),
      evidenceIds,
    }));
  }

  if (blueprint.includeRecommendations || section?.kind === "recommendations") {
    if (retailMode) {
      return buildRetailRecommendationBlocks(input, evidenceIds);
    }

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
    if (retailMode) {
      return buildRetailSynthesisBlocks(input, evidenceIds);
    }

    blocks.push(block({
      kind: "bullet-list",
      items: compactUnique([
        ...selectedInsights.map((insight) => insight.implication || insight.businessMeaning),
        safeStakes,
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
  const exactMatch = insights[0] ? charts.find((chart) => chart.id === `chart-${insights[0]!.id}`) : undefined;
  if (exactMatch) {
    return exactMatch;
  }

  const evidenceIds = new Set(collectInsightEvidenceIds(insights));
  return charts.find((chart) => chart.evidenceIds.some((id) => evidenceIds.has(id))) ?? charts.find((chart) =>
    insights.some((insight) => chart.id === `chart-${insight.id}`),
  );
}

function isRetailSlideContext(
  _selectedInsights: InsightSpec[],
  _analyticsResult: AnalyticsResult,
  _brief: ReportBrief,
) {
  return false;
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
function buildRetailExecutiveSummaryBlocks(
  input: {
    section?: ReportOutline["sections"][number];
    selectedInsights: InsightSpec[];
    input: PlanSlidesInput;
  },
  evidenceIds: string[],
) {
  const metrics = input.selectedInsights
    .map((insight) => buildRetailHeadlineMetric(insight))
    .filter((value): value is { label: string; value: string } => Boolean(value))
    .slice(0, 4)
    .map((metric) =>
      block({
        kind: "metric",
        label: metric.label,
        value: metric.value,
        evidenceIds,
      }),
    );

  return compactUniqueBlocks([
    ...metrics,
    block({
      kind: "callout",
      content: input.input.story.executiveSummary || input.section?.summary || input.input.brief.objective,
      tone: "positive",
      evidenceIds,
    }),
    block({
      kind: "bullet-list",
      items: compactUnique([
        ...input.selectedInsights.slice(0, 4).map((insight) => insight.businessMeaning),
        "La lettura deve tenere insieme scala di mercato, posizione competitiva e gap di portafoglio.",
      ]).slice(0, 5),
      evidenceIds,
    }),
    block({
      kind: "evidence-list",
      items: buildCompactEvidenceLines(input.selectedInsights, 5),
      evidenceIds,
    }),
  ]);
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
function buildRetailSynthesisBlocks(
  input: {
    section?: ReportOutline["sections"][number];
    selectedInsights: InsightSpec[];
    input: PlanSlidesInput;
  },
  evidenceIds: string[],
) {
  return compactUniqueBlocks([
    block({
      kind: "callout",
      content: "La priorita non e aggiungere altre slide ma scegliere dove difendere, dove accelerare e dove ristrutturare il portafoglio.",
      tone: "positive",
      evidenceIds,
    }),
    block({
      kind: "bullet-list",
      items: buildRetailActionItems(input.selectedInsights, input.input.story, true),
      evidenceIds,
    }),
    block({
      kind: "evidence-list",
      items: buildCompactEvidenceLines(input.selectedInsights, 4),
      evidenceIds,
    }),
  ]);
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
function buildRetailRecommendationBlocks(
  input: {
    section?: ReportOutline["sections"][number];
    selectedInsights: InsightSpec[];
    input: PlanSlidesInput;
  },
  evidenceIds: string[],
) {
  return compactUniqueBlocks([
    block({
      kind: "callout",
      content: "Le azioni finali devono essere poche, esplicite e direttamente collegate ai vuoti di categoria e alle sacche di inefficienza del portafoglio.",
      tone: "positive",
      evidenceIds,
    }),
    block({
      kind: "bullet-list",
      items: buildRetailActionItems(input.selectedInsights, input.input.story, false),
      evidenceIds,
    }),
    block({
      kind: "evidence-list",
      items: input.selectedInsights.slice(0, 4).map((insight) => `${insight.title}: ${insight.businessMeaning}`),
      evidenceIds,
    }),
  ]);
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
function buildRetailHeadlineMetric(insight: InsightSpec) {
  const value =
    insight.claim.match(/\b\d+(?:[.,]\d+)?\s*mld\b/i)?.[0] ||
    insight.claim.match(/\b\d+(?:[.,]\d+)?\s*mln\b/i)?.[0] ||
    insight.claim.match(/#\d+\b/i)?.[0] ||
    insight.claim.match(/[+-]?\d+(?:[.,]\d+)?%/)?.[0];

  if (!value) {
    return null;
  }

  return {
    label: insight.title.replace(/^Nel\s+/i, "").slice(0, 30),
    value,
  };
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
function buildRetailActionItems(insights: InsightSpec[], story: StorySpec, shortMode: boolean) {
  const insightIds = new Set(insights.map((insight) => insight.id));
  const deterministicActions = compactUnique([
    insightIds.has("retail-affinity-stronghold")
      ? "Difendere Ultima nel Gatto Secco con pressione commerciale e innovazione mirata contro ONE."
      : undefined,
    insightIds.has("retail-dog-dry-issue")
      ? "Rimettere a posto il Cane Secco con una revisione di assortimento, pricing e attivazione cliente."
      : undefined,
    insightIds.has("retail-trainer-efficiency")
      ? "Ristrutturare Trainer riducendo le SKU improduttive e riallocando supporto sulle linee ad alta resa."
      : undefined,
    insightIds.has("retail-whitespace")
      ? "Decidere entro il prossimo ciclo commerciale se entrare in Nutrizione Cane Snacks/Bevande o rinunciare esplicitamente al presidio."
      : undefined,
    insightIds.has("retail-wet-opportunity")
      ? "Accelerare Gatto Umido come piattaforma di crescita, ma solo con investimenti abbastanza forti da superare la scala minima."
      : undefined,
  ]);

  const fallbackActions = shortMode ? [] : story.recommendedActions;
  return compactUnique([...deterministicActions, ...fallbackActions]).slice(0, shortMode ? 4 : 5);
}

function buildCompactEvidenceLines(insights: InsightSpec[], limit: number) {
  return compactUnique(
    insights.flatMap((insight) =>
      insight.evidence.slice(0, 3).map((evidence) => {
        const dimension = Object.values(evidence.dimensions ?? {}).find((value) => value && value !== "unknown");
        const value = formatCompactEvidenceValue(evidence.rawValue);
        const metric = evidence.metric.replace(/^retail_/, "").replaceAll("_", " ");
        return `${dimension || metric}: ${value}`;
      }),
    ),
  ).slice(0, limit);
}

function formatCompactEvidenceValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Math.abs(value) >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)} mld`;
    }
    if (Math.abs(value) >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)} mln`;
    }
    if (Math.abs(value) >= 1_000) {
      return `${(value / 1_000).toFixed(1)}k`;
    }
    return value.toFixed(value >= 100 ? 0 : 1);
  }

  return String(value ?? "n/a");
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
    selectedInsights.length === 0 || blueprint.emphasis === "cover"
      ? sanitizeAudienceCopy(story.executiveSummary) || undefined
      : undefined,
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

  const normalizedRequest = requestedLayoutId.trim().toLowerCase();
  const aliasTargets: Record<string, string[]> = {
    summary: ["two-column", "1_titel_und_inhalt", "section_header"],
    "evidence-grid": ["two-column", "1_titel_und_inhalt"],
    recommendations: ["two-column", "1_titel_und_inhalt"],
    analysis: ["two-column", "1_titel_und_inhalt"],
    cover: ["cover"],
  };

  for (const candidate of aliasTargets[normalizedRequest] ?? []) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  const byPlaceholder = templateProfile.layouts.find((layout) =>
    layout.placeholders.some((placeholder) => requestedLayoutId.includes(placeholder) || placeholder.includes(requestedLayoutId)),
  );

  const nonCoverFallback = templateProfile.layouts.find((layout) => layout.id !== "cover");
  return byPlaceholder?.id ?? nonCoverFallback?.id ?? templateProfile.layouts[0]?.id ?? requestedLayoutId;
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
