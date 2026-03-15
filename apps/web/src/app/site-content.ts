export const heroSignals = ["Traceable numbers", "Branded PPTX + PDF", "Brief-aware narrative"] as const;

export const trustSignals = ["Strategy teams", "Research leads", "Brand managers", "Agencies"] as const;

export const pipelineSteps = [
  {
    stage: "01",
    title: "Upload files",
    detail: "Data, brief, brand",
  },
  {
    stage: "02",
    title: "Parse and profile",
    detail: "Structure and relationships",
  },
  {
    stage: "03",
    title: "Compute analytics",
    detail: "Computed from your data",
  },
  {
    stage: "04",
    title: "Rank insights",
    detail: "Insights with proof",
  },
  {
    stage: "05",
    title: "Plan narrative",
    detail: "Tailored to your audience",
  },
  {
    stage: "06",
    title: "Render deck",
    detail: "PPTX plus PDF",
  },
] as const;

export const proofPoints = [
  {
    label: "Evidence",
    title: "Every number traced to source",
    kind: "evidence",
  },
  {
    label: "Brand",
    title: "Your brand, not ours",
    kind: "brand",
  },
  {
    label: "System",
    title: "Story by AI. Math by code.",
    kind: "system",
  },
] as const;

export const landingComparisonRows = [
  {
    label: "Data analysis",
    genericAi: "No",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "Hallucination risk",
    genericAi: "High",
    slideGenerators: "Medium",
    basquio: "None",
  },
  {
    label: "Brand control",
    genericAi: "No",
    slideGenerators: "Limited",
    basquio: "Yes",
  },
  {
    label: "Output quality",
    genericAi: "Draft",
    slideGenerators: "Template",
    basquio: "Executive",
  },
] as const;

export const detailedComparisonRows = [
  {
    label: "Multi-file evidence packages",
    genericAi: "Weak",
    slideGenerators: "Weak",
    basquio: "Strong",
  },
  {
    label: "Deterministic computation",
    genericAi: "No",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "Evidence provenance",
    genericAi: "Unclear",
    slideGenerators: "Unclear",
    basquio: "Built in",
  },
  {
    label: "Audience-aware narrative",
    genericAi: "Prompt dependent",
    slideGenerators: "Light",
    basquio: "Planned",
  },
  {
    label: "Editable PPTX",
    genericAi: "Inconsistent",
    slideGenerators: "Yes",
    basquio: "Yes",
  },
  {
    label: "Polished PDF",
    genericAi: "Manual",
    slideGenerators: "Varies",
    basquio: "Yes",
  },
  {
    label: "Brand-system control",
    genericAi: "Weak",
    slideGenerators: "Template-first",
    basquio: "Strong",
  },
  {
    label: "Review-ready output",
    genericAi: "Draft",
    slideGenerators: "Template",
    basquio: "Executive",
  },
] as const;

export const howItWorksStages = [
  {
    stage: "01",
    title: "Intake and parse",
    copy:
      "Upload the evidence package, report brief, and design target. Basquio preserves file identity and role hints before analysis begins.",
    contract: "DatasetProfile",
  },
  {
    stage: "02",
    title: "Template interpretation",
    copy:
      "Template and brand inputs become a reusable profile for colors, fonts, layout constraints, and source fingerprints.",
    contract: "TemplateProfile",
  },
  {
    stage: "03",
    title: "Package semantics",
    copy:
      "The system infers entities, time grains, relationships, and answerable questions across files instead of guessing from filenames.",
    contract: "PackageSemantics",
  },
  {
    stage: "04",
    title: "Metric planning",
    copy:
      "The model decides what should be computed. The output is an explicit metric plan before any number appears in the story.",
    contract: "ExecutableMetricSpec[]",
  },
  {
    stage: "05",
    title: "Deterministic analytics",
    copy:
      "Code executes the metric plan, materializes derived tables, and keeps evidence references attached to every substantive result.",
    contract: "AnalyticsResult",
  },
  {
    stage: "06",
    title: "Insight ranking",
    copy:
      "Candidate findings are ranked by relevance, confidence, and usefulness for the audience and thesis in the brief.",
    contract: "InsightSpec[]",
  },
  {
    stage: "07",
    title: "Narrative planning",
    copy:
      "The report arc is planned from context to implication, with client, objective, audience, thesis, and stakes represented explicitly.",
    contract: "StorySpec + ReportOutline",
  },
  {
    stage: "08",
    title: "Slide architecture",
    copy:
      "Layouts, blocks, charts, and notes are bound against template constraints before anything is rendered into a deck.",
    contract: "SlideSpec[]",
  },
  {
    stage: "09",
    title: "Critique, render, deliver",
    copy:
      "Deterministic and semantic validation gate the render, then Basquio produces paired PPTX and PDF artifacts with trace metadata.",
    contract: "ValidationReport + ArtifactManifest",
  },
] as const;

export const aboutPrinciples = [
  {
    title: "Intelligence first",
    copy: "Basquio wins on package understanding, analytics planning, insight ranking, and report architecture.",
  },
  {
    title: "Evidence on every claim",
    copy: "The product promise is not generic AI prose. It is deterministic analysis with full evidence provenance.",
  },
  {
    title: "One story, two deliverables",
    copy: "Editable PPTX and polished PDF come from the same canonical slide plan instead of diverging export paths.",
  },
] as const;

export const publicNavLinks = [
  {
    href: "/how-it-works",
    label: "How it works",
  },
  {
    href: "/compare",
    label: "Compare",
  },
  {
    href: "/for",
    label: "Who it's for",
  },
  {
    href: "/about",
    label: "About",
  },
] as const;

export const personas = [
  {
    slug: "brand-managers",
    title: "Brand Managers",
    summary: "Turn recurring trackers into executive-ready category stories.",
    challenge: "You need clean narrative, tight brand control, and numbers that survive leadership review.",
    outcome: "Basquio turns raw trackers, campaign readouts, and category files into branded decks leadership can use.",
    bestFor: ["Category reviews", "Campaign performance decks", "Share and trend reporting"],
  },
  {
    slug: "consultants",
    title: "Consultants",
    summary: "Compress analysis and deck-building into one report flow.",
    challenge: "You need faster first drafts without losing the rigor clients expect from consulting outputs.",
    outcome: "Basquio handles deterministic analysis, narrative structure, and paired deliverables so teams can focus on judgment.",
    bestFor: ["Weekly client updates", "Competitive intelligence", "Executive steering packs"],
  },
  {
    slug: "strategy-teams",
    title: "Strategy Teams",
    summary: "Go from evidence package to decision-ready storyline faster.",
    challenge: "You need to synthesize messy inputs, rank what matters, and present a clear recommendation under time pressure.",
    outcome: "Basquio helps strategy teams turn evidence into a coherent arc instead of spending days rebuilding the deck.",
    bestFor: ["Board prep", "Business reviews", "Growth and market scans"],
  },
  {
    slug: "agencies",
    title: "Agencies",
    summary: "Scale recurring reporting without flattening the brand.",
    challenge: "You need repeatable production with enough flexibility to respect different client narratives and design systems.",
    outcome: "Basquio supports repeatable analytical reporting while keeping brand, evidence, and deliverables aligned.",
    bestFor: ["Monthly client reporting", "White-label deliverables", "Insight-led renewal decks"],
  },
] as const;

export const personaMap = new Map(personas.map((persona) => [persona.slug, persona]));
