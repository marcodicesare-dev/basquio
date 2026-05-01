import Anthropic from "@anthropic-ai/sdk";
import { toFile } from "@anthropic-ai/sdk/uploads";
import {
  buildClaudeBetas,
  buildClaudeTools,
  buildAuthoringContainer,
  FILES_BETA,
} from "../anthropic-execution-contract";
import { downloadFromStorage, uploadToStorage } from "../supabase";
import { KNOWLEDGE_BUCKET } from "../workspace/constants";

/**
 * Lightweight quick-slide pipeline.
 *
 * Lives at the chat layer, not the V6 worker layer. One Anthropic call,
 * Sonnet 4.6 by default, code execution + PPTX skill, no web fetch, no
 * critique, no revise. Target: median 45s, p95 75s, hard cap 90s.
 *
 * Inputs come from the API route, which already loaded the row, scope
 * context pack, workspace brand pack, and evidence document buffers.
 *
 * Outputs:
 *   - pptxBuffer: the slide.pptx file Claude produced
 *   - costUsd: real billed cost (input + cache + output)
 *   - durationMs: wall time spent on the Anthropic call
 *
 * Errors are thrown. Caller must catch and update the row to status='error'.
 */

export type QuickSlidePipelineInput = {
  brief: {
    topic: string;
    audience?: string;
    data_focus?: string;
    language: "it" | "en";
    extra_instructions?: string;
  };
  workspaceBrandPack: string;
  scopeContextPack: string;
  evidenceFiles: Array<{
    fileName: string;
    buffer: Buffer;
  }>;
  /** Called as the pipeline progresses so the row's last_event_message stays fresh. */
  onProgress?: (phase: string, message: string) => Promise<void>;
};

export type QuickSlidePipelineOutput = {
  pptxBuffer: Buffer;
  costUsd: number;
  durationMs: number;
};

const QUICK_SLIDE_MODEL = "claude-sonnet-4-6";
const QUICK_SLIDE_MAX_TOKENS = 16_000;

const SYSTEM_PROMPT = `You are Basquio's quick-slide generator. You produce one consulting-grade single-slide PPTX from a brief, the workspace brand pack, the scope context, and any attached evidence.

YOU PRODUCE EXACTLY ONE SLIDE
Not a deck, not a multi-slide pack, not a template. One slide. The user picked the quick path because they want one slide fast.

OUTPUT CONTRACT
Use the PPTX skill (PptxGenJS in Node.js) loaded in your container. Generate exactly one file named slide.pptx. Standard 16:9 size (10 inches by 5.625 inches).

THE SLIDE STRUCTURE
A consulting slide has these slots, top to bottom:
1. Headline (1 line, sentence case, the takeaway in plain language). Top-left, ~28pt bold, dark text.
2. Sub-headline / SCQA framing (1-2 lines, ~14pt regular, soft gray). Optional but usually helpful.
3. Body content slot (1 chart OR 1 table OR 3 cards OR 1 quote). Center, taking ~70% of the slide height.
4. Source line (~9pt mono, bottom-left, prefix "Source: "). Always present. Cite the evidence file or the workspace brand pack.

USE THE BRAND PACK
The workspace brand pack carries fonts, primary color, and chart palette. Read it from the system message and apply it. Do not hardcode colors that contradict the brand pack.

DATA HANDLING
If evidence files are attached, load them with pandas (or PptxGenJS native data tables) and pull the actual numbers. Do not fabricate. If data_focus says "value share Q1 2026" and the workbook has that column, use it; if not, say so in the headline ("Q1 2026 value share not available in attached data") rather than invent.

LANGUAGE
The brief carries language: "it" or "en". Write all visible text in that language. Italian for Italian briefs, English otherwise.

FEW-SHOT EXAMPLE: chart slide
\`\`\`javascript
const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_16x9";

const slide = pptx.addSlide();
slide.background = { color: "FFFFFF" };

slide.addText("Mulino Bianco crackers ceded 1.4pp share to private label in Q1 2026", {
  x: 0.5, y: 0.35, w: 9.0, h: 0.7,
  fontSize: 26, bold: true, fontFace: "Inter", color: "0B0C0C",
  fitShape: true,
});

slide.addText("Private label gained from premium re-pricing on multipack SKUs. Recommend a defensive everyday-low-price test on the 200g multipack within 4 weeks.", {
  x: 0.5, y: 1.05, w: 9.0, h: 0.55,
  fontSize: 13, color: "5C6068", fontFace: "Inter",
});

slide.addChart(pptx.ChartType.bar, [
  { name: "Q1 2026", labels: ["Mulino Bianco", "Doria", "Private Label", "Misura"], values: [22.1, 11.4, 18.2, 9.7] },
  { name: "Q1 2025", labels: ["Mulino Bianco", "Doria", "Private Label", "Misura"], values: [23.5, 11.6, 16.8, 9.4] },
], {
  x: 0.5, y: 1.7, w: 9.0, h: 3.4,
  showTitle: false,
  showLegend: true, legendPos: "b",
  chartColors: ["1A6AFF", "AAB0B8"],
  catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
});

slide.addText("Source: Nielsen RMS, Mulino Bianco crackers, Q1 2026 value share, week-ending data", {
  x: 0.5, y: 5.2, w: 9.0, h: 0.3,
  fontSize: 9, fontFace: "JetBrains Mono", color: "808890",
});

await pptx.writeFile({ fileName: "slide.pptx" });
\`\`\`

YOU MUST FINISH IN ONE TURN
Do not pause for clarifications. Do not ask questions. Do not narrate progress. Read the brief, read the evidence (if any), produce slide.pptx. The file is the entire output.

If something blocks you (no usable evidence + no relevant workspace data), produce a slide that says so plainly in the headline rather than refuse. Example headline: "Need fresher data: latest Mulino Bianco share row is 2024, not Q1 2026". This is still a useful slide.`;

