import { z } from "zod";

import {
  reportOutlineSchema,
  storySpecSchema,
  type AnalyticsResult,
  type InsightSpec,
  type PackageSemantics,
  type ReportBrief,
  type ReportOutline,
  type StageTrace,
  type StorySpec,
} from "@basquio/types";

import { generateStructuredStage } from "./model";
import {
  cleanFragment,
  compactUnique,
  extractRequestedSlideCount,
  getBusinessInsights,
  makeNarrativeTitle,
  sanitizeAudienceCopy,
} from "./utils";

type PlanStoryInput = {
  analyticsResult: AnalyticsResult;
  insights: InsightSpec[];
  packageSemantics: PackageSemantics;
  brief: ReportBrief;
  reviewFeedback?: string[];
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

const llmReportSectionSchema = z.object({
  id: z.string(),
  kind: z.enum(["framing", "methodology", "findings", "implications", "recommendations", "analysis", "appendix"]),
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  supportingInsightIds: z.array(z.string()),
  emphasis: z.enum(["heavy", "standard", "light"]),
  suggestedSlideCount: z.number().int().min(1),
});

const llmStorySpecSchema = z.object({
  client: z.string(),
  audience: z.string(),
  objective: z.string(),
  thesis: z.string(),
  stakes: z.string(),
  title: z.string(),
  executiveSummary: z.string(),
  narrativeArcType: z.enum(["opportunity", "threat", "transformation", "validation", "discovery"]),
  narrativeArc: z.array(z.string()).min(1),
  keyMessages: z.array(z.string()).min(1),
  sections: z.array(llmReportSectionSchema),
  recommendedSlideCount: z.number().int().min(1),
  recommendedActions: z.array(z.string()),
});

export async function planStory(input: PlanStoryInput, options: TraceOptions = {}): Promise<StorySpec> {
  const modelId = process.env.BASQUIO_STORY_MODEL || "claude-sonnet-4-6";
  const llmResult = await generateStructuredStage({
    stage: "story-architect",
    schema: llmStorySpecSchema,
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a report strategist designing an executive narrative arc.",
      "Use only the ranked insights, package semantics, and brief below.",
      "",
      "## Brief",
      JSON.stringify(input.brief, null, 2),
      "",
      "## Package semantics",
      JSON.stringify(input.packageSemantics, null, 2),
      "",
      "## Deterministic analytics",
      JSON.stringify(input.analyticsResult, null, 2),
      "",
      "## Ranked insights",
      JSON.stringify(input.insights, null, 2),
      "",
      ...(input.reviewFeedback?.length
        ? [
            "## Reviewer feedback to address",
            ...input.reviewFeedback.map((item) => `- ${item}`),
          ]
        : []),
    ].join("\n"),
  });
  options.onTrace?.(llmResult.trace);

  if (llmResult.object) {
    return storySpecSchema.parse(llmResult.object);
  }

  return buildFallbackStory(input);
}

export function planReportOutline(input: {
  story: StorySpec;
  insights: InsightSpec[];
  brief: ReportBrief;
}): ReportOutline {
  if (input.story.sections.length > 0) {
    return reportOutlineSchema.parse({
      title: input.story.title,
      sections: input.story.sections,
    });
  }

  return reportOutlineSchema.parse({
    title: input.story.title,
    sections: buildDynamicSections(input.insights, input.brief, input.story),
  });
}

