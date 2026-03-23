import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";
import pdfParse from "pdf-parse";

import { runRenderedPageQa } from "../packages/workflows/src/rendered-page-qa";

const MODEL = "claude-sonnet-4-6";
const BETAS = [
  "files-api-2025-04-14",
  "code-execution-2025-08-25",
  "skills-2025-10-02",
] as const;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const client = new Anthropic({
    apiKey,
    maxRetries: 1,
    timeout: 15 * 60 * 1000,
  });

  const csvBuffer = buildFixtureCsv();
  const uploaded = await client.beta.files.upload({
    file: await toFile(csvBuffer, "smoke-input.csv"),
    betas: [...BETAS],
  });

  const system = [
    "You are testing Basquio's Claude code-execution deck path.",
    "Use code execution plus the PPTX and PDF skills to create one small but real PowerPoint deck and matching PDF.",
    "The deck must be concise, visually clean, and based only on the uploaded CSV.",
    "Use a premium dark editorial visual style with sparse accents and restrained card surfaces.",
    "For cross-viewer safety, use serif only for a short page headline if needed. Use Arial for all card titles, body copy, KPI numerals, recommendation numbers, and footer labels.",
    "Do not use stacked decorative ordinals, narrow title boxes, or floating footer metrics that depend on exact font metrics.",
    "Recommendation cards must reserve separate non-overlapping bands for index, title, body, and footer.",
    "If you create a chart, render it with matplotlib or seaborn to a PNG file and insert it with slide.shapes.add_picture(...).",
    "Do not use slide.shapes.add_chart(...) or any native PowerPoint chart object.",
    "Save the files as exactly `test-deck.pptx` and `test-deck.pdf` and attach both in your final assistant message as container_upload blocks before finishing.",
    "Do not print large tables to stdout.",
  ].join("\n");

  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "code_execution_20250825", name: "code_execution" },
  ];

  const initialMessage = {
    role: "user" as const,
    content: [
      { type: "container_upload" as const, file_id: uploaded.id },
      {
        type: "text" as const,
        text: [
          "Read the uploaded CSV and create a 3-slide PPTX deck.",
          "Slide 1: title and one-sentence takeaway.",
          "Slide 2: two recommendation cards supported by the numbers. Each card must use a simple single-line index badge, a short title, a short body, and a dedicated footer KPI band with no overlap.",
          "Slide 3: a simple chart or table summarising sales by category.",
          "If you use a chart on slide 3, it must be a PNG image generated in Python and inserted into the PPTX as a picture.",
          "Use the pptx and pdf skills and save the final files as `test-deck.pptx` and `test-deck.pdf`.",
          "Your final assistant message must attach both files as container_upload blocks.",
        ].join("\n"),
      },
    ],
  };

  const baseMessages: Anthropic.Beta.BetaMessageParam[] = [initialMessage];
  let messages: Anthropic.Beta.BetaMessageParam[] = [...baseMessages];
  let container: Anthropic.Beta.BetaContainerParams | undefined = {
    skills: [
      { type: "anthropic", skill_id: "pptx", version: "latest" },
      { type: "anthropic", skill_id: "pdf", version: "latest" },
    ],
  };
  let finalMessage: Anthropic.Beta.BetaMessage | null = null;
  const fileIds = new Set<string>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const response: Anthropic.Beta.BetaMessage = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4_096,
      betas: [...BETAS],
      system,
      messages,
      container,
      tools,
    });

    finalMessage = response;
    container = response.container ? { id: response.container.id } : container;
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;

    for (const fileId of collectGeneratedFileIds(response.content)) {
      fileIds.add(fileId);
    }

    if (response.stop_reason !== "pause_turn") {
      break;
    }

    messages = [
      ...baseMessages,
      {
        role: "assistant",
        content: response.content as Anthropic.Beta.BetaContentBlockParam[],
      },
    ];
  }

  if (!finalMessage) {
    throw new Error("Claude did not return a final message.");
  }

  const generated = await downloadGeneratedFiles(client, [...fileIds]);
  const pptx = generated.find((file) => file.fileName === "test-deck.pptx" || file.fileName.endsWith("/test-deck.pptx"));
  const pdf = generated.find((file) => file.fileName === "test-deck.pdf" || file.fileName.endsWith("/test-deck.pdf"));
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
    manifest: {
      slideCount: verification.slideCount,
      slides: [
        { position: 1, title: "Title slide", layoutId: "cover", slideArchetype: "cover" },
        { position: 2, title: "Recommendations", layoutId: "title-body", slideArchetype: "recommendation-cards" },
        { position: 3, title: "Sales by category", layoutId: "title-chart", slideArchetype: "title-chart" },
      ],
    },
    betas: ["files-api-2025-04-14"],
  });

  if (visualQa.report.deckNeedsRevision || visualQa.report.overallStatus !== "green") {
    throw new Error(`Rendered-page QA failed: ${JSON.stringify(visualQa.report)}`);
  }

  const outputDir = path.join(process.cwd(), "test-output", "code-exec-smoke");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "test-deck.pptx");
  const pdfPath = path.join(outputDir, "test-deck.pdf");
  await writeFile(outputPath, pptx.buffer);
  await writeFile(pdfPath, pdf.buffer);

  console.log(JSON.stringify({
    outputPath,
    pdfPath,
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
