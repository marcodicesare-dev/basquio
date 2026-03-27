import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { z } from "zod";

export const renderedPageQaIssueSchema = z.object({
  slidePosition: z.number().int().min(1),
  severity: z.enum(["critical", "major", "minor", "info"]),
  code: z.string(),
  description: z.string(),
  fix: z.string(),
});

export const renderedPageQaSchema = z.object({
  overallStatus: z.enum(["green", "yellow", "red"]),
  score: z.number().min(0).max(10),
  summary: z.string(),
  deckNeedsRevision: z.boolean(),
  issues: z.array(renderedPageQaIssueSchema).default([]),
  strongestSlides: z.array(z.number().int().min(1)).default([]),
  weakestSlides: z.array(z.number().int().min(1)).default([]),
});

type JudgeManifest = {
  slideCount: number;
  slides: Array<{
    position: number;
    title: string;
    layoutId: string;
    slideArchetype?: string | null;
  }>;
};

export async function runRenderedPageQa(input: {
  client: Anthropic;
  pdf: Buffer;
  manifest: JudgeManifest;
  betas: readonly string[];
  model?: "claude-sonnet-4-6" | "claude-haiku-4-5";
  maxTokens?: number;
}) {
  const pdfFile = await input.client.beta.files.upload({
    file: await toFile(input.pdf, "deck.pdf", { type: "application/pdf" }),
    betas: [...input.betas],
  });

  const prompt = buildRenderedPageQaPrompt(input.manifest);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "file",
            file_id: pdfFile.id,
          },
          title: "deck.pdf",
        },
        {
          type: "text",
          text: prompt,
        },
      ],
    },
  ];

  const startedAt = new Date().toISOString();
  const response = await input.client.beta.messages.create({
    model: input.model ?? "claude-haiku-4-5",
    max_tokens: input.maxTokens ?? 1_200,
    betas: [...input.betas] as Anthropic.Beta.AnthropicBeta[],
    messages,
  });
  const completedAt = new Date().toISOString();

  const text = extractResponseText(response.content);
  const json = extractFirstJsonObject(text);
  const parsed = JSON.parse(json);

  // Lenient parse: strip issues with unsupported severity instead of crashing the run
  if (Array.isArray(parsed.issues)) {
    parsed.issues = parsed.issues.filter((issue: Record<string, unknown>) =>
      typeof issue.severity === "string" && ["critical", "major", "minor", "info"].includes(issue.severity),
    );
  }
  const report = renderedPageQaSchema.parse(parsed);

  return {
    report,
    usage: response.usage ?? null,
    requestId: response._request_id ?? null,
    startedAt,
    completedAt,
    promptBody: {
      messages,
    },
  };
}

function buildRenderedPageQaPrompt(manifest: JudgeManifest) {
  return [
    "Review the uploaded PDF as a rendered deck artifact.",
    "Judge visual quality, layout integrity, and consulting-grade polish from the rendered pages themselves.",
    "Do not judge whether the business analysis is correct. Judge the artifact that a client or executive would see.",
    "You may flag a claim-exhibit mismatch when the slide itself makes a visible claim the chart cannot support from what is shown on the page.",
    "",
    "Focus on these failure modes:",
    "- text overlap",
    "- recommendation card overlap or footer band collisions",
    "- label overlap inside charts or tables",
    "- footer collisions",
    "- broken recommendation cards",
    "- weak visual hierarchy",
    "- unreadable charts",
    "- stretched or squeezed charts",
    "- sparse charts sitting in giant dead frames",
    "- malformed numeric labels such as ++0.09pp or inconsistent pp notation",
    "- claim-to-exhibit mismatch where the title/body says a metric grew or expanded but the chart only shows current level",
    "- comparison slides that promise a full set of entities but visibly cover only a subset",
    "- template fidelity that clearly falls back to generic house styling when a strong template should be visible",
    "- ugly dead space",
    "- generic dashboard sludge",
    "- cards or labels that depend on fragile line wrapping",
    "",
    "Deck manifest summary:",
    JSON.stringify({
      slideCount: manifest.slideCount,
      slides: manifest.slides.map((slide) => ({
        position: slide.position,
        title: slide.title,
        layoutId: slide.layoutId,
        slideArchetype: slide.slideArchetype ?? slide.layoutId,
      })),
    }, null, 2),
    "",
    "Return ONLY valid JSON with this exact shape:",
    JSON.stringify({
      overallStatus: "green",
      score: 8.5,
      summary: "Short overall quality summary.",
      deckNeedsRevision: false,
      issues: [
        {
          slidePosition: 2,
          severity: "major",
          code: "footer_overlap",
          description: "Footer KPI collides with body copy.",
          fix: "Reserve a dedicated footer band and shorten the body copy.",
        },
      ],
      strongestSlides: [1, 3],
      weakestSlides: [2],
    }, null, 2),
    "",
    "Use concrete issue codes when relevant:",
    "- chart_aspect_distortion",
    "- chart_dead_space",
    "- numeric_label_malformed",
    "- claim_exhibit_mismatch",
    "- entity_coverage_gap",
    "- recommendation_card_overlap",
    "- label_overlap",
    "- template_fidelity_gap",
    "- footer_overlap",
    "",
    "Scoring guidance:",
    "- green = ready to ship visually",
    "- yellow = usable but still visibly flawed",
    "- red = not shippable",
    "",
    "Revision policy:",
    "- set deckNeedsRevision=true if any critical issue exists",
    "- set deckNeedsRevision=true if any major issue exists",
    "- keep issues concise and concrete",
  ].join("\n");
}

function extractResponseText(blocks: Anthropic.Beta.BetaContentBlock[]) {
  return blocks
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractFirstJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Rendered-page QA did not return JSON. Response: ${text.slice(0, 500)}`);
  }

  return text.slice(firstBrace, lastBrace + 1);
}
