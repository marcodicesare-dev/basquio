import type { EvidenceWorkspace } from "@basquio/types";

export type DomainKnowledgeStage =
  | "analyst"
  | "storyline"
  | "author"
  | "critic"
  | "strategic-critic";

export type DomainKnowledgePackId = "niq-storymasters-fmcg";

type DomainKnowledgeMatch = {
  packId: DomainKnowledgePackId;
  score: number;
  activated: boolean;
  matchedBriefCues: string[];
  matchedDataCues: string[];
  matchedNegativeCues: string[];
};

const FMCG_POSITIVE_CUES = [
  "fmcg",
  "cpg",
  "consumer packaged goods",
  "retail",
  "grocery",
  "brand",
  "category",
  "shopper",
  "trade marketing",
  "trade",
  "channel",
  "distribution",
  "share",
  "velocity",
  "rotation",
  "promo",
  "promotion",
  "pack",
  "sku",
  "upc",
  "pos",
  "rms",
  "category management",
  "assortment",
  "shelf",
  "sell-in",
  "sell out",
  "loyalty",
  "buyer",
  "household",
  "segment",
  "market",
  "brand mix",
];

const FMCG_DATA_CUES = [
  "marca",
  "brand",
  "fornitore",
  "manufacturer",
  "retailer",
  "category",
  "comparto",
  "famiglia",
  "segment",
  "channel",
  "share",
  "sales",
  "value",
  "valore",
  "volume",
  "packs",
  "confezioni",
  "price",
  "distribution",
  "velocity",
  "rotation",
  "promo",
  "pack",
  "sku",
  "upc",
  "shopper",
  "panel",
  "pet care",
  "nielseniq",
  "market",
];

const FMCG_NEGATIVE_CUES = [
  "stock market",
  "equity research",
  "capital markets",
  "fundraising",
  "business plan",
  "startup financial model",
  "saas roadmap",
  "engineering planning",
  "product requirements",
  "crypto",
  "portfolio optimization",
];

function normalize(value: string) {
  return value.toLowerCase();
}

function collectCueMatches(haystack: string, cues: string[]) {
  const normalized = normalize(haystack);
  return cues.filter((cue) => normalized.includes(cue));
}

function collectWorkspaceText(workspace: EvidenceWorkspace) {
  const inventory = workspace.fileInventory.flatMap((file) => {
    const sheetBits = file.sheets.flatMap((sheet) => [
      sheet.name,
      ...sheet.columns.map((column) => column.name),
    ]);

    return [
      file.fileName,
      file.kind,
      file.role,
      file.mediaType,
      ...file.warnings,
      ...sheetBits,
    ];
  });

  return inventory.filter(Boolean).join(" ");
}

export function scoreDomainKnowledgePacks(args: {
  workspace?: EvidenceWorkspace;
  brief: string;
}): DomainKnowledgeMatch[] {
  const workspaceText = args.workspace ? collectWorkspaceText(args.workspace) : "";
  const briefMatches = collectCueMatches(args.brief, FMCG_POSITIVE_CUES);
  const dataMatches = collectCueMatches(workspaceText, FMCG_DATA_CUES);
  const negativeMatches = collectCueMatches(`${args.brief} ${workspaceText}`, FMCG_NEGATIVE_CUES);

  const score = briefMatches.length * 2 + dataMatches.length - negativeMatches.length * 3;
  const activated =
    negativeMatches.length === 0 &&
    ((briefMatches.length >= 1 && dataMatches.length >= 1) || dataMatches.length >= 3);

  return [{
    packId: "niq-storymasters-fmcg",
    score,
    activated,
    matchedBriefCues: briefMatches,
    matchedDataCues: dataMatches,
    matchedNegativeCues: negativeMatches,
  }];
}

const STAGE_PAYLOADS: Record<DomainKnowledgeStage, string> = {
  analyst: `Use an NIQ-style FMCG / category storytelling lens only if the brief and evidence are clearly retail or CPG.

- Frame the work around the true commercial question, not a generic summary.
- Classify findings into connection, contradiction, and curiosity before you synthesize.
- Look first for category size, segment mix, brand role, concentration, whitespace, and current-vs-prior movement.
- In FMCG / CPG contexts, typical action levers are share, distribution, rotation, promotion, pack or format, retailer, channel, buyer, and loyalty.
- Do not hardcode currency symbols. Infer unit and currency from the dataset or brief and keep them as formatting semantics.
- Favor hypotheses like market structure, mix mismatch, hero dependence, whitespace capture, renovation need, and retailer-specific opportunity over generic reporting.`,
  storyline: `Use NIQ StoryMasters framing for relevant FMCG / CPG runs.

- Build the story as SCQA: situation, complication, question, answer.
- DEFAULT is DEDUCTIVE: answer first (slide 2 exec summary), then prove it with evidence. Use deductive when audience is senior, time-poor, or decision-driven — this is the default for Basquio.
- Only use INDUCTIVE (context first, answer last) if the brief explicitly asks for a data walkthrough or educational exploration.
- Distill findings into 3-4 POVs or supporting implications, not a pile of facts.
- Every major section should ladder from what, to so what, to now what.
- Recommendations should be prioritized by size of prize, feasibility, ease, time horizon, and fit with strategy.`,
  author: `Use NIQ StoryMasters slide logic for relevant FMCG / CPG runs.

- Raw findings are not enough; each slide must resolve what happened, why it matters, and what to do.
- Choose chart type from the question, not from available columns:
  - ranking across categories -> horizontal bar
  - current vs prior across a few items -> grouped bar or dumbbell
  - mix or composition -> stacked / 100% stacked
  - trend over time only -> line
  - concentration / hero dependence -> ranked table or pareto
- Never use line or area charts for unordered category buckets.
- Humanize raw FMCG labels. Shorten SKU or category names into readable business labels; do not dump raw machine strings.
- Memo slides are allowed only when the action cannot be shown more clearly with an exhibit.
- Never hardcode currency symbols such as euro or dollar; infer display formatting from the evidence and brief.`,
  critic: `Apply NIQ factual review logic for relevant FMCG / CPG runs.

- Flag chart forms that do not match the business question.
- Flag decks that confuse raw findings with recommendation logic.
- Flag jargon-heavy raw SKU labels or untranslated machine labels when they hurt readability.
- Check that category, brand, and SKU slides resolve to commercial levers rather than generic observations.`,
  "strategic-critic": `Apply NIQ StoryMasters narrative review for relevant FMCG / CPG runs.

- Check that the deck asks the true commercial question.
- Check that POVs synthesize evidence instead of repeating descriptive findings.
- Check that recommendations are quantified, prioritized, and tied to real levers such as share, distribution, rotation, retailer, pack, or channel.
- Flag memo-heavy decks where visuals should carry the argument.
- Flag decks that bury the so-what or now-what in prose.`,
};

export function buildDomainKnowledgeContext(args: {
  workspace?: EvidenceWorkspace;
  brief: string;
  stage: DomainKnowledgeStage;
}) {
  const pack = scoreDomainKnowledgePacks(args)
    .filter((match) => match.activated)
    .sort((left, right) => right.score - left.score)[0];

  if (!pack) {
    return "";
  }

  const matchedSignals = [
    ...pack.matchedBriefCues.slice(0, 4),
    ...pack.matchedDataCues.slice(0, 6),
  ];

  return `## DOMAIN KNOWLEDGE PACK: NIQ STORYMASTERS FMCG

Activated because this run looks like FMCG / CPG / retail / category work.
Matched signals: ${matchedSignals.join(", ")}

${STAGE_PAYLOADS[args.stage]}`;
}
