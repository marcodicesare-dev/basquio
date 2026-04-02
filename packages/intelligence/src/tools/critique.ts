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

      if (params.evidenceId) {
        const entry = await ctx.getNotebookEntries(params.evidenceId);
        if (entry) {
          evidence = JSON.stringify(entry.toolOutput);
          const output = entry.toolOutput;
          if (params.expectedValue && output.value !== undefined) {
            actualValue = String(output.value);
            const expected = Number(params.expectedValue);
            const actual = Number(actualValue);
            if (!isNaN(expected) && !isNaN(actual)) {
              const tolerance = Math.abs(expected) * 0.01;
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
            // Evidence exists but no expected value to compare — NOT verified.
            // The critic must provide an expectedValue to confirm the claim.
            // Marking this as verified would be a hallucination channel.
            verified = false;
            confidence = 0.3;
            discrepancy = "Evidence exists but no expectedValue was provided to verify against. Claim is unverified.";
          }
        } else {
          discrepancy = `Evidence ref ${params.evidenceId} not found in notebook`;
          confidence = 0;
        }
      } else {
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
      // Accept UUID, position number, or "Slide N" text
      let slide = slides.find((s) => s.id === slideId);
      if (!slide) {
        const posMatch = slideId.match(/(\d+)/);
        if (posMatch) {
          slide = slides.find((s) => s.position === parseInt(posMatch[1], 10));
        }
      }

      if (!slide) {
        return { error: `Slide not found: ${slideId}`, assertions: [] };
      }

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

// ─── AUDIT DECK STRUCTURE (deterministic) ─────────────────────────

export function createAuditDeckStructureTool(ctx: CritiqueToolContext) {
  return tool({
    description:
      "Run deterministic structural checks on the entire deck. Catches sparse slides, layout monotony, missing notes, weak titles, and density problems. Call this FIRST before model-based review.",
    inputSchema: z.object({}),
    async execute() {
      const slides = await ctx.getSlides();
      const issues: Array<{ severity: string; slidePosition?: number; description: string; fix: string }> = [];

      if (slides.length === 0) {
        return { error: "No slides found", issues: [] };
      }

      const contentSlides = slides.filter((s) => s.layoutId !== "cover");

      // ── Title quality ──
      for (const s of contentSlides) {
        const words = s.title.split(/\s+/).length;
        if (words < 5) {
          issues.push({
            severity: "major",
            slidePosition: s.position,
            description: `Title too short (${words} words): "${s.title}" — not an action title`,
            fix: "Rewrite as a full sentence stating a specific, data-backed takeaway",
          });
        }
        // Check for topic-label patterns (no verb, no number)
        const hasNumber = /\d/.test(s.title);
        const hasVerb = /\b(is|are|has|have|show|grew|declined|increased|decreased|represents|accounts|drives|creates|generates|remains|exceeds|outperform|underperform)\b/i.test(s.title);
        if (!hasNumber && !hasVerb && words >= 3) {
          issues.push({
            severity: "major",
            slidePosition: s.position,
            description: `Title appears to be a topic label: "${s.title}" — no number or verb found`,
            fix: "Add a specific claim with data: e.g., 'Market grew 3.1% to €2.2bn driven by cat food'",
          });
        }
      }

      // ── Layout diversity ──
      const layoutCounts: Record<string, number> = {};
      for (const s of slides) {
        layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
      }
      const uniqueLayouts = Object.keys(layoutCounts).length;
      const minimumUniqueLayouts = slides.length >= 15 ? 5 : slides.length >= 10 ? 4 : slides.length > 5 ? 3 : 0;
      if (minimumUniqueLayouts > 0 && uniqueLayouts < minimumUniqueLayouts) {
        issues.push({
          severity: "major",
          description: `Only ${uniqueLayouts} layout type(s) used across ${slides.length} slides. Professional decks at this length need at least ${minimumUniqueLayouts} layouts.`,
          fix: "Replace some slides with title-chart, chart-split, evidence-grid, comparison, metrics, or summary layouts",
        });
      }
      const maxLayout = Object.entries(layoutCounts).sort((a, b) => b[1] - a[1])[0];
      if (maxLayout && maxLayout[1] / slides.length > 0.4 && slides.length > 5) {
        issues.push({
          severity: "major",
          description: `Layout "${maxLayout[0]}" used ${maxLayout[1]}/${slides.length} times (${Math.round(maxLayout[1] / slides.length * 100)}%). Max 40% recommended.`,
          fix: `Replace ${Math.ceil(maxLayout[1] - slides.length * 0.4)} slides with different layouts`,
        });
      }

      // ── Content density per slide ──
      for (const s of contentSlides) {
        const hasChart = Boolean(s.chartId);
        const hasMetrics = Boolean(s.metrics && s.metrics.length > 0);
        const hasBody = Boolean(s.body && s.body.trim().length > 10);
        const hasBullets = Boolean(s.bullets && s.bullets.length > 0);
        const hasNotes = Boolean(s.speakerNotes && s.speakerNotes.trim().length > 10);
        const hasEvidence = s.evidenceIds.length > 0;

        // Title-only slides
        if (!hasChart && !hasMetrics && !hasBody && !hasBullets) {
          issues.push({
            severity: "critical",
            slidePosition: s.position,
            description: `Slide ${s.position} has only a title — no chart, no body, no metrics, no bullets`,
            fix: "Add a chart (build_chart) or body text or bullet points. Every content slide must have substance.",
          });
        }

        // Missing speaker notes
        if (!hasNotes) {
          issues.push({
            severity: "minor",
            slidePosition: s.position,
            description: `Slide ${s.position} has no speaker notes`,
            fix: "Add 60-140 words of presenter narrative, caveats, methodology, transitions",
          });
        }

        // Missing evidence
        if (!hasEvidence) {
          issues.push({
            severity: "major",
            slidePosition: s.position,
            description: `Slide ${s.position} cites no evidence IDs`,
            fix: "Link to evidence ref IDs from the analyst notebook to ground claims",
          });
        }

        // Body too long
        if (s.body && s.body.split(/\s+/).length > 80) {
          issues.push({
            severity: "minor",
            slidePosition: s.position,
            description: `Slide ${s.position} body is ${s.body.split(/\s+/).length} words (max 80)`,
            fix: "Trim to 55-80 words. Move details to speaker notes or split into two slides.",
          });
        }

        // Too many bullets
        if (s.bullets && s.bullets.length > 5) {
          issues.push({
            severity: "minor",
            slidePosition: s.position,
            description: `Slide ${s.position} has ${s.bullets.length} bullets (max 5)`,
            fix: "Consolidate to 4-5 key points. Move supporting detail to body or speaker notes.",
          });
        }
      }

      // ── Chart coverage ──
      const chartSlides = contentSlides.filter((s) => s.chartId);
      if (chartSlides.length < contentSlides.length * 0.3 && contentSlides.length > 4) {
        issues.push({
          severity: "major",
          description: `Only ${chartSlides.length}/${contentSlides.length} content slides have charts. Data-driven decks need ≥40% chart coverage.`,
          fix: "Add charts to more slides using build_chart. Every evidence slide should have a visualization.",
        });
      }

      // ── Exec summary check ──
      const execSlide = slides.find((s) => s.layoutId === "exec-summary" || s.layoutId === "metrics");
      if (!execSlide && slides.length > 5) {
        issues.push({
          severity: "major",
          description: "No executive summary slide found. Decks >5 slides need an exec summary with 3-4 KPIs.",
          fix: "Add a metrics or exec-summary layout slide at position 2 with 3-4 KPI cards",
        });
      }

      // ── Summary/recommendation check ──
      const summarySlide = slides.find((s) => s.layoutId === "summary");
      if (!summarySlide && slides.length > 5) {
        issues.push({
          severity: "minor",
          description: "No summary/recommendation slide found",
          fix: "Add a summary layout as the last content slide with actionable recommendations",
        });
      }

      const criticalCount = issues.filter((i) => i.severity === "critical").length;
      const majorCount = issues.filter((i) => i.severity === "major").length;
      const minorCount = issues.filter((i) => i.severity === "minor").length;

      const result = {
        slideCount: slides.length,
        layoutDistribution: layoutCounts,
        issues,
        summary: {
          critical: criticalCount,
          major: majorCount,
          minor: minorCount,
          total: issues.length,
          verdict: criticalCount > 0 ? "FAIL" : majorCount > 3 ? "NEEDS_WORK" : "ACCEPTABLE",
        },
      };

      await ctx.persistNotebookEntry({
        toolName: "audit_deck_structure",
        toolInput: {},
        toolOutput: { slideCount: slides.length, issueCount: issues.length, verdict: result.summary.verdict },
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