function buildFallbackStory(input: PlanStoryInput) {
  const businessInsights = getBusinessInsights(input.insights);
  const leadInsight = businessInsights[0] ?? input.insights[0];
  const narrativeArcType = inferNarrativeArcType(input.brief, leadInsight);
  const requestedSlideCount = extractRequestedSlideCount(input.brief, 12);
  const safeStakes = sanitizeAudienceCopy(input.brief.stakes);
  const safeThesis = sanitizeAudienceCopy(input.brief.thesis);
  const title = makeNarrativeTitle(input.brief, "Basquio executive report");
  const executiveSummary = compactUnique([
    leadInsight?.finding || leadInsight?.claim,
    leadInsight?.implication || leadInsight?.businessMeaning,
    safeStakes ? `Act now because ${cleanFragment(safeStakes).toLowerCase()}.` : undefined,
  ])
    .slice(0, 3)
    .join(" ");
  const sections = buildDynamicSections(businessInsights, input.brief, {
    title,
    executiveSummary,
    keyMessages: compactUnique([
      leadInsight?.title,
      ...businessInsights.slice(0, 3).map((insight) => insight.businessMeaning),
    ]).slice(0, 4),
    recommendedActions: compactUnique([
      businessInsights[0]?.businessMeaning,
      businessInsights[1]?.businessMeaning,
      safeStakes ? `Prioritize actions that reduce risk against ${cleanFragment(safeStakes).toLowerCase()}.` : undefined,
    ]).slice(0, 4),
  });
  const keyMessages = compactUnique([
    leadInsight?.title,
    ...businessInsights.slice(0, 3).map((insight) => insight.businessMeaning),
  ]).slice(0, 4);
  const recommendedActions = compactUnique([
    businessInsights[0]?.businessMeaning,
    businessInsights[1]?.businessMeaning,
    safeStakes ? `Prioritize actions that reduce risk against ${cleanFragment(safeStakes).toLowerCase()}.` : undefined,
  ]).slice(0, 4);

  return storySpecSchema.parse({
    client: input.brief.client,
    audience: input.brief.audience,
    objective: input.brief.objective,
    thesis: safeThesis || leadInsight?.claim || executiveSummary,
    stakes: input.brief.stakes,
    title,
    executiveSummary,
    narrativeArcType,
    narrativeArc: buildNarrativeArc(businessInsights, input.brief, narrativeArcType),
    keyMessages,
    sections,
    recommendedSlideCount: Math.max(requestedSlideCount, sections.reduce((total, section) => total + section.suggestedSlideCount, 0)),
    recommendedActions,
  });
}

/** @deprecated Legacy v1 retail/FMCG logic. Not used by v2 pipeline. */
function buildRetailSections(
  insights: InsightSpec[],
  brief: ReportBrief,
  targetSlideCount: number,
  title: string,
  executiveSummary: string,
) {
  const sections: ReportSection[] = [
    {
      id: "section-cover",
      kind: "framing",
      title,
      summary: executiveSummary || brief.objective,
      objective: `Orient ${brief.audience.toLowerCase()} to the headline market signal.`,
      supportingInsightIds: insights.slice(0, 1).map((insight) => insight.id),
      emphasis: "heavy",
      suggestedSlideCount: 1,
    },
    {
      id: "section-executive-summary",
      kind: "findings",
      title: "Sintesi esecutiva",
      summary: executiveSummary || brief.objective,
      objective: "Summarize where the business wins, where it suffers, and why it matters now.",
      supportingInsightIds: insights.slice(0, 3).map((insight) => insight.id),
      emphasis: "heavy",
      suggestedSlideCount: 1,
    },
  ];

  const remainingInsightSlots = Math.max(0, targetSlideCount - 3);
  const chosenInsights = insights.slice(0, remainingInsightSlots);

  for (const [index, insight] of chosenInsights.entries()) {
    sections.push({
      id: `section-retail-${index + 1}`,
      kind: index < 4 ? "findings" : "analysis",
      title: insight.title,
      summary: insight.finding || insight.claim,
      objective: insight.businessMeaning || "Convert evidence into a reportable business point of view.",
      supportingInsightIds: [insight.id],
      emphasis: index < 3 ? "heavy" : "standard",
      suggestedSlideCount: 1,
    });
  }

  sections.push({
    id: "section-recommendations",
    kind: "recommendations",
    title: "Azioni chiave",
    summary: insights[0]?.businessMeaning || brief.stakes || "Convert the analysis into action.",
    objective: "Close with practical priorities grounded in the evidence.",
    supportingInsightIds: insights.slice(0, 4).map((insight) => insight.id),
    emphasis: "standard",
    suggestedSlideCount: 1,
  });

  while (sections.reduce((total, section) => total + section.suggestedSlideCount, 0) < targetSlideCount) {
    sections.splice(sections.length - 1, 0, {
      id: `section-synthesis-${sections.length}`,
      kind: "implications",
      title: "Sintesi strategica",
      summary: brief.thesis || brief.objective,
      objective: "Bridge the findings into a concise decision frame before the final actions.",
      supportingInsightIds: insights.slice(0, 3).map((insight) => insight.id),
      emphasis: "light",
      suggestedSlideCount: 1,
    });
  }

  return sections;
}

