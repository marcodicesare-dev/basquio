import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";
import pdfParse from "pdf-parse";

import { createSystemTemplateProfile } from "@basquio/template-engine";

import {
  BETAS,
  buildAuthoringOutputConfig,
  buildAuthoringContainer,
  buildClaudeTools,
} from "../packages/workflows/src/anthropic-execution-contract";
import { parseDeckManifest } from "../packages/workflows/src/deck-manifest";
import { buildBasquioSystemPrompt } from "../packages/workflows/src/system-prompt";
import { runRenderedPageQa } from "../packages/workflows/src/rendered-page-qa";
import { loadBasquioScriptEnv } from "./load-app-env";

const MODEL = "claude-sonnet-4-6";

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
      { type: "container_upload" as const, file_id: uploaded.id },
      {
        type: "text" as const,
        text: [
          options.brief,
          "",
          "Analyze the uploaded evidence file directly inside code execution and create the final consulting-grade deck in one run.",
          "Use the loaded pptx and pdf skills for the final artifacts.",
          "Charts must be rendered to PNG assets in Python and embedded as images in the final deck.",
          "Do not use native PowerPoint chart objects for critical visuals.",
          "Generate and attach these files exactly:",
          "- test-deck.pptx",
          "- test-deck.pdf",
          "- deck_manifest.json",
          "You may also attach basquio_analysis.json if useful.",
        ].join("\n"),
      },
    ],
  };

  let messages: Anthropic.Beta.BetaMessageParam[] = [initialMessage];
  let container: Anthropic.Beta.BetaContainerParams | undefined = buildAuthoringContainer(undefined, MODEL);
  let finalMessage: Anthropic.Beta.BetaMessage | null = null;
  const fileIds = new Set<string>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8_192,
      betas: [...BETAS],
      system,
      messages,
      container,
      tools: buildClaudeTools(MODEL),
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

    messages = appendAssistantTurn(messages, response);
  }

  if (!finalMessage) {
    throw new Error("Claude did not return a final message.");
  }

  const generated = await downloadGeneratedFiles(client, [...fileIds]);
  const pptx = generated.find((file) => file.fileName === "test-deck.pptx" || file.fileName.endsWith("/test-deck.pptx"));
  const pdf = generated.find((file) => file.fileName === "test-deck.pdf" || file.fileName.endsWith("/test-deck.pdf"));
  const manifestFile = generated.find((file) => file.fileName === "deck_manifest.json" || file.fileName.endsWith("/deck_manifest.json"));
  if (!pptx) {
    throw new Error(
      `Claude did not attach test-deck.pptx. Attached files: ${generated.map((file) => file.fileName).join(", ") || "none"}. ` +
      `Content blocks: ${finalMessage.content.map((block) => block.type).join(", ") || "none"}.`,
    );
  }
  if (!pdf) {
    throw new Error(
      `Claude did not attach test-deck.pdf. Attached files: ${generated.map((file) => file.fileName).join(", ") || "none"}. ` +
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
  const pdfVerification = await verifyPdf(pdf.buffer);
  if (!pdfVerification.valid) {
    throw new Error(`Generated PDF failed verification: ${pdfVerification.reason}`);
  }
  if (pdfVerification.pageCount !== verification.slideCount) {
    throw new Error(
      `Generated PDF page count does not match PPTX slide count: pdf=${pdfVerification.pageCount} pptx=${verification.slideCount}.`,
    );
  }
  const visualQa = await runRenderedPageQa({
    client,
    pdf: pdf.buffer,
    manifest,
    betas: ["files-api-2025-04-14"],
  });

  if (visualQa.report.deckNeedsRevision || visualQa.report.overallStatus !== "green") {
    throw new Error(`Rendered-page QA failed: ${JSON.stringify(visualQa.report)}`);
  }

  const outputDir = path.join(process.cwd(), "test-output", "code-exec-smoke");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "test-deck.pptx");
  const pdfPath = path.join(outputDir, "test-deck.pdf");
  const manifestPath = path.join(outputDir, "deck_manifest.json");
  await writeFile(outputPath, pptx.buffer);
  await writeFile(pdfPath, pdf.buffer);
  await writeFile(manifestPath, manifestFile.buffer);

  console.log(JSON.stringify({
    outputPath,
    pdfPath,
    manifestPath,
    slideXmlCount: verification.slideCount,
    chartXmlCount: verification.chartXmlCount,
    mediaCount: verification.mediaCount,
    pdfPageCount: pdfVerification.pageCount,
    visualQaStatus: visualQa.report.overallStatus,
    visualQaScore: visualQa.report.score,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
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

function appendAssistantTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  message: Anthropic.Beta.BetaMessage,
): Anthropic.Beta.BetaMessageParam[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: message.content as Anthropic.Beta.BetaContentBlockParam[],
    },
  ];
}

function inferLanguageHint(brief: string) {
  return /\b(il|lo|la|gli|dei|delle|massimo|slide|chiari|famiglie|soluzioni|scenari|grafico)\b/i.test(brief)
    ? "Italian"
    : "English";
}

function parseArgs(argv: string[]) {
  let file: string | null = null;
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
    }
  }

  return { file, brief };
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

async function verifyPdf(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    return { valid: false, reason: "file does not start with %PDF", pageCount: 0 };
  }

  try {
    const parsed = await pdfParse(buffer);
    const pageCount = parsed.numpages ?? 0;
    if (pageCount === 0) {
      return { valid: false, reason: "pdf has zero pages", pageCount };
    }
    return { valid: true, reason: "", pageCount };
  } catch {
    return { valid: false, reason: "pdf parser could not parse the file", pageCount: 0 };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