function buildUserMessage(input: QuickSlidePipelineInput): string {
  const lines: string[] = [
    `# Quick slide brief`,
    ``,
    `Topic: ${input.brief.topic}`,
  ];
  if (input.brief.audience) lines.push(`Audience: ${input.brief.audience}`);
  if (input.brief.data_focus) lines.push(`Data focus: ${input.brief.data_focus}`);
  lines.push(`Language: ${input.brief.language}`);
  if (input.brief.extra_instructions) {
    lines.push(``, `Extra instructions:`, input.brief.extra_instructions);
  }
  lines.push(
    ``,
    `# Workspace brand pack`,
    ``,
    input.workspaceBrandPack || "(no brand pack configured; use clean defaults: Inter font, primary color #1A6AFF, neutral gray scale)",
    ``,
    `# Scope context pack`,
    ``,
    input.scopeContextPack || "(no scope context for this turn)",
    ``,
  );
  if (input.evidenceFiles.length > 0) {
    lines.push(`# Evidence`, ``);
    lines.push(`The following files are uploaded to your container. Load them with pandas (CSV/XLSX) or extract text (PDF/DOCX). Use real numbers, not fabrications.`);
    lines.push(``);
    for (const file of input.evidenceFiles) {
      lines.push(`- ${file.fileName}`);
    }
    lines.push(``);
  } else {
    lines.push(`# Evidence`, ``, `(none attached this turn; rely on the workspace brand pack and scope context)`, ``);
  }
  lines.push(
    `# Now produce slide.pptx`,
    ``,
    `Single PPTX file, exactly one slide, standard 16:9 layout. Apply the brand pack. Cite the source line. Finish in one turn.`,
  );
  return lines.join("\n");
}

