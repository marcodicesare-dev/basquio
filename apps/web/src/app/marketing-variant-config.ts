export type MarketingVariantKey = "context" | "output" | "team" | "italian";

export type MarketingVariant = {
  key: MarketingVariantKey;
  eyebrow: string;
  hero: string;
  subhead: string;
  primaryCta: string;
  secondaryCta: string;
  secondaryHref: string;
  visualTitle: string;
  visualMode: "context" | "deadline" | "team" | "italian";
  routerHeading: string;
  painHeading: string;
  painCopy: string;
  workspaceHeading: string;
  workspaceCopy: string;
  outputHeading: string;
  outputCopy: string;
  teamHeading: string;
  teamCopy: string;
  pricingHeading: string;
  pricingCopy: string;
  metadataTitle: string;
  metadataDescription: string;
};

export const activeMarketingVariant: MarketingVariantKey = "italian";

export const marketingVariants: Record<MarketingVariantKey, MarketingVariant> = {
  context: {
    key: "context",
    eyebrow: "For market research teams",
    hero: "Your next research deck should not start from zero.",
    subhead:
      "Basquio keeps the brief, data, notes, template, and past work together, then turns the next ask into a deck, report, and Excel file.",
    primaryCta: "Start with one output",
    secondaryCta: "See the workspace",
    secondaryHref: "/workspace-pro",
    visualTitle: "Context gathered once, output prepared next",
    visualMode: "context",
    routerHeading: "Choose the path that matches the work.",
    painHeading: "Every research output starts by rebuilding context.",
    painCopy:
      "The thinking is already there. The drag is finding the brief, matching the data, checking the template, and rebuilding what the team already agreed last time.",
    workspaceHeading: "The second output starts with memory.",
    workspaceCopy:
      "Workspace keeps projects, templates, stakeholder preferences, notes, transcripts, and previous reviews available for the next request.",
    outputHeading: "One run, three reviewable files.",
    outputCopy:
      "Basquio prepares the presentation, written report, and Excel workbook from the same source-backed work.",
    teamHeading: "For teams that repeat the work every month.",
    teamCopy:
      "Team Workspace gives research, brand, category, and strategy teams shared context across recurring outputs.",
    pricingHeading: "Pay for one output, or keep the work in a workspace.",
    pricingCopy:
      "Credits fit intermittent work. Workspace fits recurring work where the context should compound.",
    metadataTitle: "Basquio | Decks, reports, and Excel files from research material",
    metadataDescription:
      "Basquio keeps briefs, data, notes, templates, and past work together, then prepares decks, reports, and Excel files for market research teams.",
  },
  output: {
    key: "output",
    eyebrow: "For work due soon",
    hero: "The brief changed. The deck is still due.",
    subhead:
      "Give Basquio the data, the brief, and the template. It keeps the context together and prepares the deck, report, and Excel file without making your analyst rebuild the work by hand.",
    primaryCta: "Price an output",
    secondaryCta: "See what it remembers",
    secondaryHref: "/workspace-pro",
    visualTitle: "Deadline, inputs, estimate, output",
    visualMode: "deadline",
    routerHeading: "Start from the pressure in front of you.",
    painHeading: "The due date does not move when the request changes.",
    painCopy:
      "A new angle, a revised audience, or a different template can turn clear thinking into another night of slide work.",
    workspaceHeading: "The next change has context ready.",
    workspaceCopy:
      "Basquio keeps the material around the output, so a revised ask starts from the existing work instead of a blank file.",
    outputHeading: "The files the stakeholder expects.",
    outputCopy:
      "A deck to present, a report to leave behind, and an Excel workbook that keeps the numbers inspectable.",
    teamHeading: "Give teams a place for repeated requests.",
    teamCopy:
      "Recurring work belongs in a shared workspace where templates, notes, past reviews, and stakeholder preferences stay available.",
    pricingHeading: "Estimate one output before you pay.",
    pricingCopy:
      "Occasional work starts with a credit estimate. Recurring work moves into Workspace Pro or Team Workspace.",
    metadataTitle: "Basquio | Price one research output before you pay",
    metadataDescription:
      "Basquio estimates the work from your brief, data, and template, then prepares the deck, report, and Excel file.",
  },
  team: {
    key: "team",
    eyebrow: "For recurring research teams",
    hero: "A workspace for teams that make research outputs every month.",
    subhead:
      "Basquio remembers briefs, stakeholders, templates, and past reviews, so each new deck, report, or workbook starts with the context already in place.",
    primaryCta: "See team workspace",
    secondaryCta: "Start with pay as you go",
    secondaryHref: "/pay-as-you-go",
    visualTitle: "Shared workspace memory for recurring output",
    visualMode: "team",
    routerHeading: "Route solo work, output work, and team work clearly.",
    painHeading: "Team research work breaks when context lives in people and files.",
    painCopy:
      "Stakeholder preferences, accepted formats, prior caveats, and approved templates disappear across email, folders, and old decks.",
    workspaceHeading: "Workspace is the recurring product.",
    workspaceCopy:
      "Basquio keeps shared memory for brands, categories, stakeholders, templates, rules, and past reviews.",
    outputHeading: "Outputs stay concrete.",
    outputCopy:
      "Teams still get decks, reports, Excel files, charts, and evidence packages. The workspace keeps the context behind them.",
    teamHeading: "Built for the buyer who owns repeated research output.",
    teamCopy:
      "The team path starts with a pilot, onboarding, shared projects, and normal team usage agreed up front.",
    pricingHeading: "Team Workspace starts from recurring work, not seat math.",
    pricingCopy:
      "The team buyer wants capacity, governance, context, and outputs. The credit meter stays out of the daily workflow.",
    metadataTitle: "Basquio Team Workspace | Shared memory for research outputs",
    metadataDescription:
      "Basquio gives market research teams a shared workspace for briefs, data, templates, stakeholder context, past reviews, and recurring outputs.",
  },
  italian: {
    key: "italian",
    eyebrow: "Per team di ricerca e insight",
    hero: "Il prossimo lavoro di ricerca non dovrebbe ripartire da zero.",
    subhead:
      "Basquio tiene insieme brief, dati, appunti, template e lavori passati, poi prepara presentazione, report e file Excel per la prossima richiesta.",
    primaryCta: "Calcola un output",
    secondaryCta: "Vedi il workspace",
    secondaryHref: "/workspace-pro",
    visualTitle: "Il contesto resta, il prossimo output parte meglio",
    visualMode: "italian",
    routerHeading: "Scegli il percorso giusto per il lavoro.",
    painHeading: "Ogni output di ricerca ricomincia dalla caccia al contesto.",
    painCopy:
      "Il pensiero resta al team. Il lavoro ripetitivo e' ritrovare brief, dati, appunti, template e revisioni gia' approvate.",
    workspaceHeading: "Il secondo output parte dal contesto salvato.",
    workspaceCopy:
      "Workspace conserva progetti, template, stakeholder, appunti, transcript, regole di brand e review precedenti.",
    outputHeading: "Un run, tre file da rivedere.",
    outputCopy:
      "Basquio prepara presentazione, report scritto e file Excel dallo stesso lavoro tracciabile.",
    teamHeading: "Per team che preparano output di ricerca ogni mese.",
    teamCopy:
      "Team Workspace porta lo stesso contesto a research, brand, category e strategy team.",
    pricingHeading: "Paghi un output, oppure tieni il lavoro nel workspace.",
    pricingCopy:
      "I crediti servono per lavori occasionali. Il workspace serve quando il contesto deve rimanere vivo.",
    metadataTitle: "Basquio | Presentazioni, report e file Excel da materiale di ricerca",
    metadataDescription:
      "Basquio tiene insieme brief, dati, appunti, template e lavori passati, poi prepara presentazioni, report e file Excel.",
  },
};

export function getActiveMarketingVariant() {
  return marketingVariants[activeMarketingVariant];
}
