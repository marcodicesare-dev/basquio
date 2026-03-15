import { z } from "zod";

import {
  insightSpecSchema,
  type AnalyticsResult,
  type InsightSpec,
  type PackageSemantics,
  type ReportBrief,
  type StageTrace,
} from "@basquio/types";

import { generateStructuredStage } from "./model";
import { buildEvidenceId, compactUnique, scoreEvidence } from "./utils";

type RankInsightsInput = {
  analyticsResult: AnalyticsResult;
  packageSemantics: PackageSemantics;
  brief: ReportBrief;
  reviewFeedback?: string[];
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

const llmEvidenceRefSchema = z.object({
  id: z.string(),
  sourceFileId: z.string(),
  fileName: z.string(),
  fileRole: z.string(),
  sheet: z.string(),
  metric: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  sourceLocation: z.string(),
  rawValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  derivedTable: z.string().nullable(),
  dimensions: z.record(z.string(), z.string()),
});

const llmClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["thesis", "finding", "methodology", "implication", "recommendation"]),
  evidenceIds: z.array(z.string()).min(1),
  numericAssertions: z.array(
    z.object({
      evidenceId: z.string(),
      sourceFileId: z.string(),
      fileName: z.string(),
      sheet: z.string(),
      metric: z.string(),
      statistic: z.enum(["sum", "average", "min", "max", "numericCount", "distinctCount"]),
      expectedValue: z.number(),
      tolerance: z.number().min(0),
    }),
  ),
  lineage: z.object({
    insightId: z.string().nullable(),
    sectionId: z.string().nullable(),
    slideId: z.string().nullable(),
  }),
});

const llmInsightSchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1),
  title: z.string(),
  claim: z.string(),
  businessMeaning: z.string(),
  confidence: z.number().min(0).max(1),
  confidenceLabel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  finding: z.string(),
  implication: z.string(),
  evidence: z.array(llmEvidenceRefSchema).min(1),
  evidenceRefIds: z.array(z.string()),
  chartSuggestion: z.string().nullable(),
  slideEmphasis: z.enum(["lead", "support", "detail"]),
  claims: z.array(llmClaimSchema).min(1),
});