export async function generateQuickSlide(
  input: QuickSlidePipelineInput,
): Promise<QuickSlidePipelineOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const client = new Anthropic({
    apiKey,
    timeout: 90_000,
    maxRetries: 0,
  });

  await input.onProgress?.("ingesting", "Uploading evidence to the model");

  const uploadedFiles = await Promise.all(
    input.evidenceFiles.map(async (file) => {
      const uploaded = await client.beta.files.upload({
        file: await toFile(file.buffer, file.fileName),
        betas: [FILES_BETA],
      });
      return { fileName: file.fileName, fileId: uploaded.id };
    }),
  );

  const userMessage = buildUserMessage(input);
  const messageContent: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: userMessage },
    ...uploadedFiles.map(
      (f) =>
        ({
          type: "container_upload",
          file_id: f.fileId,
        }) satisfies Anthropic.Beta.BetaContentBlockParam,
    ),
  ];

  await input.onProgress?.("generating", "Generating the slide");

  const startedAt = Date.now();
  const stream = client.beta.messages.stream({
    model: QUICK_SLIDE_MODEL,
    max_tokens: QUICK_SLIDE_MAX_TOKENS,
    betas: buildClaudeBetas(QUICK_SLIDE_MODEL),
    system: SYSTEM_PROMPT,
    container: buildAuthoringContainer(undefined, QUICK_SLIDE_MODEL),
    messages: [
      {
        role: "user",
        content: messageContent,
      },
    ],
    tools: buildClaudeTools(QUICK_SLIDE_MODEL, { webFetchMode: "off" }),
  });

  const finalMessage = await stream.finalMessage();
  const durationMs = Date.now() - startedAt;

  await input.onProgress?.("rendering", "Saving the file");

  // Find the slide.pptx in the code execution tool result blocks.
  // The skill writes to /tmp/outputs and the API returns container_upload-style
  // file ids. We scan every code_execution_tool_result block for a .pptx file.
  const fileIds = new Set<string>();
  for (const block of finalMessage.content) {
    if (block.type === "code_execution_tool_result") {
      const content = (block as Anthropic.Beta.BetaCodeExecutionToolResultBlock).content;
      if (content && typeof content === "object" && "type" in content && content.type === "code_execution_result") {
        const filesProduced = (content as { content?: Array<{ type: string; file_id?: string; filename?: string }> }).content;
        if (Array.isArray(filesProduced)) {
          for (const entry of filesProduced) {
            if (entry.type === "code_execution_output" && entry.file_id) {
              fileIds.add(entry.file_id);
            }
          }
        }
      }
    }
  }

  if (fileIds.size === 0) {
    throw new Error("Quick slide pipeline did not produce any container files.");
  }

  // Download every file id, find the .pptx by name.
  const downloads = await Promise.all(
    Array.from(fileIds).map(async (fileId) => {
      const meta = await client.beta.files.retrieveMetadata(fileId, { betas: [FILES_BETA] });
      const dl = await client.beta.files.download(fileId, { betas: [FILES_BETA] });
      const buf = Buffer.from(await dl.arrayBuffer());
      return { fileId, fileName: meta.filename, buffer: buf };
    }),
  );

  const pptx = downloads.find((d) => /\.pptx$/i.test(d.fileName));
  if (!pptx) {
    const names = downloads.map((d) => d.fileName).join(", ");
    throw new Error(`Quick slide pipeline did not produce a .pptx file (got: ${names}).`);
  }

  // Validate it's a real zip (PPTX = ZIP) by checking the magic bytes.
  if (pptx.buffer.length < 4 || pptx.buffer[0] !== 0x50 || pptx.buffer[1] !== 0x4b) {
    throw new Error("Quick slide pipeline produced an invalid PPTX (missing ZIP signature).");
  }

  const usage = finalMessage.usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const costUsd = computeSonnetCostUsd(usage);

  return {
    pptxBuffer: pptx.buffer,
    costUsd,
    durationMs,
  };
}

/**
 * Sonnet 4.6 pricing as of May 2026 (per million tokens):
 *   input:           $3.00
 *   output:          $15.00
 *   cache write 5m:  $3.75 (1.25x base)
 *   cache write 1h:  $6.00 (2x base)
 *   cache read:      $0.30 (0.1x base)
 *
 * Quick slide does not use cache writes (single turn, no setup), so we
 * count input + output + cache_read as the dominant terms.
 */
function computeSonnetCostUsd(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}) {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (input * 3.0 +
      output * 15.0 +
      cacheWrite * 3.75 +
      cacheRead * 0.3) / 1_000_000
  );
}

/**
 * Helper for the API route: download an evidence file from Supabase storage
 * given its knowledge_documents.storage_path. Wraps downloadFromStorage so
 * the route does not import @basquio/workflows internals.
 */
export async function loadEvidenceFromStorage(input: {
  supabaseUrl: string;
  serviceKey: string;
  storagePath: string;
}): Promise<Buffer> {
  return downloadFromStorage({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    bucket: KNOWLEDGE_BUCKET,
    storagePath: input.storagePath,
  });
}

/**
 * Helper for the API route: upload the produced PPTX to the same knowledge
 * bucket under the quick-slides prefix. Returns the storage path so the
 * route can write it to the row.
 */
export async function uploadQuickSlidePptx(input: {
  supabaseUrl: string;
  serviceKey: string;
  workspaceId: string;
  runId: string;
  buffer: Buffer;
}): Promise<string> {
  const storagePath = `quick-slides/${input.workspaceId}/${input.runId}/slide.pptx`;
  await uploadToStorage({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    bucket: KNOWLEDGE_BUCKET,
    storagePath,
    body: input.buffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    upsert: true,
  });
  return storagePath;
}

export const QUICK_SLIDE_BUCKET = KNOWLEDGE_BUCKET;