function buildDynamicSections(
  insights: InsightSpec[],
  brief: ReportBrief,
  story: Pick<StorySpec, "executiveSummary" | "keyMessages" | "recommendedActions" | "title">,
) {
  const businessInsights = getBusinessInsights(insights);
  const leadInsights = businessInsights.filter((insight) => insight.slideEmphasis === "lead");
  const supportInsights = businessInsights.filter((insight) => insight.slideEmphasis === "support");
  const detailedInsights = insights.filter((insight) => insight.slideEmphasis === "detail");
  const primaryInsights = leadInsights.length > 0 ? leadInsights : businessInsights.slice(0, 4);
  const sections: ReportSection[] = [
    {
      id: "section-framing",
      kind: "framing",
      title: story.title || "Executive framing",
      summary: story.executiveSummary || brief.objective,
      objective: `Orient ${brief.audience.toLowerCase()} to the main signal and stakes.`,
      supportingInsightIds: primaryInsights.slice(0, 1).map((insight) => insight.id),
      emphasis: primaryInsights.length > 1 ? "heavy" : "standard",
      suggestedSlideCount: 1,
    },
  ];

  for (const [index, chunk] of chunkInsights(primaryInsights, 2).entries()) {
    const first = chunk[0];
    sections.push({
      id: `section-findings-${index + 1}`,
      kind: index === 0 ? "findings" : "analysis",
      title: first?.title || `Evidence cluster ${index + 1}`,
      summary: chunk.map((insight) => insight.finding || insight.claim).join(" "),
      objective:
        index === 0
          ? `Establish the primary evidence backbone for ${brief.objective.toLowerCase()}.`
          : "Extend the analysis with the next strongest cluster of evidence.",
      supportingInsightIds: chunk.map((insight) => insight.id),
      emphasis: index === 0 ? "heavy" : "standard",
      suggestedSlideCount: Math.max(1, chunk.length),
    });
  }

  if (supportInsights.length > 0 || story.keyMessages.length > 1) {
    sections.push({
      id: "section-implications",
      kind: "implications",
      title: brief.stakes ? "Business implications" : "Implications",
      summary:
        supportInsights[0]?.businessMeaning ||
        supportInsights[0]?.implication ||
        story.keyMessages[1] ||
        "Translate the strongest evidence into business consequence.",
      objective: "Explain why the evidence matters now.",
      supportingInsightIds: supportInsights.slice(0, 3).map((insight) => insight.id),
      emphasis: supportInsights.length > 1 ? "standard" : "light",
      suggestedSlideCount: Math.max(1, Math.min(3, supportInsights.length || 1)),
    });
  }

  if (detailedInsights.length > 0) {
    sections.push({
      id: "section-detail-analysis",
      kind: "analysis",
      title: "Supporting analysis",
      summary: detailedInsights.slice(0, 2).map((insight) => insight.title).join(" | "),
      objective: "Preserve supporting proof without forcing every detail into the main arc.",
      supportingInsightIds: detailedInsights.slice(0, 4).map((insight) => insight.id),
      emphasis: "light",
      suggestedSlideCount: Math.min(2, Math.max(1, Math.ceil(detailedInsights.length / 3))),
    });
  }

  if (story.recommendedActions.length > 0 || brief.stakes) {
    sections.push({
      id: "section-recommendations",
      kind: "recommendations",
      title: "Recommended actions",
      summary: story.recommendedActions[0] || brief.stakes || "Convert evidence into action.",
      objective: "Close with practical next steps grounded in the evidence.",
      supportingInsightIds: businessInsights.slice(0, 2).map((insight) => insight.id),
      emphasis: "standard",
      suggestedSlideCount: Math.max(1, Math.min(3, story.recommendedActions.length || 1)),
    });
  }

  return sections;
}

type ReportSection = ReportOutline["sections"][number];

function chunkInsights(insights: InsightSpec[], size: number) {
  const chunks: InsightSpec[][] = [];
  for (let index = 0; index < insights.length; index += size) {
    chunks.push(insights.slice(index, index + size));
  }
  return chunks;
}