export async function rankInsights(input: RankInsightsInput, options: TraceOptions = {}): Promise<InsightSpec[]> {
  const modelId = process.env.BASQUIO_INSIGHT_MODEL || "gpt-5-mini";
  const llmResult = await generateStructuredStage({
    stage: "insight-ranking",
    schema: z.object({
      insights: z.array(llmInsightSchema).min(1).max(16),
    }),
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a senior analyst ranking findings by business relevance.",
      "Use only the pre-computed analytics and evidence refs provided below.",
      "Every claim must cite evidence ids already present in the evidence list.",
      "",
      "## Brief",
      JSON.stringify(input.brief, null, 2),
      "",
      "## Package semantics",
      JSON.stringify(input.packageSemantics, null, 2),
      "",
      "## Analytics result",
      JSON.stringify(input.analyticsResult, null, 2),
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

  if (llmResult.object?.insights && llmResult.object.insights.length > 0) {
    const validEvidenceIds = new Set(input.analyticsResult.evidenceRefs.map((evidence) => evidence.id));

    return llmResult.object.insights
      .map((insight, index) => {
        const validRefs = compactUnique(
          (insight.evidenceRefIds.length > 0 ? insight.evidenceRefIds : insight.evidence.map((evidence) => evidence.id)).filter((id) =>
            validEvidenceIds.has(id),
          ),
        );

        if (validRefs.length === 0) {
          return null;
        }

        const evidence = validRefs
          .map((id) => input.analyticsResult.evidenceRefs.find((candidate) => candidate.id === id))
          .filter((value): value is NonNullable<typeof value> => Boolean(value));

        return insightSpecSchema.parse({
          ...insight,
          chartSuggestion: insight.chartSuggestion ?? undefined,
          claims: insight.claims.map((claim) => ({
            ...claim,
            lineage: {
              insightId: claim.lineage.insightId ?? undefined,
              sectionId: claim.lineage.sectionId ?? undefined,
              slideId: claim.lineage.slideId ?? undefined,
            },
          })),
          rank: insight.rank || index + 1,
          confidence: scoreEvidence(evidence),
          confidenceLabel: validRefs.length >= 3 ? "HIGH" : validRefs.length >= 1 ? "MEDIUM" : "LOW",
          evidence,
          evidenceRefIds: validRefs,
        });
      })
      .filter((insight): insight is InsightSpec => Boolean(insight));
  }

  if (input.analyticsResult.metrics.some((metric) => metric.name.startsWith("retail_"))) {
    return buildRetailFallbackInsights(input.analyticsResult, input.brief);
  }

  return buildFallbackInsights(input.analyticsResult, input.brief);
}

function buildFallbackInsights(analyticsResult: AnalyticsResult, brief: ReportBrief): InsightSpec[] {
  const topMetrics = analyticsResult.metrics
    .map((metric) => ({
      metric,
      score: scoreInsight(metric, brief),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);

  return topMetrics.map(({ metric }, index) => {
    const evidence = metric.evidenceRefIds
      .map((id) => analyticsResult.evidenceRefs.find((candidate) => candidate.id === id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    const leadBreakout = Object.values(metric.byDimension)[0]?.[0];
    const title = leadBreakout
      ? `${humanizeMetric(metric.name)} shifts most in ${leadBreakout.key}`
      : `${humanizeMetric(metric.name)} is a lead analytical signal`;
    const claim = leadBreakout
      ? `${humanizeMetric(metric.name)} peaks at ${leadBreakout.key} with ${formatValue(leadBreakout.value)}.`
      : `${humanizeMetric(metric.name)} is materially shaping the report objective.`;
    const implication = brief.stakes
      ? `This matters because ${brief.stakes.replace(/\.$/, "").toLowerCase()}, making ${humanizeMetric(metric.name).toLowerCase()} an operating signal rather than appendix detail.`
      : `Use ${humanizeMetric(metric.name).toLowerCase()} to anchor the executive narrative and recommendations.`;

    return insightSpecSchema.parse({
      id: `insight-${metric.name}`,
      rank: index + 1,
      title,
      claim,
      businessMeaning: implication,
      finding: claim,
      implication,
      confidence: scoreEvidence(evidence),
      confidenceLabel: evidence.length >= 3 ? "HIGH" : evidence.length === 2 ? "MEDIUM" : "LOW",
      evidence,
      evidenceRefIds: evidence.map((item) => item.id),
      chartSuggestion: inferChartSuggestion(metric.name, metric.byDimension),
      slideEmphasis: index < 3 ? "lead" : index < 6 ? "support" : "detail",
      claims: [
        {
          id: buildEvidenceId({
            fileName: evidence[0]?.fileName,
            sheet: evidence[0]?.sheet || "metric",
            metric: metric.name,
            suffix: "claim",
          }),
          text: claim,
          kind: "finding",
          evidenceIds: evidence.map((item) => item.id),
          lineage: {
            insightId: `insight-${metric.name}`,
          },
        },
      ],
    });
  });
}

function buildRetailFallbackInsights(analyticsResult: AnalyticsResult, brief: ReportBrief): InsightSpec[] {
  const compartmentCurrent = getMetricMap(analyticsResult, "retail_value_current_by_comparto_ecr2");
  const marketCurrent = getMetricMap(analyticsResult, "retail_value_current_by_mercato_ecr4");
  const supplierCurrent = getMetricMap(analyticsResult, "retail_value_current_by_fornitore");
  const supplierPrior = getMetricMap(analyticsResult, "retail_value_prior_by_fornitore");
  const affinityMarketCurrent = getMetricMap(analyticsResult, "retail_affinity_value_current_by_market");
  const affinityMarketPrior = getMetricMap(analyticsResult, "retail_affinity_value_prior_by_market");
  const affinityBrandCurrent = getMetricMap(analyticsResult, "retail_affinity_value_current_by_brand");
  const affinitySkuByBrand = getMetricMap(analyticsResult, "retail_affinity_sku_count_by_brand");
  const marketBrandCurrent = getMetricMap(analyticsResult, "retail_value_current_by_market_brand");
  const marketBrandPrior = getMetricMap(analyticsResult, "retail_value_prior_by_market_brand");

  const totalMarket = sumValues(compartmentCurrent);
  const catValue = compartmentCurrent.get("PET CARE GATTO") ?? 0;
  const dogValue = compartmentCurrent.get("PET CARE CANE") ?? 0;
  const otherValue = compartmentCurrent.get("PET CARE ALTRI ANIMALI") ?? 0;
  const affinityValue = supplierCurrent.get("AFFINITY") ?? 0;
  const affinityPrior = supplierPrior.get("AFFINITY") ?? 0;
  const supplierRanking = topEntries(supplierCurrent, 10);
  const affinityRank = supplierRanking.findIndex(([name]) => name === "AFFINITY") + 1;
  const affinityShare = totalMarket > 0 ? affinityValue / totalMarket : 0;

  const strongestMarket = topEntries(
    new Map(
      [...marketCurrent.entries()]
        .filter(([, value]) => value >= 50_000_000)
        .map(([market, value]) => [market, value > 0 ? (affinityMarketCurrent.get(market) ?? 0) / value : 0]),
    ),
    1,
  )[0];
  const whitespaceMarket = topEntries(
    new Map(
      [...marketCurrent.entries()]
        .filter(([, value]) => value >= 80_000_000)
        .map(([market, value]) => [market, value * (1 - ((affinityMarketCurrent.get(market) ?? 0) / Math.max(value, 1)))]),
    ),
    1,
  )[0];
  const zeroAffinityMarket = topEntries(
    new Map(
      [...marketCurrent.entries()]
        .filter(([market, value]) => value >= 80_000_000 && (affinityMarketCurrent.get(market) ?? 0) <= 100_000)
        .map(([market, value]) => [market, value]),
    ),
    1,
  )[0];
  const ultimaValue = affinityBrandCurrent.get("ULTIMA") ?? 0;
  const trainerValue = affinityBrandCurrent.get("TRAINER") ?? 0;
  const trainerSkus = affinitySkuByBrand.get("TRAINER") ?? 0;
  const ultimaSkus = affinitySkuByBrand.get("ULTIMA") ?? 0;
  const dryCatMarket = "Nutrizione Gatto Secco";
  const dogDryMarket = "Nutrizione Cane Secco";
  const wetCatMarket = "Nutrizione Gatto Umido";
  const dryCatUltima = marketBrandCurrent.get(`${dryCatMarket} | ULTIMA`) ?? 0;
  const dryCatUltimaPrior = marketBrandPrior.get(`${dryCatMarket} | ULTIMA`) ?? 0;
  const dryCatOne = marketBrandCurrent.get(`${dryCatMarket} | ONE`) ?? 0;
  const dryCatOnePrior = marketBrandPrior.get(`${dryCatMarket} | ONE`) ?? 0;
  const dryCatMdd = sumMatchingEntries(marketBrandCurrent, `${dryCatMarket} | `, /^MDD/i);
  const dryCatMddPrior = sumMatchingEntries(marketBrandPrior, `${dryCatMarket} | `, /^MDD/i);
  const dogDryUltima = marketBrandCurrent.get(`${dogDryMarket} | ULTIMA`) ?? 0;
  const dogDryUltimaPrior = marketBrandPrior.get(`${dogDryMarket} | ULTIMA`) ?? 0;
  const wetCatUltima = marketBrandCurrent.get(`${wetCatMarket} | ULTIMA`) ?? 0;
  const wetCatUltimaPrior = marketBrandPrior.get(`${wetCatMarket} | ULTIMA`) ?? 0;

  const insights = [
    retailInsight({
      id: "retail-market-overview",
      rank: 1,
      title: "Il Pet Care Italia vale oltre 2.2 miliardi, con il gatto dominante",
      claim: `${brief.client || "Il brand"} compete in un mercato da ${formatMillions(totalMarket)}; il gatto pesa ${formatMillions(catValue)} (${formatPercent(catValue / Math.max(totalMarket, 1))}), il cane ${formatMillions(dogValue)} e gli altri animali ${formatMillions(otherValue)}.`,
      businessMeaning: "La priorita non e distribuire lo sforzo in modo uniforme: la scala e nel gatto, mentre il cane resta la principale area di recupero strategico.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_value_current_by_comparto_ecr2", "PET CARE GATTO"],
        ["retail_value_current_by_comparto_ecr2", "PET CARE CANE"],
        ["retail_value_current_by_comparto_ecr2", "PET CARE ALTRI ANIMALI"],
      ]),
      chartSuggestion: "stacked column chart for market value split plus KPI callouts",
      slideEmphasis: "lead",
    }),
    retailInsight({
      id: "retail-supplier-landscape",
      rank: 2,
      title: `Affinity e il #${affinityRank || 5} fornitore nel Pet Care italiano`,
      claim: `Affinity vale ${formatMillions(affinityValue)} con ${formatPercent(affinityShare)} di quota e cresce ${formatSignedPercent(growthRate(affinityValue, affinityPrior))}; davanti restano ${supplierRanking.slice(0, 4).map(([name]) => name).join(", ")}.`,
      businessMeaning: "La narrativa competitiva deve ancorare Affinity come challenger rilevante ma non ancora nella prima fascia: il gap da colmare e chiaro e misurabile.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_value_current_by_fornitore", "AFFINITY"],
        ["retail_value_prior_by_fornitore", "AFFINITY"],
        ["retail_value_current_by_comparto_ecr2", "PET CARE GATTO"],
        ["retail_value_current_by_comparto_ecr2", "PET CARE CANE"],
        ["retail_value_current_by_comparto_ecr2", "PET CARE ALTRI ANIMALI"],
        ...supplierRanking.slice(0, 5).map(([name]) => ["retail_value_current_rank_by_supplier", name] as const),
      ]),
      chartSuggestion: "horizontal bar chart of top suppliers with Affinity highlighted",
      slideEmphasis: "lead",
    }),
    strongestMarket
      ? retailInsight({
          id: "retail-affinity-stronghold",
          rank: 3,
          title: `${strongestMarket[0]} e il presidio piu forte di Affinity`,
          claim: `${strongestMarket[0]} vale ${formatMillions(marketCurrent.get(strongestMarket[0]) ?? 0)}; Affinity ne controlla ${formatPercent(strongestMarket[1])} con ${formatSignedPercent(growthRate(affinityMarketCurrent.get(strongestMarket[0]) ?? 0, affinityMarketPrior.get(strongestMarket[0]) ?? 0))} di crescita sul brand portfolio rilevante.`,
          businessMeaning: "Qui Basquio deve mostrare il motore di scala esistente, non solo il problema: e la base da difendere e monetizzare.",
          evidence: collectEvidence(analyticsResult, [
            ["retail_value_current_by_mercato_ecr4", strongestMarket[0]],
            ["retail_affinity_value_current_by_market", strongestMarket[0]],
            ["retail_affinity_value_prior_by_market", strongestMarket[0]],
          ]),
          chartSuggestion: "bar chart comparing market size and Affinity share in the strongest market",
          slideEmphasis: "lead",
        })
      : null,
    zeroAffinityMarket
      ? retailInsight({
          id: "retail-whitespace",
          rank: 4,
          title: `${zeroAffinityMarket[0]} e un vuoto strategico`,
          claim: `${zeroAffinityMarket[0]} vale ${formatMillions(zeroAffinityMarket[1])} e Affinity e sostanzialmente assente; e uno dei vuoti piu grandi nel portafoglio attuale.`,
          businessMeaning: "La raccomandazione finale deve trasformare questo vuoto in un'esplicita tesi di ingresso o di scelta deliberata di non presidio.",
          evidence: collectEvidence(analyticsResult, [
            ["retail_value_current_by_mercato_ecr4", zeroAffinityMarket[0]],
            ["retail_affinity_value_current_by_market", zeroAffinityMarket[0]],
          ]),
          chartSuggestion: "gap bar chart showing market value versus Affinity presence",
          slideEmphasis: "support",
        })
      : null,
    retailInsight({
      id: "retail-portfolio-concentration",
      rank: 5,
      title: "Ultima sostiene quasi tutto il business Affinity",
      claim: `Ultima genera ${formatMillions(ultimaValue)} e pesa ${formatPercent(ultimaValue / Math.max(affinityValue, 1))} del valore Affinity; Trainer vale ${formatMillions(trainerValue)} nonostante una base SKU molto piu ampia.`,
      businessMeaning: "La storia non e solo crescita: e concentrazione estrema del portafoglio, con un rischio operativo evidente se Ultima rallenta.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_affinity_value_current_by_brand", "ULTIMA"],
        ["retail_affinity_value_current_by_brand", "TRAINER"],
        ["retail_value_current_by_fornitore", "AFFINITY"],
        ["retail_affinity_sku_count_by_brand", "ULTIMA"],
        ["retail_affinity_sku_count_by_brand", "TRAINER"],
      ]),
      chartSuggestion: "portfolio bar chart with Affinity brands plus SKU efficiency overlay",
      slideEmphasis: "support",
    }),
    retailInsight({
      id: "retail-trainer-efficiency",
      rank: 6,
      title: "Trainer ha un problema strutturale di efficienza SKU",
      claim: `Trainer ha ${formatWhole(trainerSkus)} SKU per ${formatMillions(trainerValue)} di valore, contro ${formatWhole(ultimaSkus)} SKU per ${formatMillions(ultimaValue)} di Ultima; il differenziale di produttivita e enorme.`,
      businessMeaning: "Questo e il classico insight che deve diventare una slide operativa: razionalizzazione portfolio, non solo commento di performance.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_affinity_sku_count_by_brand", "TRAINER"],
        ["retail_affinity_sku_count_by_brand", "ULTIMA"],
        ["retail_affinity_value_current_by_brand", "TRAINER"],
        ["retail_affinity_value_current_by_brand", "ULTIMA"],
      ]),
      chartSuggestion: "paired KPI boxes plus efficiency comparison bar chart",
      slideEmphasis: "support",
    }),
    retailInsight({
      id: "retail-dry-cat-race",
      rank: 7,
      title: "Nel Gatto Secco la corsa con ONE e apertissima",
      claim: `Nel ${dryCatMarket} Ultima vale ${formatMillions(dryCatUltima)} e cresce ${formatSignedPercent(growthRate(dryCatUltima, dryCatUltimaPrior))}; ONE e a ${formatMillions(dryCatOne)} con ${formatSignedPercent(growthRate(dryCatOne, dryCatOnePrior))}, mentre la MDD perde ${formatSignedPercent(growthRate(dryCatMdd, dryCatMddPrior))}.`,
      businessMeaning: "Questa e la slide da vittoria selettiva: il branded sta prendendo spazio e Ultima ha gia la massa critica per giocarsi il sorpasso.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_value_current_by_market_brand", `${dryCatMarket} | ULTIMA`],
        ["retail_value_prior_by_market_brand", `${dryCatMarket} | ULTIMA`],
        ["retail_value_current_by_market_brand", `${dryCatMarket} | ONE`],
        ["retail_value_prior_by_market_brand", `${dryCatMarket} | ONE`],
        ["retail_mdd_value_current_by_market", dryCatMarket],
        ["retail_mdd_value_prior_by_market", dryCatMarket],
      ]),
      chartSuggestion: "competitive bar chart for dry cat brand ranking with MDD decline callout",
      slideEmphasis: "support",
    }),
    retailInsight({
      id: "retail-branded-shift",
      rank: 8,
      title: "La MDD perde terreno nelle aree chiave",
      claim: `Nel ${dryCatMarket} la MDD vale ${formatMillions(dryCatMdd)} e flette ${formatSignedPercent(growthRate(dryCatMdd, dryCatMddPrior))}; lo stesso pattern si vede anche nel ${dogDryMarket}, creando spazio per i brand.`,
      businessMeaning: "La tesi strategica non e solo su Affinity: c'e un trend strutturale pro-branded che rende il timing migliore di quanto direbbe la sola quota attuale.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_mdd_value_current_by_market", dryCatMarket],
        ["retail_mdd_value_prior_by_market", dryCatMarket],
        ["retail_mdd_value_current_by_market", dogDryMarket],
        ["retail_mdd_value_prior_by_market", dogDryMarket],
      ]),
      chartSuggestion: "stacked 100% comparison of MDD versus branded across priority markets",
      slideEmphasis: "detail",
    }),
    retailInsight({
      id: "retail-dog-dry-issue",
      rank: 9,
      title: "Il Cane Secco resta il principale allarme operativo",
      claim: `Nel ${dogDryMarket} Ultima si ferma a ${formatMillions(dogDryUltima)} e cala ${formatSignedPercent(growthRate(dogDryUltima, dogDryUltimaPrior))} in un mercato gia in contrazione; la quota resta intorno al ${formatPercent(dogDryUltima / Math.max(marketCurrent.get(dogDryMarket) ?? 1, 1))}.`,
      businessMeaning: "Serve una slide di allarme chiara: il cane non e un tema secondario ma la principale area in cui l'azienda oggi sottoperforma.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_value_current_by_mercato_ecr4", dogDryMarket],
        ["retail_value_current_by_market_brand", `${dogDryMarket} | ULTIMA`],
        ["retail_value_prior_by_market_brand", `${dogDryMarket} | ULTIMA`],
      ]),
      chartSuggestion: "ranking table plus negative trend bars for dog dry",
      slideEmphasis: "detail",
    }),
    retailInsight({
      id: "retail-wet-opportunity",
      rank: 10,
      title: "L'Umido Gatto cresce ma Affinity parte ancora piccola",
      claim: `Nel ${wetCatMarket} Ultima cresce ${formatSignedPercent(growthRate(wetCatUltima, wetCatUltimaPrior))} ma parte da ${formatMillions(wetCatUltima)} su un mercato da ${formatMillions(marketCurrent.get(wetCatMarket) ?? 0)}.`,
      businessMeaning: "E una classica accelerazione da incubare: segnale positivo, ma base ancora troppo piccola per spostare davvero il business senza investimenti mirati.",
      evidence: collectEvidence(analyticsResult, [
        ["retail_value_current_by_mercato_ecr4", wetCatMarket],
        ["retail_value_current_by_market_brand", `${wetCatMarket} | ULTIMA`],
        ["retail_value_prior_by_market_brand", `${wetCatMarket} | ULTIMA`],
      ]),
      chartSuggestion: "side-by-side market versus Affinity growth bars for wet cat",
      slideEmphasis: "detail",
    }),
    whitespaceMarket
      ? retailInsight({
          id: "retail-strategic-map",
          rank: 11,
          title: "La mappa strategica e tra difesa del gatto e recupero dei gap",
          claim: `Le priorita si dividono tra difendere il presidio in ${strongestMarket?.[0] ?? "Gatto Secco"} e aprire spazi nei mercati sottopresidiati come ${whitespaceMarket[0]}.`,
          businessMeaning: "Questa sintesi deve portare naturalmente a una slide finale con priorita: difendere, accelerare, ristrutturare, esplorare.",
          evidence: collectEvidence(analyticsResult, [
            ["retail_value_current_by_mercato_ecr4", whitespaceMarket[0]],
            strongestMarket ? ["retail_affinity_value_current_by_market", strongestMarket[0]] as const : null,
          ].filter(Boolean) as ReadonlyArray<readonly [string, string]>),
          chartSuggestion: "strategic priority matrix with defend and explore quadrants",
          slideEmphasis: "detail",
        })
      : null,
  ].filter((insight): insight is InsightSpec => Boolean(insight));

  return insights.slice(0, 12).map((insight, index) => ({
    ...insight,
    rank: index + 1,
    slideEmphasis: index < 3 ? "lead" : index < 7 ? "support" : "detail",
  }));
}

