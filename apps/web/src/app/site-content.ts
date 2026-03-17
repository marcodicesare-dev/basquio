export const heroSignals = ["Traceable numbers", "Branded PPTX + PDF", "Story shaped for your audience"] as const;


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
    pressureTitle: "The real bottleneck",
    pressureCopy:
      "You already have the NielsenIQ exports, the share trackers, the campaign results. The bottleneck is turning six spreadsheets into 20 slides that leadership can scan in five minutes.",
    packageTitle: "What you would upload",
    packageCopy:
      "Sales trackers, share tables, campaign performance CSVs, retailer scorecards, and your team's PowerPoint template.",
    valueTitle: "What comes back",
    valueCopy:
      "A branded deck that already identifies the share shifts, frames the category story, and traces every number back to your source files.",
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
    pressureTitle: "The real bottleneck",
    pressureCopy:
      "The partner needs the deck by Thursday. The analyst has the data but not the story. The associate has the story but not the math. Somebody has to merge it all into 30 slides by morning.",
    packageTitle: "What you would upload",
    packageCopy:
      "Client data exports, interview transcripts, competitive benchmarks, market sizing tables, and the engagement template.",
    valueTitle: "What comes back",
    valueCopy:
      "A structured first draft with the storyline already shaped around the recommendation, every claim grounded in the data, ready for the team to sharpen.",
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
    pressureTitle: "The real bottleneck",
    pressureCopy:
      "The board meeting is in two weeks. Three teams contributed data. Nobody agrees on the headline. Someone has to synthesize 40 pages of evidence into 12 slides that drive one decision.",
    packageTitle: "What you would upload",
    packageCopy:
      "Business performance exports, market scans, internal memos, competitive intelligence, and the brief that explains what decision the room needs to make.",
    valueTitle: "What comes back",
    valueCopy:
      "A decision-ready deck with the recommendation already framed, supporting evidence ranked by impact, and every claim linked to the source file.",
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
    pressureTitle: "The real bottleneck",
    pressureCopy:
      "Eight clients, monthly reporting packs, each with different brand guidelines. The analyst pulls the data; the designer rebuilds the template; the account lead rewrites the narrative. Every month.",
    packageTitle: "What you would upload",
    packageCopy:
      "Client performance trackers, campaign CSVs, the client's PPTX template, and a one-paragraph brief on what this month's story should be.",
    valueTitle: "What comes back",
    valueCopy:
      "A white-label deck in the client's brand system with the narrative already shaped, so your team reviews and sharpens instead of rebuilding from scratch.",
    valuePoints: ["Monthly client reporting", "White-label decks", "Renewal or performance reviews"],
    ctaTitle: "Bring one client reporting package.",
    ctaCopy: "Start with a live account package and see what the first Basquio draft gives your team back.",
    secondaryHref: "/get-started",
    secondaryLabel: "See how to get started",
  },
] as const;