function inferNarrativeArcType(brief: ReportBrief, leadInsight?: InsightSpec) {
  const haystack = [brief.stakes, brief.objective, leadInsight?.title, leadInsight?.implication]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("risk") || haystack.includes("decline") || haystack.includes("gap")) {
    return "threat" as const;
  }

  if (haystack.includes("grow") || haystack.includes("opportunity")) {
    return "opportunity" as const;
  }

  if (haystack.includes("validate")) {
    return "validation" as const;
  }

  return "discovery" as const;
}

function buildNarrativeArc(
  insights: InsightSpec[],
  brief: ReportBrief,
  arcType: StorySpec["narrativeArcType"],
) {
  const lead = insights[0];
  const support = insights.slice(1, 4);
  const totalFindings = insights.length;
  const safeObjective = sanitizeAudienceCopy(brief.objective) || brief.objective;
  const safeThesis = sanitizeAudienceCopy(brief.thesis) || lead?.title || safeObjective;
  const safeStakes = sanitizeAudienceCopy(brief.stakes) || "competitive position";

  switch (arcType) {
    case "threat":
      return [
        `${brief.client || "The client"} faces ${articleize(lead?.title.toLowerCase() || "a material risk")} that directly impacts ${safeStakes}.`,
        `Across ${totalFindings} findings, the data shows ${joinClauses(support.map((insight) => insight.title.toLowerCase()))}.`,
        `The evidence points to ${firstSentence(lead?.implication || lead?.businessMeaning).toLowerCase()}.`,
        `Without action on ${firstClause(lead?.title || safeObjective).toLowerCase()}, the gap will widen.`,
      ];
    case "opportunity":
      return [
        `${brief.client || "The client"} has an untapped opportunity: ${(lead?.title || safeObjective).toLowerCase()}.`,
        `The data reveals ${totalFindings} reinforcing signals, led by ${support[0]?.title.toLowerCase() || "strong performance indicators"}.`,
        `${firstSentence(lead?.implication || lead?.businessMeaning)}.`,
        `Capturing this requires focused action on ${joinClauses(insights.slice(0, 3).map((insight) => firstClause(insight.title).toLowerCase()))}.`,
      ];
    case "discovery":
      return [
        `An unexpected pattern emerged: ${(lead?.title || safeObjective).toLowerCase()}.`,
        `This challenges the assumption that ${safeThesis.toLowerCase()}, revealing ${support[0]?.title.toLowerCase() || "a different picture"}.`,
        `${totalFindings} findings confirm this is not noise: ${firstSentence(lead?.finding || lead?.claim).toLowerCase()}.`,
        `The strategic implication is ${firstSentence(lead?.implication || lead?.businessMeaning).toLowerCase()}.`,
      ];
    case "validation":
      return [
        `${brief.client || "The client"} now has evidence validating ${(safeThesis || lead?.title || safeObjective).toLowerCase()}.`,
        `${totalFindings} findings reinforce the thesis, including ${joinClauses(support.map((insight) => insight.title.toLowerCase()))}.`,
        `${firstSentence(lead?.finding || lead?.claim)}.`,
        `The recommended next step is to act on ${joinClauses(insights.slice(0, 2).map((insight) => firstClause(insight.title).toLowerCase()))}.`,
      ];
    case "transformation":
      return [
        `${brief.client || "The client"} is in the middle of a measurable shift: ${(lead?.title || safeObjective).toLowerCase()}.`,
        `The data traces this change through ${joinClauses(support.map((insight) => insight.title.toLowerCase()))}.`,
        `${firstSentence(lead?.finding || lead?.claim)}.`,
        `The transformation only compounds if leadership acts on ${joinClauses(insights.slice(0, 3).map((insight) => firstClause(insight.title).toLowerCase()))}.`,
      ];
    default:
      return [
        `${lead?.title || safeObjective}.`,
        `${totalFindings} findings support this conclusion, with ${support.length} reinforcing signals.`,
        `${firstSentence(lead?.implication || lead?.businessMeaning)}.`,
        "Action items follow from the strongest evidence-backed findings.",
      ];
  }
}

function firstSentence(value: string) {
  return value.split(".")[0]?.trim() || value;
}

function firstClause(value: string) {
  return value.split("—")[0]?.trim() || value;
}

function joinClauses(values: string[]) {
  const filtered = values.filter(Boolean);
  if (filtered.length === 0) return "reinforcing signals";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}

function articleize(value: string) {
  if (/^(a|an|the)\s/i.test(value)) {
    return value;
  }

  return `a ${value}`;
}
