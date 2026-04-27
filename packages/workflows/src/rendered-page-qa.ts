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
  templateContext?: {
    templateName?: string;
    palette?: string[];
    background?: string | null;
    clientLabel?: string | null;
    logoExpected?: boolean;
  };
}) {
  const pdfFile = await input.client.beta.files.upload({
    file: await toFile(input.pdf, "deck.pdf", { type: "application/pdf" }),
    betas: [...input.betas],
  });

  const prompt = buildRenderedPageQaPrompt(input.manifest, input.templateContext);
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

  const requests: Array<{
    requestId: string | null;
    startedAt: string;
    completedAt: string;
    usage: { input_tokens: number; output_tokens: number };
    stopReason: string | null;
  }> = [];

  const executeQaRequest = async (requestMessages: Anthropic.Beta.BetaMessageParam[]) => {
    const startedAt = new Date().toISOString();
    const response = await input.client.beta.messages.create({
      model: input.model ?? "claude-sonnet-4-6",
      max_tokens: input.maxTokens ?? 1_200,
      betas: [...input.betas] as Anthropic.Beta.AnthropicBeta[],
      messages: requestMessages,
    });
    const completedAt = new Date().toISOString();
    requests.push({
      requestId: response._request_id ?? null,
      startedAt,
      completedAt,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
      stopReason: response.stop_reason ?? null,
    });
    return response;
  };

  let response = await executeQaRequest(messages);
  let report: z.infer<typeof renderedPageQaSchema>;

  try {
    report = parseRenderedPageQaResponse(extractResponseText(response.content));
  } catch (firstError) {
    const retryResponse = await executeQaRequest([
      ...messages,
      {
        role: "assistant",
        content: response.content as Anthropic.Beta.BetaContentBlockParam[],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Your previous reply was not valid JSON matching the requested schema.",
              "Return ONLY valid JSON with the exact schema. No markdown fence. No explanation.",
            ].join("\n"),
          },
        ],
      },
    ]);
    response = retryResponse;
    try {
      report = parseRenderedPageQaResponse(extractResponseText(retryResponse.content));
    } catch (retryError) {
      const firstReason = firstError instanceof Error ? firstError.message : String(firstError);
      const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`Rendered-page QA returned invalid JSON after repair retry. First error: ${firstReason}. Retry error: ${retryReason}`);
    }
  }

  const aggregateUsage = requests.reduce(
    (sum, request) => ({
      input_tokens: (sum.input_tokens ?? 0) + (request.usage.input_tokens ?? 0),
      output_tokens: (sum.output_tokens ?? 0) + (request.usage.output_tokens ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0 },
  );

  return {
    report,
    usage: aggregateUsage,
    requestId: response._request_id ?? null,
    startedAt: requests[0]?.startedAt ?? new Date().toISOString(),
    completedAt: requests[requests.length - 1]?.completedAt ?? new Date().toISOString(),
    requests,
    promptBody: {
      messages,
    },
  };
}

export function buildRenderedPageQaPrompt(
  manifest: JudgeManifest,
  templateContext?: { templateName?: string; palette?: string[]; background?: string | null; clientLabel?: string | null; logoExpected?: boolean },
) {
  const templateLines = templateContext?.palette && templateContext.palette.length > 0
    ? [
        "",
        "Client template fidelity target:",
        JSON.stringify({
          templateName: templateContext.templateName ?? null,
          palette: templateContext.palette,
          background: templateContext.background ?? null,
          clientLabel: templateContext.clientLabel ?? null,
          logoExpected: templateContext.logoExpected ?? false,
          forbiddenFallbackDefaults: ["#F0CC27", "#1A6AFF", "#0A090D"],
        }, null, 2),
        "- If the rendered deck visibly falls back to Basquio default blue/navy/amber instead of the client palette above, flag `template_fidelity_gap`.",
        ...(templateContext.logoExpected
          ? [
              "- If the client logo or wordmark is not visibly repeated on content slides via the master chrome, flag `template_fidelity_gap`.",
            ]
          : []),
        ...(templateContext.clientLabel
          ? [
              `- If the footer/header chrome does not reflect the client identity (${templateContext.clientLabel}) and instead shows Basquio text or generic defaults, flag \`template_fidelity_gap\`.`,
            ]
          : []),
      ]
    : [];

  return [
    "Review the uploaded PDF as a rendered deck artifact.",
    "Judge visual quality, layout integrity, consulting-grade polish, and whether the deck feels premium rather than generic from the rendered pages themselves.",
    "Do not judge whether the business analysis is correct. Judge the artifact that a client or executive would see.",
    "You may flag a claim-exhibit mismatch when the slide itself makes a visible claim the chart cannot support from what is shown on the page.",
    "Apply the same overlap, readability, spacing, and chart-legibility standards to every template path. A custom template is not an excuse for collisions, tiny charts, or broken hierarchy.",
    "Do not award green if any chart slide has a visible colored callout band, insight bar, textbox, legend, or source/footer element covering the chart image, plot area, axis title, axis tick labels, category labels, data labels, or legend.",
    "Treat bottom callout bars on chart slides as suspicious: if the band touches or covers x-axis labels, source text, chart labels, or the lower plot boundary, it is a major issue at minimum.",
    "If a text block or callout is drawn on top of bars, heatmap cells, labels, or chart axes, mark deckNeedsRevision=true even when the slide otherwise looks polished.",
    "",
    "Focus on these failure modes:",
    "- text overlap",
    "- chart callout overlap where a colored band or text box covers the chart, x-axis, labels, legend, or source line",
    "- recommendation card overlap or footer band collisions",
    "- label overlap inside charts or tables",
    "- footer collisions",
    "- broken recommendation cards",
    "- weak visual hierarchy",
    "- low-contrast text on pale or tinted bands, especially white text on light green / light amber / light blue fills",
    "- unreadable charts",
    "- legend overlap or unreadable legend text on multi-series charts",
    "- stretched or squeezed charts",
    "- bars or marks that look visually inconsistent with their encoded values or labels",
    "- sparse charts sitting in giant dead frames",
    "- malformed numeric labels such as ++0.09pp or inconsistent pp notation",
    "- claim-to-exhibit mismatch where the title/body says a metric grew or expanded but the chart only shows current level",
    "- comparison slides that promise a full set of entities but visibly cover only a subset",
    "- template fidelity that clearly falls back to generic house styling when a strong template should be visible",
    "- ugly dead space",
    "- giant cards, columns, or roadmap lanes whose lower half is visibly empty",
    "- pure-white cards that fight a warm cream canvas instead of feeling integrated into it",
    "- generic dashboard sludge",
    "- low layout variety where the deck feels like the same slide repeated",
    "- cheap-looking chart styling, weak typography rhythm, or uneven card spacing that make the slide feel non-premium",
    "- cards or labels that depend on fragile line wrapping",
    "- layout variety: does the deck use at least 4 different layout types, or at least 5 for a 15-slide deck?",
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
    ...templateLines,
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
    "- chart_scale_incoherent",
    "- numeric_scale_mismatch",
    "- chart_dead_space",
    "- numeric_label_malformed",
    "- claim_exhibit_mismatch",
    "- entity_coverage_gap",
    "- low_layout_variety",
    "- recommendation_card_overlap",
    "- label_overlap",
    "- legend_unreadable",
    "- template_fidelity_gap",
    "- low_contrast_callout",
    "- harsh_card_canvas_contrast",
    "- underfilled_cards",
    "- weak_visual_hierarchy",
    "- generic_visual_style",
    "- footer_overlap",
    "- chart_callout_overlap",
    "- axis_label_obscured",
    "- chart_plot_overlap",
    "",
    "Scoring guidance:",
    "- green = ready to ship visually",
    "- yellow = usable but still visibly flawed",
    "- red = not shippable",
    "",
    "Revision policy:",
    "- set deckNeedsRevision=true if any critical issue exists",
    "- set deckNeedsRevision=true if any major issue exists",
    "- classify chart/callout overlap as major when labels or axes remain partly readable, and critical when bars/cells/labels are substantially covered or the reader cannot trust the chart",
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

function parseRenderedPageQaResponse(text: string) {
  const json = extractFirstJsonObject(text);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(json);
  } catch {
    const repaired = attemptJsonRepair(json);
    if (!repaired) {
      throw new Error(`Rendered-page QA did not return parseable JSON. Response: ${text.slice(0, 500)}`);
    }
    parsed = JSON.parse(repaired);
  }

  if (Array.isArray(parsed.issues)) {
    parsed.issues = parsed.issues.filter((issue: Record<string, unknown>) =>
      typeof issue.severity === "string" && ["critical", "major", "minor", "info"].includes(issue.severity),
    );
  }

  return renderedPageQaSchema.parse(parsed);
}

function attemptJsonRepair(raw: string) {
  let repaired = raw.trim();
  if (!repaired) {
    return null;
  }

  repaired = repaired.replace(/,\s*$/, "");
  const unescapedQuotes = (repaired.match(/(?<!\\)"/g) ?? []).length;
  if (unescapedQuotes % 2 !== 0) {
    repaired += "\"";
  }

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;

  for (let index = 0; index < repaired.length; index += 1) {
    const char = repaired[index];
    if (char === "\"" && (index === 0 || repaired[index - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      openBraces += 1;
    } else if (char === "}") {
      openBraces -= 1;
    } else if (char === "[") {
      openBrackets += 1;
    } else if (char === "]") {
      openBrackets -= 1;
    }
  }

  repaired = repaired.replace(/,\s*$/, "");
  for (let count = 0; count < openBrackets; count += 1) repaired += "]";
  for (let count = 0; count < openBraces; count += 1) repaired += "}";

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}