function retailInsight(input: {
  id: string;
  rank: number;
  title: string;
  claim: string;
  businessMeaning: string;
  evidence: ReturnType<typeof collectEvidence>;
  chartSuggestion: string;
  slideEmphasis: InsightSpec["slideEmphasis"];
}) {
  const evidence = input.evidence.slice(0, 6);
  const evidenceIds = evidence.map((item) => item.id);
  return insightSpecSchema.parse({
    id: input.id,
    rank: input.rank,
    title: input.title,
    claim: input.claim,
    businessMeaning: input.businessMeaning,
    finding: input.claim,
    implication: input.businessMeaning,
    confidence: scoreEvidence(evidence),
    confidenceLabel: evidence.length >= 3 ? "HIGH" : evidence.length >= 1 ? "MEDIUM" : "LOW",
    evidence,
    evidenceRefIds: evidenceIds,
    chartSuggestion: input.chartSuggestion,
    slideEmphasis: input.slideEmphasis,
    claims: [
      {
        id: `${input.id}-claim`,
        text: input.claim,
        kind: "finding",
        evidenceIds,
        lineage: {
          insightId: input.id,
        },
      },
    ],
  });
}

function getMetricMap(analyticsResult: AnalyticsResult, metricName: string) {
  const table = analyticsResult.derivedTables.find((candidate) => candidate.name === `${metricName}_table`);
  return new Map(
    (table?.rows ?? [])
      .map((row) => {
        const numericValue = typeof row.value === "number" ? row.value : Number(row.value);
        return [String(row.key ?? "unknown"), Number.isFinite(numericValue) ? numericValue : 0] as const;
      }),
  );
}

