import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";

import { createSystemTemplateProfile } from "@basquio/template-engine";

import {
  assertAuthoringExecutionContract,
  BETAS,
  type AuthoringContainer,
  buildAuthoringOutputConfig,
  buildAuthoringContainer,
  buildClaudeTools,
  type WebFetchMode,
} from "../packages/workflows/src/anthropic-execution-contract";
import {
  appendAssistantTurn,
  appendPauseTurnContinuation,
} from "../packages/workflows/src/anthropic-message-thread";
import { parseDeckManifest } from "../packages/workflows/src/deck-manifest";
import { buildBasquioSystemPrompt } from "../packages/workflows/src/system-prompt";
import { loadBasquioScriptEnv } from "./load-app-env";

const MODEL = "claude-sonnet-4-6";
const SMOKE_MAX_TOKENS = 16_384;

loadBasquioScriptEnv();

const ANTHROPIC_TIMEOUT_MS = Number.parseInt(process.env.BASQUIO_ANTHROPIC_TIMEOUT_MS ?? "3600000", 10);

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const client = new Anthropic({
    apiKey,
    maxRetries: 1,
    timeout: ANTHROPIC_TIMEOUT_MS,
  });

  const options = parseArgs(process.argv.slice(2));
  const uploadedInput = await loadInputFile(options.file);
  const uploaded = await client.beta.files.upload({
    file: await toFile(uploadedInput.buffer, uploadedInput.fileName),
    betas: [...BETAS],
  });

  const system = await buildBasquioSystemPrompt({
    templateProfile: createSystemTemplateProfile(),
    briefLanguageHint: inferLanguageHint(options.brief),
    authorModel: MODEL,
  });

  const initialMessage = {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: [
          options.brief,
          "",
          "Analyze the uploaded evidence file directly inside code execution and create the final consulting-grade deck in one run.",
          "Use the loaded pptx skill for the deck and Python file generation for the narrative markdown and workbook.",
          "Charts must be rendered to PNG assets in Python and embedded as images in the final deck.",
          "Do not use native PowerPoint chart objects for critical visuals.",
          "Generate and attach these files exactly:",
          "- test-deck.pptx",
          "- narrative_report.md",
          "- data_tables.xlsx",
          "- deck_manifest.json",
          "You may also attach basquio_analysis.json if useful.",
        ].join("\n"),
      },
      { type: "container_upload" as const, file_id: uploaded.id },
    ],
  };

  let messages: Anthropic.Beta.BetaMessageParam[] = [initialMessage];
  let container: AuthoringContainer = buildAuthoringContainer(undefined, MODEL);
  let finalMessage: Anthropic.Beta.BetaMessage | null = null;
  const fileIds = new Set<string>();
  const tools = buildClaudeTools(MODEL, { webFetchMode: options.webFetchMode });
  assertAuthoringExecutionContract({
    model: MODEL,
    phase: "smoke",
    tools,
    skills: ["pptx"],
    webFetchMode: options.webFetchMode,
  });
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: SMOKE_MAX_TOKENS,
      betas: [...BETAS],
      system,
      messages,
      container,
      tools,
      output_config: buildAuthoringOutputConfig(MODEL),
    });
    const response: Anthropic.Beta.BetaMessage = await stream.finalMessage();

    finalMessage = response;
    container = response.container ? buildAuthoringContainer(response.container.id, MODEL) : container;
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;

    for (const fileId of collectGeneratedFileIds(response.content)) {
      fileIds.add(fileId);
    }

    if (response.stop_reason !== "pause_turn") {
      break;
    }

    messages = appendPauseTurnContinuation(messages, response);
  }

  if (!finalMessage) {
    throw new Error("Claude did not return a final message.");
  }

  let generated = await downloadGeneratedFiles(client, [...fileIds]);
  const requiredFiles = ["test-deck.pptx", "narrative_report.md", "data_tables.xlsx", "deck_manifest.json"];
  const missingAfterFirstPass = findMissingGeneratedFiles(generated, requiredFiles);
  if (missingAfterFirstPass.length > 0 && finalMessage) {
    messages = [
      ...appendAssistantTurn(messages, finalMessage),
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `The smoke is incomplete. Missing files: ${missingAfterFirstPass.join(", ")}.`,
              "Use the current container state. Do not restart the analysis.",
              "Attach every required smoke file before ending: test-deck.pptx, narrative_report.md, data_tables.xlsx, deck_manifest.json.",
            ].join(" "),
          },
        ],
      },
    ];
    for (let retryIteration = 0; retryIteration < 4; retryIteration += 1) {
      const retryStream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: SMOKE_MAX_TOKENS,
        betas: [...BETAS],
        system,
        messages,
        container,
        tools,
        output_config: buildAuthoringOutputConfig(MODEL),
      });
      const retryResponse: Anthropic.Beta.BetaMessage = await retryStream.finalMessage();
      finalMessage = retryResponse;
      container = retryResponse.container ? buildAuthoringContainer(retryResponse.container.id, MODEL) : container;
      totalInputTokens += retryResponse.usage?.input_tokens ?? 0;
      totalOutputTokens += retryResponse.usage?.output_tokens ?? 0;
      for (const fileId of collectGeneratedFileIds(retryResponse.content)) {
        fileIds.add(fileId);
      }
      if (retryResponse.stop_reason !== "pause_turn") {
        break;
      }
      messages = appendPauseTurnContinuation(messages, retryResponse);
    }
    generated = await downloadGeneratedFiles(client, [...fileIds]);
  }
  const pptx = generated.find((file) => file.fileName === "test-deck.pptx" || file.fileName.endsWith("/test-deck.pptx"));
  const narrative = generated.find((file) => file.fileName === "narrative_report.md" || file.fileName.endsWith("/narrative_report.md"));
  const workbook = generated.find((file) => file.fileName === "data_tables.xlsx" || file.fileName.endsWith("/data_tables.xlsx"));
  const manifestFile = generated.find((file) => file.fileName === "deck_manifest.json" || file.fileName.endsWith("/deck_manifest.json"));
  if (!pptx) {
    throw new Error(
      `Claude did not attach test-deck.pptx. Attached files: ${generated.map((file) => file.fileName).join(", ") || "none"}. ` +
      `stop_reason=${finalMessage.stop_reason ?? "unknown"}. Content blocks: ${finalMessage.content.map((block) => block.type).join(", ") || "none"}.`,
    );
  }
  if (!narrative) {
    throw new Error(
      `Claude did not attach narrative_report.md. Attached files: ${generated.map((file) => file.fileName).join(", ") || "none"}. ` +
      `Content blocks: ${finalMessage.content.map((block) => block.type).join(", ") || "none"}.`,
    );
  }
  if (!workbook) {
    throw new Error(
      `Claude did not attach data_tables.xlsx. Attached files: ${generated.map((file) => file.fileName).join(", ") || "none"}. ` +
      `Content blocks: ${finalMessage.content.map((block) => block.type).join(", ") || "none"}.`,
    );
  }
  if (!manifestFile) {
    throw new Error(
      `Claude did not attach deck_manifest.json. Attached files: ${generated.map((file) => file.fileName).join(", ") || "none"}.`,
    );
  }

  const manifest = parseDeckManifest(JSON.parse(manifestFile.buffer.toString("utf8")));

  const verification = await verifyPptx(pptx.buffer);
  if (!verification.valid) {
    throw new Error(`Generated PPTX failed verification: ${verification.reason}`);
  }
  const narrativeText = narrative.buffer.toString("utf8").trim();
  if (narrativeText.split(/\s+/).filter(Boolean).length < 200) {
    throw new Error("Generated narrative_report.md is too short for a smoke deliverable.");
  }
  const workbookVerification = await verifyXlsx(workbook.buffer);
  if (!workbookVerification.valid) {
    throw new Error(`Generated data_tables.xlsx failed verification: ${workbookVerification.reason}`);
  }

  const outputDir = path.join(process.cwd(), "test-output", "code-exec-smoke");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "test-deck.pptx");
  const narrativePath = path.join(outputDir, "narrative_report.md");
  const workbookPath = path.join(outputDir, "data_tables.xlsx");
  const manifestPath = path.join(outputDir, "deck_manifest.json");
  await writeFile(outputPath, pptx.buffer);
  await writeFile(narrativePath, narrative.buffer);
  await writeFile(workbookPath, workbook.buffer);
  await writeFile(manifestPath, manifestFile.buffer);

  console.log(JSON.stringify({
    outputPath,
    narrativePath,
    workbookPath,
    manifestPath,
    slideXmlCount: verification.slideCount,
    chartXmlCount: verification.chartXmlCount,
    mediaCount: verification.mediaCount,
    workbookSheetCount: workbookVerification.sheetCount,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    toolNames: tools.flatMap((tool) => ("name" in tool && typeof tool.name === "string" ? [tool.name] : [])),
    webFetchMode: options.webFetchMode,
    containerId: finalMessage.container?.id ?? null,
  }, null, 2));
}

