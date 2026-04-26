import { z } from "zod";

import {
  exhibitPresentationSpecSchema,
  metricPresentationSpecSchema,
} from "@basquio/types";

export const deckManifestSchema = z.object({
  slideCount: z.number().int().min(0),
  pageCount: z.number().int().min(0).optional(),
  slides: z.array(z.object({
    position: z.number().int().min(1),
    layoutId: z.string().default("title-body"),
    slideArchetype: z.string().default("title-body"),
    pageIntent: z.string().optional(),
    title: z.string(),
    subtitle: z.string().optional(),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    metrics: z.array(z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      presentation: metricPresentationSpecSchema.optional(),
    })).optional(),
    callout: z.object({
      text: z.string(),
      tone: z.enum(["accent", "green", "orange"]).optional(),
    }).optional(),
    recommendationBlock: z.object({
      condition: z.string().optional(),
      recommendation: z.string().optional(),
      quantification: z.string().optional(),
    }).optional(),
    evidenceIds: z.array(z.string()).optional(),
    chartId: z.string().optional(),
    hasDataTable: z.boolean().optional(),
    hasChartAnnotations: z.boolean().optional(),
  })).default([]),
  charts: z.array(z.object({
    id: z.string(),
    chartType: z.string(),
    title: z.string(),
    xAxisLabel: z.string().optional(),
    yAxisLabel: z.string().optional(),
    bubbleSizeLabel: z.string().optional(),
    sourceNote: z.string().optional(),
    excelSheetName: z.string().optional(),
    excelChartCellAnchor: z.string().optional(),
    dataSignature: z.string().optional(),
    categoryCount: z.number().int().min(0).optional(),
    categories: z.array(z.string()).optional(),
    seriesCount: z.number().int().min(0).optional(),
    presentation: exhibitPresentationSpecSchema.optional(),
  })).default([]),
}).passthrough();

export type DeckManifest = z.infer<typeof deckManifestSchema>;

export function parseDeckManifest(input: unknown): DeckManifest {
  return deckManifestSchema.parse(normalizeDeckManifest(input));
}

function normalizeDeckManifest(input: unknown) {
  const record = asRecord(input);
  const rawSlides = readArray(record.slides);
  const zeroBasedSlidePositions = usesZeroBasedSlidePositions(rawSlides);
  const slides = rawSlides.map((slide, index) => normalizeSlide(slide, index, zeroBasedSlidePositions));
  const rawCharts = readArray(record.charts);
  const charts = repairManifestChartIds(slides, rawCharts.map(normalizeChart));

  return {
    ...record,
    slideCount:
      readNumber(record.slideCount) ??
      readNumber(record.slide_count) ??
      slides.length,
    pageCount: readNumber(record.pageCount) ?? readNumber(record.page_count),
    slides,
    charts,
  };
}

function normalizeSlide(input: unknown, index: number, zeroBasedSlidePositions = false) {
  const record = asRecord(input);
  const fallbackLayoutId =
    readString(record.layoutId) ??
    readString(record.layout_id) ??
    readString(record.layout) ??
    readString(record.slideArchetype) ??
    readString(record.slide_archetype) ??
    readString(record.archetype) ??
    "title-body";

  return {
    ...record,
    position: normalizeSlidePosition(
      readNumber(record.position) ??
      readNumber(record.index) ??
      readNumber(record.order),
      index,
      zeroBasedSlidePositions,
    ),
    layoutId: fallbackLayoutId,
    slideArchetype:
      readString(record.slideArchetype) ??
      readString(record.slide_archetype) ??
      readString(record.archetype) ??
      fallbackLayoutId,
    title: readString(record.title) ?? `Slide ${index + 1}`,
    subtitle: readString(record.subtitle),
    body: readString(record.body),
    pageIntent: readString(record.pageIntent) ?? readString(record.page_intent),
    bullets: readStringArray(record.bullets),
    metrics: normalizeMetrics(record.metrics),
    callout: normalizeCallout(record.callout),
    recommendationBlock: normalizeRecommendationBlock(record.recommendationBlock ?? record.recommendation_block),
    evidenceIds: readStringArray(record.evidenceIds) ?? readStringArray(record.evidence_ids),
    chartId:
      readString(record.chartId) ??
      readString(record.chart_id),
    hasDataTable: readBoolean(record.hasDataTable) ?? readBoolean(record.has_data_table),
    hasChartAnnotations:
      readBoolean(record.hasChartAnnotations) ??
      readBoolean(record.has_chart_annotations),
  };
}

function normalizeRecommendationBlock(input: unknown) {
  const record = asRecord(input);
  const condition = readString(record.condition);
  const recommendation = readString(record.recommendation);
  const quantification = readString(record.quantification);
  if (!condition && !recommendation && !quantification) {
    return undefined;
  }

  return {
    ...(condition ? { condition } : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(quantification ? { quantification } : {}),
  };
}

function normalizeSlidePosition(value: number | undefined, index: number, zeroBasedSlidePositions: boolean) {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (zeroBasedSlidePositions && value >= 0) {
      return value + 1;
    }
    if (value >= 1) {
      return value;
    }
  }

  return index + 1;
}

