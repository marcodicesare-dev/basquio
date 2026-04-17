export type SlidePlanLintInput = {
  position: number;
  role?: string;
  layoutId?: string;
  slideArchetype?: string;
  title: string;
  body?: string;
  governingThought?: string;
  focalObject?: string;
  pageIntent?: string;
  chartId?: string;
  chartType?: string;
  categories?: string[];
  categoryCount?: number;
  evidenceIds?: string[];
};

export type SlidePlanPairViolation = {
  rule: string;
  severity: "critical" | "major" | "minor";
  message: string;
  positions: [number, number];
  similarity: number;
  sharedDimensions: string[];
};

export type SlidePlanDeckViolation = {
  rule: string;
  severity: "critical" | "major" | "minor";
  message: string;
};

export type SlidePlanLintResult = {
  passed: boolean;
  pairViolations: SlidePlanPairViolation[];
  deckViolations: SlidePlanDeckViolation[];
  uniqueDimensions: string[];
  minRequiredDimensions: number;
  deepestLevel: number;
  chapterDepths: Array<{ chapter: string; deepestLevel: number }>;
};

type EnrichedSlide = SlidePlanLintInput & {
  text: string;
  tokens: Set<string>;
  dimensions: string[];
  primaryDimension: string;
  decompositionLevel: number;
  chapter: string;
  pageIntentNormalized: string;
};

const STOPWORDS = new Set([
  "about", "after", "before", "between", "brand", "brands", "category", "client", "data", "della",
  "delle", "degli", "dello", "dentro", "dove", "each", "evidence", "findings", "from", "have",
  "market", "nelle", "nella", "other", "performance", "same", "segment", "segments", "share",
  "slide", "slides", "sono", "that", "their", "there", "these", "this", "through", "totale",
  "trend", "with", "without", "your",
]);

const DIMENSION_DEFINITIONS: Array<{ id: string; keywords: string[] }> = [
  { id: "segment", keywords: ["segment", "segments", "comparto", "famiglia", "family", "sub-segment", "wet", "dry", "reconstituted"] },
  { id: "channel", keywords: ["channel", "channels", "super", "hyper", "discount", "online", "drug", "convenience", "grocery"] },
  { id: "format", keywords: ["format", "formats", "pack", "packs", "size", "sizes", "multipack", "single", "sharing", "canister"] },
  { id: "brand", keywords: ["brand", "brands", "marca", "supplier", "competitor", "portfolio"] },
  { id: "sku", keywords: ["sku", "skus", "item", "items", "top 10", "top 5", "top 3", "pareto", "hero sku"] },
  { id: "flavour", keywords: ["flavour", "flavor", "taste", "variant", "variety"] },
  { id: "promo", keywords: ["promo", "promotion", "promotional", "lift", "incremental", "baseline"] },
  { id: "price", keywords: ["price", "pricing", "price index", "premium", "mainstream", "economy", "price ladder"] },
  { id: "distribution", keywords: ["distribution", "acv", "numeric distribution", "weighted distribution", "availability", "listings"] },
  { id: "retailer", keywords: ["retailer", "retailers", "insegna", "store", "stores", "banner", "customer"] },
  { id: "geography", keywords: ["geography", "geo", "region", "regions", "area", "areas", "country", "countries", "territory"] },
  { id: "occasion", keywords: ["occasion", "occasions", "daypart", "usage"] },
  { id: "shopper", keywords: ["shopper", "shoppers", "buyer", "buyers", "household", "households", "penetration", "loyalty", "cohort"] },
  { id: "recommendation", keywords: ["recommendation", "recommendations", "priority", "priorities", "roadmap", "action", "actions"] },
  { id: "methodology", keywords: ["methodology", "appendix", "definitions", "data quality", "sources", "assumptions"] },
  { id: "sensitivity", keywords: ["scenario", "scenarios", "sensitivity", "simulation", "impact bridge", "waterfall"] },
];

const DIMENSION_PRIORITY = [
  "segment",
  "brand",
  "channel",
  "format",
  "retailer",
  "sku",
  "flavour",
  "price",
  "promo",
  "distribution",
  "geography",
  "occasion",
  "shopper",
  "sensitivity",
  "recommendation",
  "methodology",
] as const;

const COVERAGE_DIMENSIONS = new Set([
  "segment",
  "channel",
  "format",
  "brand",
  "sku",
  "flavour",
  "promo",
  "price",
  "distribution",
  "retailer",
  "geography",
  "occasion",
  "shopper",
  "sensitivity",
]);

