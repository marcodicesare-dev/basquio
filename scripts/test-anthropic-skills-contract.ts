import Anthropic, { toFile } from "@anthropic-ai/sdk";

import {
  assertAuthoringExecutionContract,
  BETAS,
  buildAuthoringContainer,
  buildAuthoringOutputConfig,
  buildClaudeTools,
  type WebFetchMode,
} from "../packages/workflows/src/anthropic-execution-contract";
import { loadBasquioScriptEnv } from "./load-app-env";

const MODEL = "claude-sonnet-4-6";

loadBasquioScriptEnv();

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const options = parseArgs(process.argv.slice(2));
  const client = new Anthropic({
    apiKey,
    maxRetries: 1,
    timeout: 120_000,
  });

  const uploaded = await client.beta.files.upload({
    file: await toFile(buildFixtureCsv(), "skills-contract-smoke.csv"),
    betas: [...BETAS],
  });

  const tools = buildClaudeTools(MODEL, { webFetchMode: options.webFetchMode });
  assertAuthoringExecutionContract({
    model: MODEL,
    phase: "smoke",
    tools,
    skills: ["pptx"],
    webFetchMode: options.webFetchMode,
  });

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    betas: [...BETAS],
    system: [
      "Read the uploaded CSV inside code execution.",
      "Compute the total sales column.",
      "Reply with exactly one sentence in this format: smoke ok <number>.",
      "Do not use web fetch.",
    ].join(" "),
    container: buildAuthoringContainer(undefined, MODEL),
    tools,
    output_config: buildAuthoringOutputConfig(MODEL),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Use code execution to read the uploaded CSV and compute the total sales value.",
          },
          { type: "container_upload", file_id: uploaded.id },
        ],
      },
    ],
  });

  const text = extractText(response.content).trim();
  const codeExecutionStarted = response.content.some((block) => block.type.includes("code_execution"));

  if (!codeExecutionStarted) {
    throw new Error(
      `Smoke failed: Claude response did not include any code execution blocks. stop_reason=${response.stop_reason ?? "unknown"}`,
    );
  }

  if (!/^smoke ok \d+\.?$/i.test(text)) {
    throw new Error(`Smoke failed: unexpected text response: ${text || "empty"}`);
  }

  console.log(
    JSON.stringify(
      {
        model: MODEL,
        webFetchMode: options.webFetchMode,
        toolNames: tools.flatMap((tool) => ("name" in tool && typeof tool.name === "string" ? [tool.name] : [])),
        stopReason: response.stop_reason ?? null,
        text,
      },
      null,
      2,
    ),
  );
}

function buildFixtureCsv() {
  return Buffer.from(
    [
      "category,market,sales",
      "Dog Food,Italy,124000",
      "Cat Food,Italy,98000",
      "Treats,Italy,56000",
      "Dog Food,Spain,111000",
      "Cat Food,Spain,93000",
      "Treats,Spain,61000",
    ].join("\n"),
    "utf8",
  );
}

function parseArgs(argv: string[]) {
  let webFetchMode: WebFetchMode = "off";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--web-fetch-mode") continue;
    const value = argv[index + 1];
    if (value !== "off" && value !== "enrich") {
      throw new Error(`Invalid --web-fetch-mode value: ${value ?? "missing"}`);
    }
    webFetchMode = value;
    index += 1;
  }
  return { webFetchMode };
}

function extractText(blocks: Anthropic.Beta.BetaContentBlock[]) {
  return blocks
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
