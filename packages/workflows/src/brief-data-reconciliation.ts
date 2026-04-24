import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { DatasetProfile } from "@basquio/types";

const reconciliationResultSchema = z.object({
  answerable: z.enum(["fully", "partial", "mismatch"]),
  uploadedDataFrame: z.string().min(1),
  briefImpliesFrame: z.string().min(1),
  scopeAdjustment: z.string().nullable(),
});

export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;

export async function runBriefDataReconciliation(input: {
  client: Anthropic;
  brief: { objective: string; businessContext: string; audience: string };
  datasetProfile: DatasetProfile;
  model?: "claude-haiku-4-5";
}): Promise<ReconciliationResult> {
  const prompt = [
    "You audit whether an analyst brief can be answered from an uploaded dataset.",
    "",
    "You return a JSON object matching this schema:",
    "{",
    '  "answerable": "fully" | "partial" | "mismatch",',
    '  "uploadedDataFrame": "one sentence describing what the data actually measures",',
    '  "briefImpliesFrame": "one sentence describing what the brief is asking for",',
    '  "scopeAdjustment": string | null',
    "}",
    "",
    "Rules:",
    '- "fully" means every analytical question the brief implies can be answered from the uploaded data alone',
    '- "partial" means the data answers some but not all of the brief\'s implied questions',
    '- "mismatch" means the data answers a fundamentally different question than what the brief asks',
    '- On "partial" or "mismatch", scopeAdjustment is a 3-5 sentence note the deck author will read. It must name the gap explicitly, describe what the data DOES answer, and instruct the author to narrate the gap in the executive summary and narrative report',
    '- On "fully", scopeAdjustment is null',
    "",
    "BRIEF:",
    `audience: ${input.brief.audience}`,
    `objective: ${input.brief.objective}`,
    `businessContext: ${input.brief.businessContext}`,
    "",
    "DATASET PROFILE:",
    summarizeDatasetProfile(input.datasetProfile),
    "",
    "Respond with JSON only.",
  ].join("\n");

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  ];

  let response = await input.client.beta.messages.create({
    model: input.model ?? "claude-haiku-4-5",
    max_tokens: 900,
    messages,
  });

  try {
    return parseReconciliationResponse(extractResponseText(response.content));
  } catch {
    response = await input.client.beta.messages.create({
      model: input.model ?? "claude-haiku-4-5",
      max_tokens: 900,
      messages: [
        ...messages,
        {
          role: "assistant",
          content: response.content as Anthropic.Beta.BetaContentBlockParam[],
        },
        {
          role: "user",
          content: [{
            type: "text",
            text: [
              "Your previous reply was not valid JSON matching the requested schema.",
              "Return JSON only, no markdown fence, no explanation.",
            ].join("\n"),
          }],
        },
      ],
    });
    return parseReconciliationResponse(extractResponseText(response.content));
  }
}

function summarizeDatasetProfile(datasetProfile: DatasetProfile) {
  const summary = {
    sourceFileName: datasetProfile.sourceFileName,
    sourceFiles: datasetProfile.sourceFiles.map((file) => ({
      fileName: file.fileName,
      kind: file.kind,
      role: file.role,
      notes: file.notes?.slice(0, 3) ?? [],
    })),
    sheets: datasetProfile.sheets.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rowCount,
      columns: sheet.columns.map((column) => ({
        name: column.name,
        inferredType: column.inferredType,
        role: column.role,
        sampleValues: column.sampleValues.slice(0, 4),
      })),
    })),
    warnings: datasetProfile.warnings.slice(0, 8),
  };

  return JSON.stringify(summary, null, 2);
}

function parseReconciliationResponse(raw: string) {
  const normalized = stripMarkdownFence(raw).trim();
  return reconciliationResultSchema.parse(JSON.parse(normalized));
}

function extractResponseText(content: Anthropic.Beta.BetaContentBlock[]) {
  return content
    .map((block) => {
      if ("text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}
