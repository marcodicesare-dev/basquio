/**
 * Chat-turn fact extractor (Memory v1 Brief 4).
 *
 * Spec: docs/research/2026-04-25-sota-implementation-specs.md §7
 * Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 4)
 *
 * Mem0 V3-style ADD-only extraction. Reads the latest analyst turn,
 * runs Haiku 4.5 with structuredOutputMode 'jsonTool' (per Brief 2
 * finding), parses a typed array of candidates, and gates by
 * confidence:
 *   < 0.6: drop, increment dropped_count in workflow_run metadata
 *   0.6..0.8: insert_memory_candidate RPC (status='pending')
 *   > 0.8 AND CHAT_EXTRACTOR_ENABLED='true': auto_promote_high_confidence RPC
 *   > 0.8 AND flag false: insert_memory_candidate RPC (DRY MODE)
 *
 * All writes go through SECURITY DEFINER RPCs from migration
 * 20260505110000_memory_candidates_rpcs.sql. Per Brief 1 pivot, never
 * use withActor for the persist phase.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  beginWorkflowRun,
  ensureMemoryWorkflow,
  finishWorkflowRun,
} from "./memory-workflow-runs";

export const CHAT_EXTRACTOR_MODEL_ID = "claude-haiku-4-5";
export const CHAT_FACT_EXTRACTION_PROMPT_VERSION = "v1.0";
export const CHAT_FACT_EXTRACTION_SKILL_REF = "basquio-chat-fact-extraction";
export const CHAT_FACT_EXTRACTION_SKILL_VERSION = "1.0.0";

// Confidence gates per spec §7.
export const DROP_FLOOR = 0.6;
export const AUTO_PROMOTE_FLOOR = 0.8;

// Haiku 4.5 pricing (Apr 2026).
const HAIKU_PRICE = { input: 1, output: 5, cachedRead: 0.1 };

const CandidateKind = z.enum(["fact", "rule", "preference", "alias", "entity"]);

const ExtractedCandidateSchema = z.object({
  kind: CandidateKind,
  content: z.unknown(),
  evidence_excerpt: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(400),
});

const ExtractionOutputSchema = z.object({
  candidates: z.array(ExtractedCandidateSchema),
});

export type ExtractedCandidate = z.infer<typeof ExtractedCandidateSchema>;
export type CandidateKindValue = z.infer<typeof CandidateKind>;

// Inlined for portability across Next.js bundle (apps/web) + Node worker.
// The canonical source-of-truth doc lives at
// packages/workflows/src/workspace/prompts/chat-fact-extraction.md;
// keep them in sync and bump CHAT_FACT_EXTRACTION_PROMPT_VERSION when
// the prompt changes.
const SYSTEM_PROMPT = `You read the latest analyst turn and decide whether the analyst explicitly stated something worth remembering. Most turns extract nothing. That is correct behaviour. Only extract when the analyst clearly asserts a fact, rule, preference, alias, or entity.

This is an ADD-only extraction loop. You never overwrite or delete existing memory; you only propose new candidates. Contradictions resolve at retrieval time via recency, confidence, and provenance. Your only job is to spot signals that already exist in the analyst's words.

Default to extracting nothing. The cost of a false positive (a wrong fact in durable memory) is much higher than the cost of a false negative (a real fact missed; the next turn will surface it again).

Five extraction kinds. Pick exactly one per signal:
- fact: a relationship between two entities or between an entity and a value at a point in time. Content shape: { subject_entity_name: string, subject_entity_type: string, predicate: string, object_value?: any, object_entity_name?: string, object_entity_type?: string, valid_from?: ISO-8601, valid_to?: ISO-8601 }. Predicate is a short verb phrase like "launched", "acquired", "shipped_unit_count".
- rule: a workspace-level instruction the analyst gave for how Basquio should behave going forward. Content shape: { rule_type: 'always'|'never'|'precedence'|'format'|'tone'|'source'|'approval'|'style', rule_text: string, applies_to?: string[], forbidden?: string[], priority?: number }.
- preference: a personal habit, working style, or formatting taste the analyst stated about themselves or the team. Content shape: { text: string, scope_hint?: string }.
- alias: a new shorthand or alternative name the analyst gave for an existing entity. Content shape: { canonical_name: string, alias: string }. Only extract when the canonical name is recognisable from prior workspace context or is itself stated in the same turn.
- entity: a brand, person, retailer, category, or other named thing the analyst introduced for the first time. Content shape: { canonical_name: string, type: 'person'|'organization'|'brand'|'category'|'sub_category'|'sku'|'retailer', aliases?: string[] }.

Hard rules:
1. The signal must come from the LATEST analyst turn. Recent turns are context only. Questions, requests for decks, or pure conversational filler return an empty array.
2. Quote the exact phrase that triggered the extraction in evidence_excerpt. Verbatim. No paraphrasing.
3. Confidence ranges 0..1. Below 0.6 is dropped silently. 0.6..0.8 lands in the human-review queue. Above 0.8 may auto-promote when the operator opts in. Score honestly.
4. Never extract a fact you are inferring. If the analyst said "Q4 was strong" do NOT extract a fact like "Q4 revenue grew". You did not see the revenue number.
5. Never extract a rule from a one-off ask. "Use a bigger headline on this slide" is not a rule. "Always use 32pt for headlines on Lavazza decks" is.
6. Never extract a preference the analyst stated for the document or deck rather than for themselves. "This deck should be five slides" is a one-off, not a preference.
7. Aliases require the canonical name be either explicit in the same turn or a known entity from the workspace context. If you cannot name the canonical, drop it.
8. Entities must be named, not described. "An Italian biscuit brand" alone is not an entity; "Pavesi, an Italian biscuit brand" is.
9. Reasoning is one short sentence per item. Useful for debugging.
10. If the latest turn is by the assistant rather than the user, return an empty array.
11. Do not duplicate. If the same fact appears twice, emit it once with the better evidence excerpt.
12. Do not extract company-confidential content (salaries, internal headcount changes). When in doubt, drop.

Return a JSON object: { candidates: [...] }. Empty array when nothing is worth extracting (most turns).`;

export type ExtractCandidatesInput = {
  conversationId: string | null;
  turnText: string;
  recentTurns: string;
  workspaceContext?: string;
  workspaceId: string;
  organizationId: string;
  scopeId: string | null;
  userId: string;
  sourceMessageId?: string | null;
};

export type ExtractCandidatesResult = {
  workflowRunId: string;
  candidatesCreated: number;
  autoPromoted: number;
  dropped: number;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  candidates: ExtractedCandidate[];
};

function isChatExtractorEnabled(): boolean {
  return process.env.CHAT_EXTRACTOR_ENABLED === "true";
}

function buildUserPrompt(input: { workspaceContext?: string; recentTurns?: string; turnText: string }): string {
  const parts: string[] = [];
  if (input.workspaceContext) {
    parts.push(`Workspace context (do not extract from this; reference only):\n${input.workspaceContext.slice(0, 1500)}`);
  }
  if (input.recentTurns) {
    parts.push(`Recent turns (context only):\n${input.recentTurns.slice(0, 2500)}`);
  }
  parts.push(`LATEST analyst turn (extract from this):\n${input.turnText.slice(0, 6000)}`);
  return parts.join("\n\n");
}

/**
 * Pure LLM call. Used by extractCandidatesFromTurn (which adds DB
 * persistence + telemetry) AND by the eval script (which only needs
 * the extraction quality without DB writes). Returns the raw
 * candidates and the usage metrics.
 */