function collectEvidence(
  analyticsResult: AnalyticsResult,
  selectors: ReadonlyArray<readonly [string, string]>,
) {
  const matched = selectors.flatMap(([metricName, key]) =>
    analyticsResult.evidenceRefs.filter((evidence) =>
      evidence.metric === metricName &&
      (
        Object.values(evidence.dimensions ?? {}).some((value) => value === key) ||
        evidence.summary.includes(key)
      ),
    ),
  );

  if (matched.length > 0) {
    return matched;
  }

  return selectors.flatMap(([metricName]) =>
    analyticsResult.evidenceRefs.filter((evidence) => evidence.metric === metricName),
  );
}

function topEntries(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function sumValues(map: Map<string, number>) {
  return [...map.values()].reduce((total, value) => total + value, 0);
}

function sumMatchingEntries(map: Map<string, number>, keyPrefix: string, keyPattern: RegExp) {
  return [...map.entries()]
    .filter(([key]) => key.startsWith(keyPrefix) && keyPattern.test(key.split(" | ")[1] ?? ""))
    .reduce((total, [, value]) => total + value, 0);
}

function growthRate(current: number, prior: number) {
  if (!prior) {
    return 0;
  }

  return (current - prior) / prior;
}

function formatMillions(value: number) {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} mld`;
  }

  return `${(value / 1_000_000).toFixed(1)} mln`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number) {
  const numeric = value * 100;
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function formatWhole(value: number) {
  return Math.round(value).toLocaleString("it-IT");
}

function humanizeMetric(value: string) {
  return value.replaceAll("_", " ");
}

function formatValue(value: number) {
  if (Math.abs(value) <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }

  return value.toFixed(2);
}

function inferChartSuggestion(metricName: string, byDimension: InsightSpec["evidenceRefIds"] | AnalyticsResult["metrics"][number]["byDimension"]) {
  const dimensionKey = typeof byDimension === "object" ? Object.keys(byDimension)[0] : "";
  if (metricName.includes("delta") || dimensionKey.includes("date") || dimensionKey.includes("month")) {
    return "line chart showing period-over-period change";
  }

  return "comparison bar chart of the leading grouped values";
}

function scoreInsight(metric: AnalyticsResult["metrics"][number], brief: ReportBrief) {
  let score = 0;

  const overallValue = typeof metric.overallValue === "number" ? metric.overallValue : Number(metric.overallValue);
  const cv = metric.stddev / Math.abs(overallValue || 1);
  score += Math.min(cv * 10, 30);

  const nameWords = metric.name.toLowerCase().split(/[_\s]+/);
  const objectiveWords = (brief.objective || "").toLowerCase().split(/\s+/);
  const overlap = nameWords.filter((word) => objectiveWords.includes(word)).length;
  score += overlap * 15;

  const evidenceCount = metric.evidenceRefIds.length;
  score += Math.min(evidenceCount * 2, 20);

  const dimensionCount = Object.keys(metric.byDimension).length;
  score += dimensionCount * 5;

  const firstDim = Object.values(metric.byDimension)[0];
  if (firstDim && firstDim.length >= 3) {
    const sorted = firstDim.map((dimension) => dimension.value).sort((left, right) => right - left);
    const topBottomRatio = sorted[0] / (sorted[sorted.length - 1] || 1);
    score += Math.min(topBottomRatio * 2, 20);
  }

  return score;
}