function buildFixtureCsv() {
  return Buffer.from(
    [
      "category,market,sales,share",
      "Dog Food,Italy,124000,0.32",
      "Cat Food,Italy,98000,0.26",
      "Treats,Italy,56000,0.14",
      "Dog Food,Spain,111000,0.29",
      "Cat Food,Spain,93000,0.24",
      "Treats,Spain,61000,0.16",
    ].join("\n"),
    "utf8",
  );
}

async function loadInputFile(filePath: string | null) {
  if (!filePath) {
    return {
      buffer: buildFixtureCsv(),
      fileName: "smoke-input.csv",
    };
  }

  return {
    buffer: await readFile(filePath),
    fileName: path.basename(filePath),
  };
}

function inferLanguageHint(brief: string) {
  return /\b(il|lo|la|gli|dei|delle|massimo|slide|chiari|famiglie|soluzioni|scenari|grafico)\b/i.test(brief)
    ? "Italian"
    : "English";
}

function parseArgs(argv: string[]) {
  let file: string | null = null;
  let webFetchMode: WebFetchMode = "enrich";
  let brief =
    "Create a 3-slide consulting-grade deck from the uploaded data with one strong takeaway, one recommendation-card slide, and one visual evidence slide.";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      file = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--brief") {
      brief = argv[index + 1] ?? brief;
      index += 1;
      continue;
    }
    if (arg === "--web-fetch-mode") {
      const value = argv[index + 1];
      if (value === "off" || value === "enrich") {
        webFetchMode = value;
      } else {
        throw new Error(`Invalid --web-fetch-mode value: ${value ?? "missing"}`);
      }
      index += 1;
    }
  }

  return { file, brief, webFetchMode };
}