export async function extractCandidatesLLM(input: {
  turnText: string;
  recentTurns?: string;
  workspaceContext?: string;
}): Promise<{
  candidates: ExtractedCandidate[];
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}> {
  const result = await generateObject({
    model: anthropic(CHAT_EXTRACTOR_MODEL_ID),
    schema: ExtractionOutputSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input),
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" },
    },
  });
  const usage = (result.usage ?? {}) as {
    promptTokens?: number;
    completionTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  const priced = priceTokens(usage);
  return {
    candidates: result.object.candidates ?? [],
    tokensInput: priced.tokensInput,
    tokensOutput: priced.tokensOutput,
    costUsd: priced.costUsd,
  };
}

function priceTokens(usage: {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}): { tokensInput: number; tokensOutput: number; costUsd: number } {
  const tokensInput = usage.inputTokens ?? usage.promptTokens ?? 0;
  const tokensOutput = usage.outputTokens ?? usage.completionTokens ?? 0;
  const costUsd = (tokensInput * HAIKU_PRICE.input + tokensOutput * HAIKU_PRICE.output) / 1_000_000;
  return { tokensInput, tokensOutput, costUsd };
}

export async function extractCandidatesFromTurn(
  supabase: SupabaseClient,
  input: ExtractCandidatesInput,
): Promise<ExtractCandidatesResult> {
  // Guard: empty turn text means there is nothing to extract.
  if (!input.turnText || input.turnText.trim().length < 10) {
    return {
      workflowRunId: "",
      candidatesCreated: 0,
      autoPromoted: 0,
      dropped: 0,
      costUsd: 0,
      tokensInput: 0,
      tokensOutput: 0,
      candidates: [],
    };
  }

  const workflowId = await ensureMemoryWorkflow(supabase, {
    organizationId: input.organizationId,
    name: "chat-fact-extraction",
    version: 1,
    triggerKind: "on_session_end",
    skillRef: CHAT_FACT_EXTRACTION_SKILL_REF,
    metadata: { phase: "memory-v1-brief-4" },
  });

  const workflowRunId = await beginWorkflowRun(supabase, {
    workflowId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    scopeId: input.scopeId,
    triggerPayload: {
      conversation_id: input.conversationId,
      source_message_id: input.sourceMessageId ?? null,
      flag_state: isChatExtractorEnabled() ? "live" : "dry",
    },
    promptVersion: CHAT_FACT_EXTRACTION_PROMPT_VERSION,
    skillVersion: CHAT_FACT_EXTRACTION_SKILL_VERSION,
  });

  let extracted: ExtractedCandidate[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let costUsd = 0;
  let dropped = 0;
  let candidatesCreated = 0;
  let autoPromoted = 0;

  try {
    const result = await generateObject({
      model: anthropic(CHAT_EXTRACTOR_MODEL_ID),
      schema: ExtractionOutputSchema,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      providerOptions: {
        anthropic: { structuredOutputMode: "jsonTool" },
      },
    });

    extracted = result.object.candidates ?? [];
    const usage = (result.usage ?? {}) as {
      promptTokens?: number;
      completionTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    const priced = priceTokens(usage);
    tokensInput = priced.tokensInput;
    tokensOutput = priced.tokensOutput;
    costUsd = priced.costUsd;

    const flagOn = isChatExtractorEnabled();

    for (const c of extracted) {
      if (c.confidence < DROP_FLOOR) {
        dropped += 1;
        continue;
      }

      // Auto-promote only when flag is true AND confidence > 0.8.
      // In dry mode, high-confidence extractions also land as pending.
      if (flagOn && c.confidence > AUTO_PROMOTE_FLOOR) {
        const { error: rpcErr } = await supabase.rpc("auto_promote_high_confidence", {
          p_workspace_id: input.workspaceId,
          p_scope_id: input.scopeId,
          p_kind: c.kind,
          p_content: c.content as object,
          p_evidence_excerpt: c.evidence_excerpt,
          p_source_conversation_id: input.conversationId,
          p_source_message_id: input.sourceMessageId ?? null,
          p_confidence: c.confidence,
          p_workflow_run_id: workflowRunId,
          p_actor: "system:workflow:chat-extraction",
        });
        if (rpcErr) {
          console.error("[chat-extraction] auto_promote_high_confidence RPC failed", rpcErr);
          // Fall through to insert as pending so we still capture the
          // signal for human review.
          const { error: fallbackErr } = await supabase.rpc("insert_memory_candidate", {
            p_workspace_id: input.workspaceId,
            p_scope_id: input.scopeId,
            p_kind: c.kind,
            p_content: c.content as object,
            p_evidence_excerpt: c.evidence_excerpt,
            p_source_conversation_id: input.conversationId,
            p_source_message_id: input.sourceMessageId ?? null,
            p_confidence: c.confidence,
            p_workflow_run_id: workflowRunId,
            p_actor: "system:workflow:chat-extraction",
          });
          if (fallbackErr) {
            console.error("[chat-extraction] insert_memory_candidate fallback failed", fallbackErr);
          } else {
            candidatesCreated += 1;
          }
        } else {
          autoPromoted += 1;
        }
      } else {
        const { error: rpcErr } = await supabase.rpc("insert_memory_candidate", {
          p_workspace_id: input.workspaceId,
          p_scope_id: input.scopeId,
          p_kind: c.kind,
          p_content: c.content as object,
          p_evidence_excerpt: c.evidence_excerpt,
          p_source_conversation_id: input.conversationId,
          p_source_message_id: input.sourceMessageId ?? null,
          p_confidence: c.confidence,
          p_workflow_run_id: workflowRunId,
          p_actor: "system:workflow:chat-extraction",
        });
        if (rpcErr) {
          console.error("[chat-extraction] insert_memory_candidate RPC failed", rpcErr);
        } else {
          candidatesCreated += 1;
        }
      }
    }

    await finishWorkflowRun(supabase, workflowRunId, {
      status: "success",
      candidatesCreated,
      costUsd,
      tokensInput,
      tokensOutput,
      metadata: {
        extracted_total: extracted.length,
        dropped_count: dropped,
        auto_promoted: autoPromoted,
        flag_state: flagOn ? "live" : "dry",
        kinds_seen: extracted.map((c) => c.kind),
      },
    });

    return {
      workflowRunId,
      candidatesCreated,
      autoPromoted,
      dropped,
      costUsd,
      tokensInput,
      tokensOutput,
      candidates: extracted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishWorkflowRun(supabase, workflowRunId, {
      status: "failure",
      candidatesCreated,
      costUsd,
      tokensInput,
      tokensOutput,
      errorMessage: message,
      metadata: {
        flag_state: isChatExtractorEnabled() ? "live" : "dry",
      },
    });
    throw err;
  }
}
