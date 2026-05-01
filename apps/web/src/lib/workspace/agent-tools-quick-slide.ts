import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";
import {
  createQuickSlideRun,
  isQuickSlideRateLimited,
} from "@/lib/workspace/quick-slide";
import { getScope } from "@/lib/workspace/scopes";

import type { AgentCallContext } from "@/lib/workspace/agent-tools";

/**
 * quickSlide: produces a single PPTX slide on a focused topic, in roughly
 * 30-90 seconds, using the workspace brand pack + scope context + any
 * attached evidence.
 *
 * The tool itself does NOT run the pipeline. It creates a quick_slide_runs
 * row and POSTs to /api/workspace/quick-slide which kicks off the after()
 * pipeline. The chat chip then polls GET /api/workspace/quick-slide/[id]
 * until status is 'ready' or 'error'.
 *
 * Trigger phrases (the agent calls this when the user says any of):
 *   English: "one slide", "quick slide", "show me a slide", "make a slide",
 *            "slide on X", "build a slide".
 *   Italian: "una slide", "fai una slide", "fammi una slide", "slide su X",
 *            "una presentazione veloce".
 *
 * The agent should call quickSlide instead of draftBrief when the user
 * asks for a SINGLE slide, not a deck. draftBrief is for multi-slide deck
 * generation via the existing prepare-generation drawer.
 */
export function quickSlideTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Produce one production-grade PPTX slide on a focused topic, in 30-90 seconds, using the workspace brand pack, scope context, and any evidence currently attached to this conversation. Use when the user asks for a single slide ('una slide', 'fai una slide', 'one slide', 'show me a slide on X'). Do NOT use for multi-slide decks: use draftBrief for those. Returns a QuickSlideCard chip the user sees in chat with progress and a download button when ready.",
    inputSchema: z.object({
      topic: z
        .string()
        .min(8)
        .max(400)
        .describe(
          "The slide's headline framing in plain language. Example: 'Mulino Bianco crackers Q1 2026 share trend vs private label'.",
        ),
      audience_hint: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Who will read the slide. Example: 'Trade marketing director'. Defaults to 'Insights stakeholder'.",
        ),
      data_focus: z
        .string()
        .max(400)
        .optional()
        .describe(
          "The specific cut of data to surface. Example: 'value share, last 4 quarters, by manufacturer'.",
        ),
      language: z
        .enum(["it", "en"])
        .default("it")
        .describe(
          "Output language. Italian (it) is the default; switch to en only if the user asked in English or specified an English audience.",
        ),
      extra_instructions: z
        .string()
        .max(1000)
        .optional()
        .describe(
          "Free-form constraints from the user (chart type, tone, callouts to highlight). Optional.",
        ),
      use_attached_evidence: z
        .boolean()
        .default(true)
        .describe(
          "When true (default) the pipeline auto-attaches up to 4 of this conversation's currently-attached evidence files (CSV, XLSX, PDF, DOCX). Set false when the user explicitly says 'do not use the attached files' or wants a brand-pack-only slide.",
        ),
    }),
    execute: async (input) => {
      // Guard against agents that fire quickSlide without conversation context.
      if (!ctx.conversationId) {
        return {
          ok: false,
          error: "no_conversation",
          message:
            "Quick slide needs an active chat conversation. Try again from a chat thread.",
        } as const;
      }

      // Per-user soft cap.
      if (await isQuickSlideRateLimited(ctx.userId)) {
        return {
          ok: false,
          error: "rate_limited",
          message:
            "You have used your hourly quick-slide budget (12 per hour). Try again in a bit, or use the full deck generator for a multi-slide pack.",
        } as const;
      }

      // Pick up to 4 evidence document ids from the current conversation.
      const evidenceDocIds: string[] = [];
      if (input.use_attached_evidence) {
        try {
          const attached = await listConversationAttachments(ctx.conversationId);
          for (const row of attached) {
            if (row.document_id && evidenceDocIds.length < 4) {
              evidenceDocIds.push(row.document_id);
            }
          }
        } catch (err) {
          console.error("[quickSlide] listConversationAttachments failed", err);
        }
      }

      // Resolve scope (best-effort; the API will revalidate).
      const scope = ctx.currentScopeId
        ? await getScope(ctx.currentScopeId).catch(() => null)
        : null;

      const row = await createQuickSlideRun({
        workspaceId: ctx.workspaceId,
        workspaceScopeId: scope?.id ?? null,
        conversationId: ctx.conversationId,
        createdBy: ctx.userId,
        brief: {
          topic: input.topic,
          audience: input.audience_hint,
          data_focus: input.data_focus,
          language: input.language,
          extra_instructions: input.extra_instructions,
        },
        evidenceDocIds,
      });

      // Kick the pipeline. We POST to our own /api endpoint so the
      // after() hook in that route runs the lightweight pipeline outside
      // the chat function's lifetime.
      //
      // Why fire-and-forget: the chat streamText is going to finish in a
      // few seconds; we do not want to block its turn waiting for a 60-90s
      // pipeline. The POST returns 202 immediately after creating the
      // after() registration, so this fetch is fast.
      const baseUrl = resolveSelfBaseUrl();
      void fetch(new URL("/api/workspace/quick-slide/dispatch", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-basquio-internal": process.env.BASQUIO_INTERNAL_TOKEN ?? "",
        },
        body: JSON.stringify({
          run_id: row.id,
          workspace_id: ctx.workspaceId,
          scope_id: scope?.id ?? null,
          brief: {
            topic: input.topic,
            audience: input.audience_hint,
            data_focus: input.data_focus,
            language: input.language,
            extra_instructions: input.extra_instructions,
          },
          evidence_doc_ids: evidenceDocIds,
        }),
      }).catch((err) => {
        console.error("[quickSlide] dispatch fetch failed", err);
      });

      return {
        ok: true,
        run_id: row.id,
        status: row.status,
        brief: row.brief,
        scope: scope ? { id: scope.id, kind: scope.kind, name: scope.name } : null,
        evidence_count: evidenceDocIds.length,
      } as const;
    },
  });
}

function resolveSelfBaseUrl(): string {
  // Vercel sets VERCEL_URL on every deployment. Locally we fall back to the
  // configured public URL or localhost.
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
