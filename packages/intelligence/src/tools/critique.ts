import { tool } from "ai";
import { z } from "zod";

import type { EvidenceWorkspace } from "@basquio/types";

// ─── TOOL CONTEXT ─────────────────────────────────────────────────

export type CritiqueToolContext = {
  workspace: EvidenceWorkspace;
  runId: string;
  getSlides: () => Promise<Array<{
    id: string;
    position: number;
    title: string;
    layoutId: string;
    chartId?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    evidenceIds: string[];
    metrics?: { label: string; value: string; delta?: string }[];
    speakerNotes?: string;
  }>>;
  getNotebookEntries: (evidenceRefId: string) => Promise<{
    toolName: string;
    toolOutput: Record<string, unknown>;
  } | null>;
  persistNotebookEntry: (entry: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
  }) => Promise<string>;
};

// ─── VERIFY CLAIM ─────────────────────────────────────────────────

export function createVerifyClaimTool(ctx: CritiqueToolContext) {
  return tool({
    description:
      "Verify a factual claim against the dataset. Queries the data to check if the claim is accurate. Use to audit every assertion in the deck.",
    inputSchema: z.object({
      claim: z.string().describe("The factual claim to verify"),
      expectedValue: z.string().optional().describe("The numeric or factual value asserted"),
      evidenceId: z.string().optional().describe("Evidence ref ID cited for this claim"),
      sourceFile: z.string().optional().describe("File to check against"),
    }),
    async execute(params) {
      let verified = false;
      let actualValue: string | undefined;
      let evidence: string | undefined;
      let confidence = 0;
      let discrepancy: string | undefined;

      // Look up evidence if referenced
      if (params.evidenceId) {
        const entry = await ctx.getNotebookEntries(params.evidenceId);
        if (entry) {
          evidence = JSON.stringify(entry.toolOutput);

          // Check if expected value matches
          const output = entry.toolOutput;
          if (params.expectedValue && output.value !== undefined) {
            actualValue = String(output.value);
            const expected = Number(params.expectedValue);
            const actual = Number(actualValue);
            if (!isNaN(expected) && !isNaN(actual)) {
              const tolerance = Math.abs(expected) * 0.01; // 1% tolerance
              verified = Math.abs(expected - actual) <= tolerance;
              if (!verified) {
                discrepancy = `Expected ${expected}, actual ${actual} (difference: ${Math.abs(expected - actual).toFixed(4)})`;
              }
              confidence = verified ? 1.0 : 0.3;
            } else {
              verified = String(params.expectedValue).trim() === String(output.value).trim();
              confidence = verified ? 1.0 : 0.5;
            }
          } else {
            // Evidence exists, no specific value to check
            verified = true;
            confidence = 0.8;
          }
        } else {
          discrepancy = `Evidence ref ${params.evidenceId} not found in notebook`;
          confidence = 0;
        }
      } else {
        // No evidence cited — flag as unverifiable
        discrepancy = "No evidence reference provided for this claim";
        confidence = 0.2;
      }

      const result = { verified, actualValue, evidence, confidence, discrepancy };

      await ctx.persistNotebookEntry({
        toolName: "verify_claim",
        toolInput: params,
        toolOutput: result,
      });

      return result;
    },
  });
}

// ─── CHECK NUMERIC ────────────────────────────────────────────────

