import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import {
  buildScopeContextPack,
  buildWorkspaceBrandPack,
} from "@/lib/workspace/build-context-pack";
import {
  updateQuickSlideRun,
  type QuickSlideBrief,
} from "@/lib/workspace/quick-slide";
import {
  generateQuickSlide,
  uploadQuickSlidePptx,
} from "@basquio/workflows/quick-slide/generate";

/**
 * Server-side pipeline runner for a quick_slide_runs row. Loads scope
 * context, workspace brand pack, evidence files, calls the lightweight
 * Anthropic pipeline, uploads the PPTX, and writes back the final row
 * state. Catches every error path and writes status='error' so the chat
 * chip can surface a useful message rather than spin forever.
 *
 * Caller MUST schedule this via `after()` (in a Next.js route) or
 * fire-and-forget. It blocks for up to 90s and returns nothing useful.
 */
export async function runQuickSlidePipeline(input: {
  runId: string;
  workspaceId: string;
  scopeId: string | null;
  brief: QuickSlideBrief;
  evidenceDocIds: string[];
}): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    await updateQuickSlideRun(input.runId, {
      status: "error",
      error_message: "Supabase storage is not configured on the server.",
      last_event_phase: "error",
      last_event_message: "Supabase storage is not configured on the server.",
    });
    return;
  }

  try {
    await updateQuickSlideRun(input.runId, {
      status: "running",
      last_event_phase: "briefing",
      last_event_message: "Loading workspace context",
    });

    const [workspaceBrandPack, scopeContextPack] = await Promise.all([
      buildWorkspaceBrandPack(input.workspaceId).catch((err) => {
        console.error("[quick-slide] buildWorkspaceBrandPack failed", err);
        return "";
      }),
      buildScopeContextPack(input.workspaceId, input.scopeId).catch((err) => {
        console.error("[quick-slide] buildScopeContextPack failed", err);
        return "";
      }),
    ]);

    const db = createServiceSupabaseClient(supabaseUrl, serviceKey);
    const evidenceFiles: Array<{ fileName: string; buffer: Buffer }> = [];
    if (input.evidenceDocIds.length > 0) {
      const { data: docs, error: docsError } = await db
        .from("knowledge_documents")
        .select("id, filename, storage_path")
        .in("id", input.evidenceDocIds);
      if (docsError) {
        throw new Error(`Loading evidence rows failed: ${docsError.message}`);
      }
      const rows = (docs ?? []) as Array<{
        id: string;
        filename: string | null;
        storage_path: string | null;
      }>;
      const supabaseModule = await import("@basquio/workflows/supabase");
      for (const doc of rows) {
        if (!doc.storage_path) continue;
        try {
          const buf = await supabaseModule.downloadFromStorage({
            supabaseUrl,
            serviceKey,
            bucket: "knowledge-base",
            storagePath: doc.storage_path,
          });
          evidenceFiles.push({
            fileName: doc.filename ?? `evidence-${doc.id}`,
            buffer: buf,
          });
        } catch (err) {
          console.error(`[quick-slide] evidence load failed for ${doc.id}`, err);
        }
      }
    }

    const result = await generateQuickSlide({
      brief: input.brief,
      workspaceBrandPack,
      scopeContextPack,
      evidenceFiles,
      onProgress: async (phase, message) => {
        await updateQuickSlideRun(input.runId, {
          last_event_phase: phase,
          last_event_message: message,
        }).catch(() => {});
      },
    });

    const storagePath = await uploadQuickSlidePptx({
      supabaseUrl,
      serviceKey,
      workspaceId: input.workspaceId,
      runId: input.runId,
      buffer: result.pptxBuffer,
    });

    await updateQuickSlideRun(input.runId, {
      status: "ready",
      pptx_storage_path: storagePath,
      cost_usd: result.costUsd,
      duration_ms: result.durationMs,
      last_event_phase: "ready",
      last_event_message: "Slide ready",
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message.slice(0, 600)
        : "Quick slide generation failed.";
    console.error(`[quick-slide] pipeline failed for ${input.runId}`, err);
    await updateQuickSlideRun(input.runId, {
      status: "error",
      error_message: message,
      last_event_phase: "error",
      last_event_message: message,
    }).catch(() => {});
  }
}
