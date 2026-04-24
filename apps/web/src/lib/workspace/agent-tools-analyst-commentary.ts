import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { tool } from "ai";
import { z } from "zod";

import { uploadFileToAnthropic, confirmAnthropicFile } from "@/lib/workspace/anthropic-files";
import { CLAUDE_ANALYST_COMMENTARY_PROMPT } from "@/lib/workspace/agent-analyst-commentary-prompt";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";
import {
  fetchAttachedFilesByDocumentIds,
  type AttachedWorkspaceFile,
} from "@/lib/workspace/documents";
import { setDocumentAnthropicFileId } from "@/lib/workspace/db";

const FILES_API_BETA = "files-api-2025-04-14";
const CODE_EXECUTION_BETA = "code-execution-2025-08-25";
const COMMENTARY_MODEL = "claude-sonnet-4-6";

const commentaryInputSchema = z.object({
  document_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(8)
    .describe("IDs of knowledge_documents attached to this conversation."),
  objective: z
    .string()
    .min(10)
    .max(500)
    .describe("What the commentary should focus on."),
  output_format: z
    .enum(["analyst_markdown", "slide_speaker_notes", "inline_bullets"])
    .default("analyst_markdown"),
  scope_context: z
    .string()
    .max(500)
    .nullable()
    .default(null)
    .describe("Optional workspace scope context, such as client name or category."),
});

export function analystCommentaryTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Read multiple attached files (PDFs, PPTX, DOCX, MD) and produce analyst-grade commentary. Use when the user asks to comment on a slide, synthesize insights across documents, or add analyst annotations to attached content. Prefer this over retrieveContext when the user explicitly refers to attached files. Do NOT use for structured-data questions; use analyzeAttachedFile for those.",
    inputSchema: commentaryInputSchema,
    execute: async (input) => {
      const files = await fetchAttachedFilesByDocumentIds(ctx.workspaceId, input.document_ids);
      if (files.length === 0) {
        return { error: "No indexed, accessible files found for the given document IDs." };
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return { error: "Analyst commentary failed: ANTHROPIC_API_KEY is not configured." };
      }

      const uploaded = await resolveAnthropicUploads(files);
      if (uploaded.length === 0) {
        return {
          error:
            "Analyst commentary failed: no files could be mounted for code execution. Try again after upload processing finishes.",
        };
      }

      const client = new Anthropic({ apiKey });
      const response = await client.beta.messages.create({
        model: COMMENTARY_MODEL,
        max_tokens: 8000,
        betas: [FILES_API_BETA, CODE_EXECUTION_BETA],
        tools: [
          { type: "code_execution_20250825", name: "code_execution" },
        ] as unknown as Anthropic.Beta.Messages.BetaToolUnion[],
        system: CLAUDE_ANALYST_COMMENTARY_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              ...uploaded.map((file) => ({ type: "container_upload", file_id: file.fileId })),
              {
                type: "text",
                text: renderCommentaryInstruction({
                  fileNames: uploaded.map((file) => file.filename),
                  objective: input.objective,
                  outputFormat: input.output_format,
                  scopeContext: input.scope_context,
                }),
              },
            ] as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[],
          },
        ],
      });

      return {
        commentary: extractCommentaryMarkdown(response),
        file_names: uploaded.map((file) => file.filename),
        model: COMMENTARY_MODEL,
        output_format: input.output_format,
      };
    },
  });
}

export function renderCommentaryInstruction(input: {
  fileNames: string[];
  objective: string;
  outputFormat: z.infer<typeof commentaryInputSchema>["output_format"];
  scopeContext: string | null;
}): string {
  const lines = [
    "Files mounted for this commentary:",
    ...input.fileNames.map((name, index) => `${index + 1}. ${name}`),
    "",
    `Objective: ${input.objective}`,
    `Output format: ${input.outputFormat}`,
  ];
  if (input.scopeContext) {
    lines.push(`Workspace context: ${input.scopeContext}`);
  }
  lines.push("", "Write the commentary now.");
  return lines.join("\n");
}

export function extractCommentaryMarkdown(
  response: Anthropic.Beta.Messages.BetaMessage,
): string {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n\n")
    .trim();
}

async function resolveAnthropicUploads(
  files: AttachedWorkspaceFile[],
): Promise<Array<{ file: AttachedWorkspaceFile; filename: string; fileId: string }>> {
  const uploaded: Array<{ file: AttachedWorkspaceFile; filename: string; fileId: string }> = [];
  for (const file of files) {
    let fileId = file.anthropicFileId;
    if (fileId) {
      const valid = await confirmAnthropicFile(fileId);
      if (!valid) fileId = null;
    }
    if (!fileId) {
      fileId = await uploadFileToAnthropic({
        buffer: file.buffer,
        filename: file.filename,
        contentType: file.contentType,
      });
      if (fileId) {
        await setDocumentAnthropicFileId(file.documentId, fileId).catch(() => {});
      }
    }
    if (fileId) {
      uploaded.push({ file, filename: file.filename, fileId });
    }
  }
  return uploaded;
}