export function createCheckNumericTool(ctx: CritiqueToolContext) {
  return tool({
    description:
      "Cross-check all numeric assertions in a slide's text against evidence. Extracts numbers from slide content and verifies each.",
    inputSchema: z.object({
      slideId: z.string().describe("Slide ID to check"),
    }),
    async execute({ slideId }) {
      const slides = await ctx.getSlides();
      const slide = slides.find((s) => s.id === slideId);

      if (!slide) {
        return { error: `Slide not found: ${slideId}`, assertions: [] };
      }

      // Extract numbers from slide text
      const allText = [
        slide.title,
        slide.body ?? "",
        ...(slide.bullets ?? []),
        ...(slide.metrics ?? []).map((m) => `${m.label}: ${m.value} ${m.delta ?? ""}`),
      ].join(" ");

      const numberPattern = /[-+]?\d+[.,]?\d*%?/g;
      const numbers = allText.match(numberPattern) ?? [];

      const assertions: Array<{
        text: string;
        citedValue: string;
        actualValue?: string;
        correct: boolean;
      }> = [];

      for (const num of numbers) {
        // Check against evidence refs on this slide
        let found = false;
        for (const evidenceId of slide.evidenceIds) {
          const entry = await ctx.getNotebookEntries(evidenceId);
          if (entry?.toolOutput.value !== undefined) {
            const actual = String(entry.toolOutput.value);
            if (actual.includes(num.replace(/[%,]/g, "")) || num.includes(actual)) {
              assertions.push({ text: num, citedValue: num, actualValue: actual, correct: true });
              found = true;
              break;
            }
          }
        }
        if (!found) {
          assertions.push({ text: num, citedValue: num, correct: false });
        }
      }

      const result = { slideId, assertions, numericCount: numbers.length };

      await ctx.persistNotebookEntry({
        toolName: "check_numeric",
        toolInput: { slideId },
        toolOutput: result,
      });

      return result;
    },
  });
}

// ─── COMPARE TO BRIEF ─────────────────────────────────────────────

export function createCompareToBriefTool(ctx: CritiqueToolContext) {
  return tool({
    description:
      "Check how well the deck addresses the brief objectives. Returns covered objectives, missed objectives, and an alignment score.",
    inputSchema: z.object({
      deckSummary: z.string().describe("Summary of the deck's content and argument"),
      brief: z.string().describe("The original business brief / objective"),
    }),
    async execute(params) {
      // This tool provides the data for the critic model to reason about.
      // The actual gap analysis is done by the model, not deterministically.
      const result = {
        deckSummary: params.deckSummary,
        brief: params.brief,
        instruction:
          "Compare the deck summary against the brief. Identify which objectives are covered, which are missed, and any gaps in coverage. Provide a score from 0-1.",
      };

      await ctx.persistNotebookEntry({
        toolName: "compare_to_brief",
        toolInput: params,
        toolOutput: { compared: true },
      });

      return result;
    },
  });
}

// ─── EXPORT ARTIFACTS ─────────────────────────────────────────────

export function createExportArtifactsTool(ctx: CritiqueToolContext) {
  return tool({
    description:
      "Export the deck to PPTX and/or PDF. Deterministic render from DeckSpecV2 via unified slide scene graph.",
    inputSchema: z.object({
      format: z.enum(["pptx", "pdf", "both"]).default("both"),
    }),
    async execute({ format }) {
      // Actual export is handled by the orchestration layer
      // This tool signals intent and will be wired to render-pptx + render-pdf
      const result = {
        format,
        status: "queued",
        message: `Export to ${format} has been queued. The orchestration layer will render via the unified slide scene graph.`,
      };

      await ctx.persistNotebookEntry({
        toolName: "export_artifacts",
        toolInput: { format },
        toolOutput: result,
      });

      return result;
    },
  });
}

// ─── QA ARTIFACTS ─────────────────────────────────────────────────

export function createQaArtifactsTool(ctx: CritiqueToolContext) {
  return tool({
    description:
      "Run QA checks on exported artifacts: checksums, page counts, slide counts, evidence coverage.",
    inputSchema: z.object({
      pptxUrl: z.string().optional(),
      pdfUrl: z.string().optional(),
    }),
    async execute(params) {
      // QA checks are implemented by the orchestration layer
      const result = {
        status: "queued",
        checks: [
          { name: "slide_count_match", description: "PPTX slide count matches DeckSpecV2" },
          { name: "pdf_page_match", description: "PDF pages match slide count (unified scene graph)" },
          { name: "evidence_coverage", description: "All slides cite evidence refs" },
          { name: "checksum_integrity", description: "File checksums valid" },
        ],
      };

      await ctx.persistNotebookEntry({
        toolName: "qa_artifacts",
        toolInput: params,
        toolOutput: result,
      });

      return result;
    },
  });
}