export function lintSlidePlan(
  rawSlides: SlidePlanLintInput[],
  targetSlideCount: number,
): SlidePlanLintResult {
  const slides = rawSlides
    .filter((slide) => slide && Number.isFinite(slide.position) && typeof slide.title === "string")
    .sort((left, right) => left.position - right.position)
    .map(enrichSlide);

  const pairViolations: SlidePlanPairViolation[] = [];
  for (let index = 0; index < slides.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < slides.length; compareIndex += 1) {
      const left = slides[index];
      const right = slides[compareIndex];
      if (isStructuralSlide(left) || isStructuralSlide(right)) {
        continue;
      }

      const similarity = computeDataCutSimilarity(left, right);
      if (similarity < 0.7) {
        continue;
      }

      const sharedDimensions = left.dimensions.filter((dimension) => right.dimensions.includes(dimension));
      pairViolations.push({
        rule: "redundant_data_cut",
        severity: similarity >= 0.82 ? "critical" : "major",
        message:
          `Slides ${left.position} and ${right.position} appear to answer the same leaf question ` +
          `(${sharedDimensions.join(", ") || "same content cut"}). Replace broadening with a deeper drill-down.`,
        positions: [left.position, right.position],
        similarity: Number(similarity.toFixed(2)),
        sharedDimensions,
      });
    }
  }

  const uniqueDimensions = [...new Set(
    slides.flatMap((slide) => slide.dimensions.filter((dimension) => COVERAGE_DIMENSIONS.has(dimension))),
  )];
  const minRequiredDimensions = requiredDimensionCoverage(targetSlideCount);
  const analyticalSlides = slides.filter((slide) => !isStructuralSlide(slide));
  const deepestLevel = analyticalSlides.reduce(
    (maxLevel, slide) => Math.max(maxLevel, slide.decompositionLevel),
    1,
  );

  const chapterDepths = [...new Map(
    analyticalSlides.map((slide) => [slide.chapter, slide.chapter]),
  ).values()].map((chapter) => ({
    chapter,
    deepestLevel: analyticalSlides
      .filter((slide) => slide.chapter === chapter)
      .reduce((maxLevel, slide) => Math.max(maxLevel, slide.decompositionLevel), 1),
  }));

  const deckViolations: SlidePlanDeckViolation[] = [];
  if (uniqueDimensions.length < minRequiredDimensions) {
    deckViolations.push({
      rule: "drilldown_dimension_coverage",
      severity: targetSlideCount >= 41 ? "major" : "minor",
      message:
        `Deck covers ${uniqueDimensions.length} drill-down dimensions but ${minRequiredDimensions} are required ` +
        `for ${targetSlideCount} slides.`,
    });
  }

  if (targetSlideCount >= 41 && deepestLevel < 3) {
    deckViolations.push({
      rule: "insufficient_decomposition_depth",
      severity: "major",
      message: `Deck only reaches L${deepestLevel}. Decks above 40 slides must reach at least L3 drill-down depth.`,
    });
  }

  const shallowChapters = chapterDepths
    .filter((entry) => !["Recommendations", "Appendix", "General"].includes(entry.chapter) && entry.deepestLevel < 3);
  if (targetSlideCount >= 41 && shallowChapters.length > 0) {
    deckViolations.push({
      rule: "chapter_depth_shallow",
      severity: "minor",
      message: `These chapters do not reach L3 drill-down depth: ${shallowChapters.map((entry) => entry.chapter).join(", ")}.`,
    });
  }

  return {
    passed: pairViolations.every((violation) => violation.severity !== "critical")
      && deckViolations.every((violation) => violation.severity !== "critical"),
    pairViolations,
    deckViolations,
    uniqueDimensions,
    minRequiredDimensions,
    deepestLevel,
    chapterDepths,
  };
}

function enrichSlide(slide: SlidePlanLintInput): EnrichedSlide {
  const text = [
    slide.title,
    slide.body,
    slide.governingThought,
    slide.focalObject,
    slide.pageIntent,
    ...(slide.categories ?? []),
  ].filter(Boolean).join(" ");
  const dimensions = inferDimensions(slide, text);
  return {
    ...slide,
    text,
    tokens: tokenize(text),
    dimensions,
    primaryDimension: inferPrimaryDimension(dimensions),
    decompositionLevel: inferDecompositionLevel(slide, dimensions, text),
    chapter: inferChapter(dimensions, slide, text),
    pageIntentNormalized: (slide.pageIntent ?? "").trim().toLowerCase(),
  };
}

function inferDimensions(slide: SlidePlanLintInput, text: string) {
  const haystack = normalize(text);
  const matched = DIMENSION_DEFINITIONS
    .filter((definition) => definition.keywords.some((keyword) => haystack.includes(keyword)))
    .map((definition) => definition.id);

  if ((slide.pageIntent ?? "").toLowerCase().includes("recommend")) {
    matched.push("recommendation");
  }
  if ((slide.title ?? "").match(/\bappendix|methodology|data quality|definitions\b/i)) {
    matched.push("methodology");
  }
  if (matched.length === 0) {
    matched.push("general");
  }

  return [...new Set(matched)];
}

