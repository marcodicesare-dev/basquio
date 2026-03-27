import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describeAllArchetypesForPrompt } from "@basquio/scene-graph/slot-archetypes";
import type { TemplateProfile } from "@basquio/types";

const KNOWLEDGE_PACK_FILES = [
  "docs/domain-knowledge/niq-analyst-playbook.md",
  "docs/domain-knowledge/basquio-copywriting-skill.md",
  "docs/direct-deck-design-spec.md",
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
    "- Slide titles MUST fit on one line at the rendered font size. If a title exceeds ~75 characters, shorten it. Never let title text overflow the right slide margin.",
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
    "- Side panel cards and key-findings boxes: limit body text to 3 short lines per card. If more detail is needed, use a second card or move the detail to body copy. Never let card text overflow the card boundary or wrap into unreadable lines.",
    "- Right-side panels must have at least 0.3 inches of right margin. Text must not touch the right slide edge.",
    "- Metric footers must live in their own bottom band with enough height for the value and label; body copy must end above that band.",
    "- Generate charts as high-resolution PNG assets in Python and insert them as images in the final deck; do not rely on native PowerPoint chart objects or SmartArt for critical visuals.",
    "- Concretely: render charts with matplotlib or seaborn, save them as PNG files, and use the loaded presentation skill to place those PNGs in the deck. Do not use native PowerPoint chart objects for final deck visuals.",
    "- Make charts readable on dark backgrounds with explicit foreground colors, restrained palettes, and larger labels.",
    "- Label collision prevention (apply BEFORE rendering, do not rely on post-hoc QA):",
    "  - When category names exceed 12 characters on average, prefer horizontal bar charts over vertical bar charts.",
    "  - When more than 8 categories exist and detail adds no decision value, aggregate the tail into an 'Other' group or show only the top N.",
    "  - Abbreviate or wrap long labels when safe (e.g., 'North America' -> 'N. America'). Never truncate numbers.",
    "  - Increase figure size and margins (plt.subplots(figsize=(...), constrained_layout=True)) when labels are dense.",
    "  - Rotate x-axis labels 30-45 degrees only when category count is 5-8 and names are moderate length; beyond 8 categories, switch to horizontal bars.",
    "  - Never place external data labels on bar segments narrower than the label text width. Use a legend or annotation line instead.",
    "  - Avoid redundant value callouts when the axis already communicates the same information.",
    "  - Always call plt.tight_layout() or use constrained_layout=True as the final step before savefig().",
    "  - Source notes placed via fig.text() sit OUTSIDE tight_layout bounds. Add extra bottom margin (plt.subplots_adjust(bottom=0.15)) BEFORE tight_layout when a source note is present, so it does not collide with axis labels.",
    "  - When placing end-of-bar value labels on horizontal bar charts, leave at least 8% of the axis range as right-side padding so labels do not clip at the figure edge.",
    "- Render each chart at the aspect ratio of its intended slot. Never stretch a chart image after export to make it fill a different box.",
    "- For sparse or skewed data, change the slide grammar instead of inflating a weak chart. One dominant bar with tiny tails should not sit in a giant hero frame.",
    "- Numeric labels must be mechanically clean: positives use one plus sign, negatives use one minus sign, and percentage-point labels use formats like +0.09pp.",
    "- If the template is weakly specified, preserve the palette, typography, spacing rhythm, and visual restraint rather than inventing noisy decoration.",
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
