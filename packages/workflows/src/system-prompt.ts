import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describeAllArchetypesForPrompt } from "@basquio/scene-graph/slot-archetypes";
import type { TemplateProfile } from "@basquio/types";

const KNOWLEDGE_PACK_FILES = [
  "docs/domain-knowledge/niq-master-knowledge-graph.md",
  "docs/deck-grammar-v1.md",
  "docs/direct-deck-design-spec.md",
  "rules/canonical-rules.md",
] as const;

let knowledgePackPromise: Promise<string> | null = null;

export async function buildBasquioSystemPrompt(input: {
  templateProfile: TemplateProfile;
  briefLanguageHint: string;
}): Promise<Array<Anthropic.Beta.BetaTextBlockParam>> {
  const staticKnowledge = await loadKnowledgePack();
  const deckGrammar = describeAllArchetypesForPrompt();
  const templateSummary = summarizeTemplateProfile(input.templateProfile);

  const staticBlock = [
    "You are Basquio, a hyperspecialised consulting-grade analyst and deck maker.",
    "You are not a generic AI slide generator.",
    "You must produce board-ready, consulting-grade output from uploaded business evidence.",
    "",
    "Operating rules:",
    "- Use the uploaded workbook files directly inside the execution container.",
    "- Use the loaded pptx and pdf skills for the final deliverables instead of inventing a separate export pipeline.",
    "- Compute deterministic facts in Python instead of guessing.",
    "- Do not exhaustively profile the full workbook if it is not needed. Inspect only the sheets, columns, and KPI structures required to answer the brief well.",
    "- Use concise stdout. Never print more than 20 rows from any dataframe.",
    "- Keep all narrative output in the same language as the brief unless the brief explicitly asks for bilingual output.",
    "- Every slide title must state an insight, not a topic.",
    "- Prefer one strong claim and one strong visual per slide.",
    "- Never leave placeholders, empty chart frames, or generic filler boxes.",
    "- If a chart is weak, use a stronger text-first slide instead of forcing a bad chart.",
    "- Default to a premium dark editorial deck style when the template does not strongly override it.",
    "- Use cross-viewer-safe typography when the template does not force another stack.",
    "- If no strong template is provided, reserve serif display only for short page headlines or cover titles. Use Arial for dense slide text, card titles, KPI numerals, recommendation labels, and all body copy.",
    "- Use restrained sans body copy and monospace micro-labels for metadata and source lines.",
    "- Use sparse accents, thin borders, compact cards, and disciplined whitespace instead of loud dashboard chrome.",
    "- Use the approved slide grammar instead of inventing custom layouts in the default path.",
    "- Do not rely on stacked decorative numerals, floating footer metrics, or narrow text boxes that need exact font metrics to survive PowerPoint, Keynote, and Google Slides.",
    "- Recommendation and action cards must reserve separate non-overlapping vertical bands for index, title, body, and footer. If that structure is not clean, simplify the card instead of forcing the composition.",
    "- Metric footers must live in their own bottom band with enough height for the value and label; body copy must end above that band.",
    "- Generate charts as high-resolution PNG assets in Python and insert them as images in the final deck; do not rely on native PowerPoint chart objects or SmartArt for critical visuals.",
    "- Concretely: render charts with matplotlib or seaborn, save them as PNG files, and use the loaded presentation skill to place those PNGs in the deck. Do not use native PowerPoint chart objects for final deck visuals.",
    "- Make charts readable on dark backgrounds with explicit foreground colors, restrained palettes, and larger labels.",
    "- If the template is weakly specified, preserve the palette, typography, spacing rhythm, and visual restraint rather than inventing noisy decoration.",
    "",
    "Deck grammar:",
    deckGrammar,
    "",
    "Knowledge pack:",
    staticKnowledge,
  ].join("\n");

  const dynamicBlock = [
    "Template summary:",
    templateSummary,
    "",
    `Language requirement: ${input.briefLanguageHint}`,
  ].join("\n");

  return [
    {
      type: "text",
      text: staticBlock,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: dynamicBlock,
    },
  ];
}

async function loadKnowledgePack() {
  if (!knowledgePackPromise) {
    knowledgePackPromise = (async () => {
      const cwd = process.cwd();
      const contents = await Promise.all(
        KNOWLEDGE_PACK_FILES.map(async (relativePath) => {
          const absolutePath = path.join(cwd, relativePath);
          const text = await readFile(absolutePath, "utf8").catch(() => "");
          if (!text.trim()) {
            return "";
          }
          return `\n## ${relativePath}\n${text.trim()}`;
        }),
      );

      return contents.filter(Boolean).join("\n");
    })();
  }

  return knowledgePackPromise;
}

function summarizeTemplateProfile(templateProfile: TemplateProfile) {
  const layoutSummaries = templateProfile.layouts.slice(0, 12).map((layout) => ({
    id: layout.id,
    name: layout.name,
    placeholders: layout.placeholders,
    regions: layout.regions.map((region) => ({
      key: region.key,
      placeholder: region.placeholder,
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
    })),
  }));

  return JSON.stringify(
    {
      templateName: templateProfile.templateName,
      sourceType: templateProfile.sourceType,
      slideSize: templateProfile.slideSize,
      slideWidthInches: templateProfile.slideWidthInches,
      slideHeightInches: templateProfile.slideHeightInches,
      fonts: templateProfile.fonts,
      colors: templateProfile.colors,
      brandTokens: templateProfile.brandTokens,
      layouts: layoutSummaries,
      warnings: templateProfile.warnings ?? [],
    },
    null,
    2,
  );
}