function inferPrimaryDimension(dimensions: string[]) {
  return DIMENSION_PRIORITY.find((dimension) => dimensions.includes(dimension))
    ?? dimensions[0]
    ?? "general";
}

function inferDecompositionLevel(slide: SlidePlanLintInput, dimensions: string[], text: string) {
  const normalized = normalize(text);
  if (dimensions.includes("methodology")) return 1;
  if (dimensions.includes("recommendation")) return 4;
  if (dimensions.includes("sku") || dimensions.includes("occasion") || dimensions.includes("shopper") || dimensions.includes("sensitivity")) return 4;
  if (
    dimensions.includes("retailer") ||
    dimensions.includes("price") ||
    dimensions.includes("promo") ||
    dimensions.includes("distribution") ||
    /within|driven by|because|why|driver|root cause|perch[eé]|guidat[oaie]|spint[oaie]/i.test(normalized)
  ) {
    return 3;
  }
  if (
    dimensions.includes("segment") ||
    dimensions.includes("brand") ||
    dimensions.includes("channel") ||
    dimensions.includes("format") ||
    dimensions.includes("flavour") ||
    dimensions.includes("geography")
  ) {
    return 2;
  }
  if ((slide.position ?? 99) <= 2 || /overview|summary|market|category total|headline/i.test(normalized)) {
    return 1;
  }
  return Math.min(4, Math.max(1, dimensions.length));
}

function inferChapter(dimensions: string[], slide: SlidePlanLintInput, text: string) {
  const normalized = normalize(text);
  if (dimensions.includes("recommendation")) return "Recommendations";
  if (dimensions.includes("methodology")) return "Appendix";
  if (/market|category|overview|summary/.test(normalized)) return "Market";
  if (dimensions.some((dimension) => ["segment", "format", "flavour"].includes(dimension))) return "Segments";
  if (dimensions.some((dimension) => ["brand", "sku"].includes(dimension))) return "Brand & Portfolio";
  if (dimensions.some((dimension) => ["channel", "retailer", "distribution"].includes(dimension))) return "Channels & Retailers";
  if (dimensions.some((dimension) => ["price", "promo", "sensitivity"].includes(dimension))) return "Commercial Levers";
  if ((slide.role ?? "").toLowerCase().includes("summary")) return "Market";
  return "General";
}

function tokenize(text: string) {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9àèéìòù]+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  );
}

function computeDataCutSimilarity(left: EnrichedSlide, right: EnrichedSlide) {
  const tokenSimilarity = jaccard(left.tokens, right.tokens);
  const sharedDimensions = left.dimensions.filter((dimension) => right.dimensions.includes(dimension));
  const sharedDimensionScore = sharedDimensions.length / Math.max(left.dimensions.length, right.dimensions.length, 1);
  const samePrimary = left.primaryDimension === right.primaryDimension ? 0.18 : 0;
  const sameLevel = left.decompositionLevel === right.decompositionLevel ? 0.12 : 0;
  const sameIntent = left.pageIntentNormalized && left.pageIntentNormalized === right.pageIntentNormalized ? 0.05 : 0;
  const sameFocalObject = left.focalObject && right.focalObject && normalize(left.focalObject) === normalize(right.focalObject) ? 0.08 : 0;
  const progressiveDisclosureDiscount =
    sharedDimensions.length > 0 &&
    Math.abs(left.decompositionLevel - right.decompositionLevel) >= 1 &&
    (left.dimensions.length !== right.dimensions.length || left.primaryDimension !== right.primaryDimension)
      ? 0.12
      : 0;

  return clamp01(
    tokenSimilarity * 0.52 +
    sharedDimensionScore * 0.25 +
    samePrimary +
    sameLevel +
    sameIntent +
    sameFocalObject -
    progressiveDisclosureDiscount,
  );
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}

function requiredDimensionCoverage(targetSlideCount: number) {
  if (targetSlideCount <= 20) return 4;
  if (targetSlideCount <= 40) return 7;
  if (targetSlideCount <= 60) return 10;
  return 14;
}

function isStructuralSlide(slide: EnrichedSlide) {
  const role = (slide.role ?? "").toLowerCase();
  const layout = (slide.layoutId ?? slide.slideArchetype ?? "").toLowerCase();
  return role === "cover" || role === "section-divider" || layout === "cover" || layout === "section-divider";
}

function normalize(text: string) {
  return text.toLowerCase();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
