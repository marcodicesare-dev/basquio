import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { FidelitySheetInput } from "@basquio/intelligence";

const claimTraceabilityIssueSchema = z.object({
  position: z.number().int().min(1),
  severity: z.enum(["major", "critical"]),
  message: z.string(),
});

const claimTraceabilityReportSchema = z.object({
  summary: z.string().default(""),
  issues: z.array(claimTraceabilityIssueSchema).default([]),
});

type JudgeSlide = {
  position: number;
  layoutId: string;
  slideArchetype?: string | null;
  pageIntent?: string | null;
  title: string;
  body?: string | null;
  bullets?: string[];
  calloutText?: string | null;
  chartSheetName?: string | null;
};

export async function runClaimTraceabilityQa(input: {
  client: Anthropic;
  manifest: {
    slideCount: number;
    slides: JudgeSlide[];
  };
  workbookSheets: FidelitySheetInput[];
  knownEntities?: string[];
  briefContext?: {
    client?: string | null;
    audience?: string | null;
    objective?: string | null;
    thesis?: string | null;
    businessContext?: string | null;
  };
  model?: "claude-haiku-4-5" | "claude-sonnet-4-6";
  maxTokens?: number;
}) {
  const candidateSlides = input.manifest.slides
    .filter((slide) => shouldJudgeSlide(slide))
    .map((slide) => {
      const linkedSheet = slide.chartSheetName
        ? input.workbookSheets.find((sheet) => sheet.name === slide.chartSheetName)
        : undefined;
      return {
        position: slide.position,
        layoutId: slide.layoutId,
        slideArchetype: slide.slideArchetype ?? slide.layoutId,
        pageIntent: slide.pageIntent ?? null,
        title: slide.title,
        body: truncate(slide.body ?? "", 320) || null,
        bullets: (slide.bullets ?? []).slice(0, 5).map((bullet) => truncate(bullet, 160)),
        calloutText: truncate(slide.calloutText ?? "", 200) || null,
        linkedSheet: linkedSheet
          ? {
              name: linkedSheet.name,
              headers: linkedSheet.headers.slice(0, 16),
              sampleRows: linkedSheet.rows.slice(0, 6),
            }
          : null,
      };
    });

  if (candidateSlides.length === 0) {
    return {
      report: {
        summary: "No narrative-heavy slides required claim-traceability review.",
        issues: [],
      },
      usage: { input_tokens: 0, output_tokens: 0 },
      requestId: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      requests: [],
    };
  }

  const deckEvidenceIndex = input.manifest.slides.map((slide) => ({
    position: slide.position,
    title: truncate(slide.title, 120),
    summary: truncate([slide.body ?? "", ...(slide.bullets ?? []), slide.calloutText ?? ""].filter(Boolean).join(" "), 180),
  }));

  const prompt = buildClaimTraceabilityPrompt({
    candidateSlides,
    deckEvidenceIndex,
    knownEntities: input.knownEntities ?? [],
    briefContext: input.briefContext,
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
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

  const executeRequest = async (requestMessages: Anthropic.Beta.BetaMessageParam[]) => {
    const startedAt = new Date().toISOString();
    const response = await input.client.beta.messages.create({
      model: input.model ?? "claude-haiku-4-5",
      max_tokens: input.maxTokens ?? 1_600,
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

  let response = await executeRequest(messages);
  let report: z.infer<typeof claimTraceabilityReportSchema>;

  try {
    report = parseClaimTraceabilityResponse(extractResponseText(response.content));
  } catch (firstError) {
    const retryResponse = await executeRequest([
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
      report = parseClaimTraceabilityResponse(extractResponseText(retryResponse.content));
    } catch (retryError) {
      const firstReason = firstError instanceof Error ? firstError.message : String(firstError);
      const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`Claim-traceability QA returned invalid JSON after repair retry. First error: ${firstReason}. Retry error: ${retryReason}`);
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
  };
}

function shouldJudgeSlide(slide: JudgeSlide) {
  const layout = `${slide.slideArchetype ?? slide.layoutId}`.toLowerCase();
  if (layout.includes("cover") || layout.includes("divider")) {
    return false;
  }

  const text = [slide.title, slide.body ?? "", ...(slide.bullets ?? []), slide.calloutText ?? ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (text.length < 40) {
    return false;
  }

  if (layout.includes("recommendation")) {
    return true;
  }

  return /\b(adult|adults|premium|underwhelming|deludente|should|must-win|must win|expand|activation|promo|targets?|for adults|opportunity|recommend|win in|focus on|priorit(?:y|ize)|claim|positioned)\b/i.test(text);
}

function buildClaimTraceabilityPrompt(input: {
  candidateSlides: Array<Record<string, unknown>>;
  deckEvidenceIndex: Array<Record<string, unknown>>;
  knownEntities: string[];
  briefContext?: {
    client?: string | null;
    audience?: string | null;
    objective?: string | null;
    thesis?: string | null;
    businessContext?: string | null;
  };
}) {
  return [
    "Review slide narrative and recommendation claims for evidence traceability.",
    "Flag ONLY qualitative or recommendation claims that are not supported by the linked workbook sheet, the deck evidence index, or an explicit `(brief)` reference in the slide text.",
    "Numeric headline verification is already handled elsewhere. Do not flag pure numeric mismatches unless the unsupported wording depends on them.",
    "Recommendation slides are held to the same standard: if the recommendation states an underperformance, demographic target, pricing tier, activation gap, or retailer-specific action without support, flag it.",
    "Entity grounding is checked separately. Focus here on unsupported qualitative reasoning and unsupported recommendation wording.",
    "",
    "Support rules:",
    "- Supported: directly observable in the linked sheet or explicitly cited from another slide using `cfr. slide N`.",
    "- Supported: explicitly marked as `(brief)` in the text.",
    "- Unsupported: demographic inferences, psychographic claims, channel/retailer prescriptions, or strategic diagnoses with no visible evidence.",
    "- Be conservative. If the evidence is ambiguous, do not flag.",
    "",
    "Brief context:",
    JSON.stringify(input.briefContext ?? {}, null, 2),
    "",
    "Known input entities:",
    JSON.stringify(input.knownEntities.slice(0, 200), null, 2),
    "",
    "Deck evidence index:",
    JSON.stringify(input.deckEvidenceIndex, null, 2),
    "",
    "Slides to review:",
    JSON.stringify(input.candidateSlides, null, 2),
    "",
    "Return ONLY valid JSON with this exact shape:",
    JSON.stringify({
      summary: "Short summary.",
      issues: [
        {
          position: 42,
          severity: "major",
          message: "Recommendation says promo activation is underwhelming, but no linked sheet or cited prior slide shows promo effectiveness or activation evidence.",
        },
      ],
    }, null, 2),
    "",
    "Severity guidance:",
    "- critical: the slide's main claim is unsupported and materially changes the recommendation or narrative.",
    "- major: notable unsupported claim that should be removed, softened, or evidenced.",
    "- Return an empty issues array when support is adequate.",
  ].join("\n");
}

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
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
    throw new Error(`Claim-traceability QA did not return JSON. Response: ${text.slice(0, 500)}`);
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function parseClaimTraceabilityResponse(text: string) {
  const json = extractFirstJsonObject(text);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(json);
  } catch {
    const repaired = attemptJsonRepair(json);
    if (!repaired) {
      throw new Error(`Claim-traceability QA did not return parseable JSON. Response: ${text.slice(0, 500)}`);
    }
    parsed = JSON.parse(repaired);
  }

  if (Array.isArray(parsed.issues)) {
    parsed.issues = parsed.issues.filter((issue: Record<string, unknown>) =>
      typeof issue.severity === "string" && ["major", "critical"].includes(issue.severity),
    );
  }

  return claimTraceabilityReportSchema.parse(parsed);
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