function usesZeroBasedSlidePositions(slides: unknown[]) {
  const positions = slides
    .map((slide) => {
      const record = asRecord(slide);
      return readNumber(record.position) ?? readNumber(record.index) ?? readNumber(record.order);
    })
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value));

  return positions.length > 0 &&
    positions.includes(0) &&
    positions.every((position) => position >= 0 && position <= Math.max(0, slides.length - 1));
}

function normalizeChart(input: unknown, index: number) {
  const record = asRecord(input);
  return {
    ...record,
    id: readString(record.id) ?? `chart-${index + 1}`,
    chartType:
      readString(record.chartType) ??
      readString(record.chart_type) ??
      readString(record.type) ??
      "bar",
    title: readString(record.title) ?? `Chart ${index + 1}`,
    xAxisLabel: readString(record.xAxisLabel) ?? readString(record.x_axis_label),
    yAxisLabel: readString(record.yAxisLabel) ?? readString(record.y_axis_label),
    bubbleSizeLabel: readString(record.bubbleSizeLabel) ?? readString(record.bubble_size_label),
    sourceNote: readString(record.sourceNote) ?? readString(record.source_note),
    excelSheetName: normalizeExcelSheetName(readString(record.excelSheetName) ?? readString(record.excel_sheet_name)),
    excelChartCellAnchor: readString(record.excelChartCellAnchor) ?? readString(record.excel_chart_cell_anchor),
    dataSignature: readString(record.dataSignature) ?? readString(record.data_signature),
    categoryCount: readNumber(record.categoryCount) ?? readNumber(record.category_count),
    categories: readStringArray(record.categories),
    seriesCount: readNumber(record.seriesCount) ?? readNumber(record.series_count),
    presentation: parseOptionalSchema(
      exhibitPresentationSpecSchema,
      record.presentation ?? record.exhibitPresentation ?? record.exhibit_presentation,
    ),
  };
}

function repairManifestChartIds(
  slides: Array<{ chartId?: string }>,
  charts: Array<{ id: string } & Record<string, unknown>>,
) {
  const existingChartIds = new Set(charts.map((chart) => chart.id));
  const orderedSlideChartIds = slides
    .map((slide) => slide.chartId?.trim())
    .filter((value): value is string => Boolean(value));
  const missingSlideChartIds = orderedSlideChartIds.filter((chartId) => !existingChartIds.has(chartId));

  if (missingSlideChartIds.length === 0) {
    return charts;
  }

  const dedupedMissingIds: string[] = [];
  for (const chartId of missingSlideChartIds) {
    if (!dedupedMissingIds.includes(chartId)) {
      dedupedMissingIds.push(chartId);
    }
  }

  const referencedChartIds = new Set(
    orderedSlideChartIds.filter((chartId) => existingChartIds.has(chartId)),
  );
  const remappableCharts = charts.filter((chart) => !referencedChartIds.has(chart.id));
  if (remappableCharts.length < dedupedMissingIds.length) {
    return charts;
  }

  const orderedRemapTargets = remappableCharts
    .filter((chart) => looksGenericChartId(chart.id))
    .concat(remappableCharts.filter((chart) => !looksGenericChartId(chart.id)));
  if (orderedRemapTargets.length < dedupedMissingIds.length) {
    return charts;
  }

  const idRemap = new Map<string, string>();
  for (let index = 0; index < dedupedMissingIds.length; index += 1) {
    const sourceChart = orderedRemapTargets[index];
    const targetChartId = dedupedMissingIds[index];
    if (!sourceChart || existingChartIds.has(targetChartId)) {
      continue;
    }
    idRemap.set(sourceChart.id, targetChartId);
    existingChartIds.add(targetChartId);
  }

  if (idRemap.size === 0) {
    return charts;
  }

  return charts.map((chart) => (
    idRemap.has(chart.id)
      ? {
          ...chart,
          id: idRemap.get(chart.id)!,
        }
      : chart
  ));
}

function looksGenericChartId(value: string) {
  return /^chart[-_ ]?\d+$/i.test(value.trim());
}

function normalizeMetrics(input: unknown) {
  const metrics = readArray(input);
  if (!metrics) {
    return undefined;
  }

  return metrics.map((metric, index) => {
    const record = asRecord(metric);
    return {
      label: readString(record.label) ?? `Metric ${index + 1}`,
      value: readString(record.value) ?? String(record.value ?? ""),
      delta: readString(record.delta),
      presentation: parseOptionalSchema(
        metricPresentationSpecSchema,
        record.presentation ?? record.metricPresentation ?? record.metric_presentation,
      ),
    };
  });
}

function normalizeCallout(input: unknown) {
  const record = asRecord(input);
  const text = readString(record.text) ?? readString(record.value);
  if (!text) {
    return undefined;
  }

  const tone = readString(record.tone);
  return {
    text,
    tone: tone === "accent" || tone === "green" || tone === "orange" ? tone : undefined,
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function readArray(input: unknown) {
  return Array.isArray(input) ? input : [];
}

function readString(input: unknown) {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined;
}

function readNumber(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function readBoolean(input: unknown) {
  return typeof input === "boolean" ? input : undefined;
}

function readStringArray(input: unknown) {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const values = input.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function normalizeExcelSheetName(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const sanitized = value
    .replace(/[\\/?*\[\]:]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);

  return sanitized.length > 0 ? sanitized : undefined;
}

function parseOptionalSchema<T>(schema: z.ZodType<T>, input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? result.data : undefined;
}
