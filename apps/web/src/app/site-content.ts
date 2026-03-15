export const heroSignals = ["Traceable numbers", "Branded PPTX + PDF", "Story shaped for your audience"] as const;

export const trustSignals = ["Strategy teams", "Research leads", "Brand managers", "Agencies"] as const;

export const rolloutSignals = [
  "Founder-led setup",
  "Private workspaces",
  "Editable PPTX + PDF",
  "Start with one live review",
] as const;

export const evidencePackageInputs = [
  "CSVs and spreadsheets",
  "Support PDFs and notes",
  "Report brief",
  "Brand tokens or template",
] as const;

export const gettingStartedSteps = [
  {
    title: "Bring one reporting cycle",
    detail: "Upload the CSVs, spreadsheets, PDFs, and brand files behind one review.",
  },
  {
    title: "Write the brief",
    detail: "Tell Basquio who the audience is, what matters, and what decision the deck should support.",
  },
  {
    title: "Review the first output",
    detail: "Start from a ready-to-edit PPTX and a polished PDF instead of a blank slide.",
  },
] as const;

export const pipelineSteps = [
  {
    stage: "01",
    title: "Upload files",
    detail: "Data, brief, brand",
  },
  {
    stage: "02",
    title: "Understand the package",
    detail: "Structure and relationships",
  },
  {
    stage: "03",
    title: "Compute the numbers",
    detail: "Math from your data",
  },
  {
    stage: "04",
    title: "Rank what matters",
    detail: "Insights with proof",
  },
  {
    stage: "05",
    title: "Shape the story",
    detail: "Built for your audience",
  },
  {
    stage: "06",
    title: "Deliver the deck",
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
    label: "Checks the math first",
    genericAi: "No",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "Editable PowerPoint",
    genericAi: "Partial",
    slideGenerators: "Yes",
    basquio: "Yes",
  },
  {
    label: "Matches your brand",
    genericAi: "Partial",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Ready for stakeholder review",
    genericAi: "No",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
] as const;

export const detailedComparisonRows = [
  {
    label: "Understands more than one file",
    genericAi: "No",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Checks the math before writing the story",
    genericAi: "No",
    slideGenerators: "No",
    basquio: "Yes",
  },
  {
    label: "Every number traceable to source",
    genericAi: "No",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Story shaped for your audience",
    genericAi: "Partial",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Editable PowerPoint output",
    genericAi: "Partial",
    slideGenerators: "Yes",
    basquio: "Yes",
  },
  {
    label: "Polished PDF output",
    genericAi: "Partial",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Respects your brand system",
    genericAi: "Partial",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
  {
    label: "Ready for leadership or client review",
    genericAi: "No",
    slideGenerators: "Partial",
    basquio: "Yes",
  },
] as const;

export const comparisonColumnNotes = [
  "Generic AI = language-first tools that can draft slides or copy.",
  "Slide generators = presentation tools that help with layout and formatting.",
  "Basquio = analysis-first reporting built for review-ready PPTX and PDF output.",
] as const;

export const howItWorksPhases = [
  {
    stage: "01",
    title: "Upload one evidence package",
    copy:
      "Bring the CSVs, spreadsheets, PDFs, briefs, and brand files behind one reporting cycle. Basquio treats them as one package instead of one disconnected upload at a time.",
  },
  {
    stage: "02",
    title: "Compute what matters",
    copy:
      "Basquio reads the package, works out how the files connect, and computes the numbers before it starts writing the story.",
  },
  {
    stage: "03",
    title: "Build the narrative",
    copy:
      "The deck is shaped around your audience, objective, and point of view so the story lands in the room it is meant for.",
  },
  {
    stage: "04",
    title: "Deliver both formats",
    copy:
      "You get an editable PowerPoint and a polished PDF from the same analysis, with source references attached to the claims that matter.",
  },
] as const;

export const howItWorksChecks = [
  "Numbers checked before delivery",
  "Charts and claims tied back to source data",
  "Brand input carried through both PPTX and PDF",
] as const;

export const aboutStory = {
  title: "Basquio was built for teams that still have to defend the story after the analysis is done.",
  paragraphs: [
    "Basquio started from a simple frustration: the analysis was often already there, but the team still had to rebuild the deck by hand, recheck the numbers, rewrite the narrative, and restyle everything for the next review.",
    "The product is being built by Marco Di Cesare inside Loamly to shorten that loop. The goal is not to automate judgment away. The goal is to help good teams move from evidence to a review-ready story faster, with less manual deck work and fewer chances to lose the thread.",
  ],
} as const;

export const aboutPrinciples = [
  {
    title: "Start from evidence",
    copy: "Basquio begins with the real files behind the reporting cycle, not a blank prompt and a hope that the story will hold.",
  },
  {
    title: "Check the numbers before the slides",
    copy: "The product computes the math first, then shapes the narrative around what the data can actually support.",
  },
  {
    title: "Make output usable on day one",
    copy: "The goal is a deck people can review, edit, share, and present without rebuilding it from scratch.",
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

export const personaSelectionPoints = [
  "You build recurring review decks, not one-off presentations.",
  "You pull from more than one file or source every cycle.",
  "The audience cares about both the story and the numbers behind it.",
  "Brand quality matters before the deck leaves the team.",
] as const;

export const personas = [
  {
    slug: "brand-managers",
    title: "Brand Managers",
    summary: "Turn trackers into leadership-ready category stories.",
    challenge: "You already have the numbers. The real work is turning them into a clean story that leadership can scan quickly and trust.",
    heroTitle: "Turn recurring trackers into leadership-ready category stories.",
    heroCopy:
      "Brand teams live inside recurring category reviews, campaign readouts, and share updates. Basquio helps turn those files into a deck that reads clearly without losing the proof.",
    bestWhen: [
      "You run monthly or quarterly business reviews.",
      "You need the deck to match the brand.",
      "You are translating tracker data for senior stakeholders.",
    ],
    pressureTitle: "Where the work usually slows down",
    pressureCopy:
      "The numbers may already exist, but the deck still takes days: cleaning the story, checking which shifts matter, and reformatting everything into a leadership-ready narrative.",
    packageTitle: "A typical package",
    packageCopy:
      "Sales trackers, share tables, campaign summaries, retailer notes, and a template from the team that will present the story.",
    valueTitle: "What Basquio gives back",
    valueCopy:
      "A first draft that already knows what changed, where the pressure sits, and how to frame it for leadership review in your own visual system.",
    valuePoints: ["Category reviews", "Campaign performance updates", "Brand health or share decks"],
    ctaTitle: "Bring your next category review.",
    ctaCopy: "Start with the files behind one review cycle and see how the story comes together.",
    secondaryHref: "/compare",
    secondaryLabel: "Compare the alternatives",
  },
  {
    slug: "consultants",
    title: "Consultants",
    summary: "Compress analysis and deck-building into one report flow.",
    challenge: "Clients expect the numbers to be right and the narrative to be sharp. The pressure comes from doing both quickly under deadline.",
    heroTitle: "Compress analysis and deck-building into one report flow.",
    heroCopy:
      "Consulting teams lose time moving from analysis to slides, especially when the files are messy and the client expects a polished deck fast. Basquio shortens that handoff.",
    bestWhen: [
      "You need a faster first draft before internal review.",
      "You are working from several client files at once.",
      "You still need an editable deck at the end.",
    ],
    pressureTitle: "Where the work usually slows down",
    pressureCopy:
      "The team has to turn working analysis into a client-ready storyline, check every claim, and rebuild the same narrative in PowerPoint under tight timelines.",
    packageTitle: "A typical package",
    packageCopy:
      "Client spreadsheets, interview notes, market tables, supporting PDFs, and a slide template that the final team can continue editing.",
    valueTitle: "What Basquio gives back",
    valueCopy:
      "A tighter first pass on the structure, storyline, and supporting numbers so the team spends more time improving the recommendation and less time rebuilding the deck.",
    valuePoints: ["Client steering packs", "Competitive reviews", "Weekly or monthly updates"],
    ctaTitle: "Use one client package as the starting point.",
    ctaCopy: "Bring the files behind the next working session and see how much deck work Basquio can absorb.",
    secondaryHref: "/how-it-works",
    secondaryLabel: "See how the workflow runs",
  },
  {
    slug: "strategy-teams",
    title: "Strategy Teams",
    summary: "Go from evidence package to decision-ready storyline faster.",
    challenge: "Strategy teams often sit between messy evidence and a room that wants one clear recommendation. The time sink is stitching the case together.",
    heroTitle: "Go from evidence package to decision-ready storyline faster.",
    heroCopy:
      "When the review is high stakes, the hardest part is often not the spreadsheet itself. It is deciding which signals matter, what the room should care about, and how to present that clearly.",
    bestWhen: [
      "You are preparing for a business review or decision meeting.",
      "You need to synthesize several evidence sources quickly.",
      "You want the first story pass before manual deck work begins.",
    ],
    pressureTitle: "Where the work usually slows down",
    pressureCopy:
      "Teams spend hours deciding what the room should focus on, cutting noise out of the deck, and making sure the recommendation stays grounded in the evidence.",
    packageTitle: "A typical package",
    packageCopy:
      "Business performance files, market scans, internal notes, leadership questions, and a brief that explains the recommendation the deck needs to support.",
    valueTitle: "What Basquio gives back",
    valueCopy:
      "A stronger first storyline, clearer prioritization, and a deck structure that makes it easier to focus discussion on the real decision instead of slide assembly.",
    valuePoints: ["Board prep", "Quarterly business reviews", "Growth or market strategy decks"],
    ctaTitle: "Start with the decision you need to support.",
    ctaCopy: "Upload the files behind the next review and let Basquio shape the first story pass.",
    secondaryHref: "/about",
    secondaryLabel: "Read the product story",
  },
  {
    slug: "agencies",
    title: "Agencies",
    summary: "Scale recurring reporting without flattening the brand.",
    challenge: "Agencies need repeatable production, but every client still expects their own story, their own standards, and a deck that feels native to their brand.",
    heroTitle: "Scale recurring reporting without flattening the brand.",
    heroCopy:
      "Agency teams need to move fast across several accounts without making every report feel interchangeable. Basquio helps keep the evidence, story, and client-facing design aligned.",
    bestWhen: [
      "You prepare recurring client reporting packs.",
      "You need white-label output that still feels bespoke.",
      "You want the same analysis to produce both PPTX and PDF.",
    ],
    pressureTitle: "Where the work usually slows down",
    pressureCopy:
      "The bottleneck is often not analysis alone. It is moving from account data to a branded deliverable fast enough to keep reporting profitable and consistent.",
    packageTitle: "A typical package",
    packageCopy:
      "Client trackers, campaign readouts, support documents, a house template or client template, and a short brief on what the review should land.",
    valueTitle: "What Basquio gives back",
    valueCopy:
      "A repeatable way to get to first draft faster while still protecting the client-facing narrative and the visual standard that keeps the work feeling premium.",
    valuePoints: ["Monthly client reporting", "White-label decks", "Renewal or performance reviews"],
    ctaTitle: "Bring one client reporting package.",
    ctaCopy: "Start with a live account package and see what the first Basquio draft gives your team back.",
    secondaryHref: "/get-started",
    secondaryLabel: "See how to get started",
  },
] as const;

export const personaMap = new Map(personas.map((persona) => [persona.slug, persona]));