function collectGeneratedFileIds(blocks: Anthropic.Beta.BetaContentBlock[]) {
  const fileIds: string[] = [];

  for (const block of blocks) {
    if (block.type === "code_execution_tool_result" && block.content.type === "code_execution_result") {
      for (const output of block.content.content) {
        if (output.file_id) {
          fileIds.push(output.file_id);
        }
      }
    }
    if (block.type === "bash_code_execution_tool_result" && block.content.type === "bash_code_execution_result") {
      for (const output of block.content.content) {
        if (output.file_id) {
          fileIds.push(output.file_id);
        }
      }
    }
    if (block.type === "container_upload" && block.file_id) {
      fileIds.push(block.file_id);
    }
  }

  return fileIds;
}

async function downloadGeneratedFiles(client: Anthropic, fileIds: string[]) {
  const uniqueFileIds = [...new Set(fileIds)];
  return Promise.all(
    uniqueFileIds.map(async (fileId) => {
      const metadata = await client.beta.files.retrieveMetadata(fileId, {
        betas: ["files-api-2025-04-14"],
      });
      const response = await client.beta.files.download(fileId, {
        betas: ["files-api-2025-04-14"],
      });
      return {
        fileName: metadata.filename,
        buffer: Buffer.from(await response.arrayBuffer()),
      };
    }),
  );
}

function findMissingGeneratedFiles(
  files: Array<{ fileName: string }>,
  requiredFiles: string[],
) {
  return requiredFiles.filter(
    (required) => !files.some((file) => file.fileName === required || file.fileName.endsWith(required)),
  );
}

async function verifyPptx(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return { valid: false, reason: "file is not a zip archive", slideCount: 0, chartXmlCount: 0, mediaCount: 0 };
  }

  const zip = await JSZip.loadAsync(buffer);
  const hasPresentationXml = Boolean(zip.file("ppt/presentation.xml"));
  const slideCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  const chartXmlCount = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name)).length;
  const mediaCount = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.(png|jpe?g)$/i.test(name)).length;

  if (!hasPresentationXml) {
    return { valid: false, reason: "missing ppt/presentation.xml", slideCount, chartXmlCount, mediaCount };
  }

  if (slideCount === 0) {
    return { valid: false, reason: "no slide xml files found", slideCount, chartXmlCount, mediaCount };
  }

  if (chartXmlCount > 0) {
    return { valid: false, reason: `pptx still contains ${chartXmlCount} native chart xml files`, slideCount, chartXmlCount, mediaCount };
  }

  if (mediaCount === 0) {
    return { valid: false, reason: "pptx contains no raster media assets", slideCount, chartXmlCount, mediaCount };
  }

  return { valid: true, reason: "", slideCount, chartXmlCount, mediaCount };
}

async function verifyXlsx(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return { valid: false, reason: "file is not a zip archive", sheetCount: 0 };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    if (!workbookXml) {
      return { valid: false, reason: "missing xl/workbook.xml", sheetCount: 0 };
    }
    const sheetCount = (workbookXml.match(/<sheet\b/gi) ?? []).length;
    if (sheetCount === 0) {
      return { valid: false, reason: "workbook has zero sheets", sheetCount };
    }
    return { valid: true, reason: "", sheetCount };
  } catch {
    return { valid: false, reason: "xlsx parser could not parse the file", sheetCount: 0 };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
