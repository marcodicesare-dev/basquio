import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";
import {
  assembleWorkspaceContext,
  renderContextForPrompt,
  type WorkspaceContext,
} from "@/lib/workspace/context";
import { handleMemoryCommand, type MemoryCommand } from "@/lib/workspace/memory-tool";

const MODEL = "claude-opus-4-7";
const MAX_AGENT_STEPS = 6;
const MAX_TOTAL_TOKENS = 80_000;

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    client = new Anthropic({
      apiKey,
      timeout: 90_000,
      maxRetries: 2,
    });
  }
  return client;
}

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export type Citation = {
  label: string;
  source_type: string;
  source_id: string;
  filename: string | null;
  excerpt: string;
};

export type GenerationResult = {
  deliverableId: string;
  bodyMarkdown: string;
  citations: Citation[];
  scope: string;
  status: "ready" | "failed";
  error?: string;
};

const SYSTEM_PROMPT = `You are Basquio, a senior FMCG and CPG insights analyst working alongside the user.

You answer questions and write deliverables (memos, briefs, narratives, charts) using only what is in the workspace context provided to you. You do not invent numbers. If a claim is not supported by the source excerpts, entities, or facts in the workspace, say so directly.

How to write:
- Plain language. No AI slop. Banned: dive deep, leverage, unlock, empower, elevate, seamless, game-changer, revolutionize, cutting-edge, next-generation.
- No em dashes. Use periods, commas, parentheses, colons.
- Sentence case. Active voice.
- Cite every grounded claim inline with the source label provided in context, like [s1] or [s3]. Multiple sources allowed: [s1][s4].
- If you write a number, attach a citation. If you cannot, mark it as "(not in workspace)".

Memory tool:
- A /memories filesystem is available. Top-level scopes are workspace, analyst, client:{name}, category:{name}.
- Before answering, view the relevant scope to recall prior preferences, prior briefs, prior conventions for this analyst or client.
- If the user shares a durable preference (style, format, glossary, recurring stakeholder), record it under the right scope so future sessions remember.
- Keep memory entries short and actionable. Do not dump conversation transcripts.

Output:
- Markdown only.
- Open with the answer or the headline. Then the supporting structure.
- End with one bold next-step suggestion only if the user clearly needs one.`;

export async function generateAnswer({
  prompt,
  scope,
  userEmail,
  userId,
}: {
  prompt: string;
  scope?: string;
  userEmail: string;
  userId: string;
}): Promise<GenerationResult> {
  const cleanedPrompt = prompt.trim();
  if (!cleanedPrompt) {
    throw new Error("Prompt is empty.");
  }

  const db = getDb();
  const { data: deliverable, error: insertError } = await db
    .from("workspace_deliverables")
    .insert({
      organization_id: BASQUIO_TEAM_ORG_ID,
      is_team_beta: true,
      created_by: userId,
      kind: "answer",
      title: cleanedPrompt.slice(0, 120),
      prompt: cleanedPrompt,
      scope: scope ?? null,
      status: "generating",
      metadata: { user_email: userEmail },
    })
    .select("id")
    .single();

  if (insertError || !deliverable) {
    throw new Error(`Failed to create deliverable: ${insertError?.message ?? "no row"}`);
  }
  const deliverableId = deliverable.id as string;

  try {
    const ctx = await assembleWorkspaceContext({ prompt: cleanedPrompt, scope });
    const result = await runAgent(cleanedPrompt, ctx);

    await db
      .from("workspace_deliverables")
      .update({
        status: "ready",
        body_markdown: result.bodyMarkdown,
        citations: result.citations,
        metadata: {
          user_email: userEmail,
          chunk_count: ctx.chunks.length,
          fact_count: ctx.facts.length,
          entity_count: ctx.entities.length,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliverableId);

    return {
      deliverableId,
      bodyMarkdown: result.bodyMarkdown,
      citations: result.citations,
      scope: ctx.scope,
      status: "ready",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("workspace_deliverables")
      .update({
        status: "failed",
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliverableId);
    return {
      deliverableId,
      bodyMarkdown: "",
      citations: [],
      scope: scope ?? "workspace",
      status: "failed",
      error: message,
    };
  }
}

async function runAgent(prompt: string, ctx: WorkspaceContext): Promise<{ bodyMarkdown: string; citations: Citation[] }> {
  const anthropic = getClient();
  const renderedContext = renderContextForPrompt(ctx);
  const userTurnText = `## User question\n${prompt}\n\n## Workspace context (use this for citations, do not invent)\n${renderedContext}`;

  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: userTurnText }],
    },
  ];

  let finalText = "";
  let totalTokens = 0;

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      betas: ["context-management-2025-06-27"],
      tools: [{ type: "memory_20250818", name: "memory" }] as never,
      messages,
    });

    const usage = response.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    totalTokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);

    const toolUses: Array<{ id: string; input: unknown }> = [];
    let stepText = "";
    for (const block of response.content as BetaContentBlock[]) {
      if (block.type === "text") {
        stepText += block.text;
      } else if (block.type === "tool_use" && block.name === "memory") {
        toolUses.push({ id: block.id, input: block.input });
      }
    }

    if (stepText) {
      finalText = stepText;
    }

    if (toolUses.length === 0) {
      break;
    }

    if (totalTokens > MAX_TOTAL_TOKENS) {
      console.warn(`[generate] token budget hit (${totalTokens}); stopping early.`);
      break;
    }

    messages.push({
      role: "assistant",
      content: response.content as BetaContentBlock[],
    });

    const toolResults: BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      let outcome = "";
      try {
        outcome = await handleMemoryCommand(toolUse.input as MemoryCommand);
      } catch (error) {
        outcome = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: outcome,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") break;
  }

  const citations = buildCitationsFromText(finalText, ctx);
  return { bodyMarkdown: finalText.trim(), citations };
}

function buildCitationsFromText(text: string, ctx: WorkspaceContext): Citation[] {
  const matches = new Set<string>();
  const re = /\[s(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.add(match[1]);
  }
  const citations: Citation[] = [];
  for (const labelNum of matches) {
    const idx = Number(labelNum) - 1;
    const chunk = ctx.chunks[idx];
    if (!chunk) continue;
    citations.push({
      label: `s${labelNum}`,
      source_type: chunk.sourceType,
      source_id: chunk.sourceId,
      filename: chunk.filename,
      excerpt: chunk.content.slice(0, 480),
    });
  }
  citations.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)));
  return citations;
}

export type StreamEvent =
  | { type: "meta"; deliverableId: string; scope: string }
  | { type: "status"; message: string }
  | { type: "text-delta"; text: string }
  | { type: "done"; deliverableId: string; bodyMarkdown: string; citations: Citation[]; scope: string }
  | { type: "error"; deliverableId: string | null; message: string };

export async function* streamAnswer(input: {
  prompt: string;
  scope?: string;
  userEmail: string;
  userId: string;
}): AsyncGenerator<StreamEvent, void, void> {
  const cleanedPrompt = input.prompt.trim();
  if (!cleanedPrompt) {
    yield { type: "error", deliverableId: null, message: "Prompt is empty." };
    return;
  }

  const db = getDb();
  let deliverableId: string | null = null;

  try {
    const { data: deliverable, error: insertError } = await db
      .from("workspace_deliverables")
      .insert({
        organization_id: BASQUIO_TEAM_ORG_ID,
        is_team_beta: true,
        created_by: input.userId,
        kind: "answer",
        title: cleanedPrompt.slice(0, 120),
        prompt: cleanedPrompt,
        scope: input.scope ?? null,
        status: "generating",
        metadata: { user_email: input.userEmail },
      })
      .select("id")
      .single();

    if (insertError || !deliverable) {
      yield {
        type: "error",
        deliverableId: null,
        message: insertError?.message ?? "Failed to create deliverable.",
      };
      return;
    }
    deliverableId = deliverable.id as string;

    yield { type: "meta", deliverableId, scope: input.scope ?? "workspace" };
    yield { type: "status", message: "Reading workspace context." };

    const ctx = await assembleWorkspaceContext({ prompt: cleanedPrompt, scope: input.scope });

    yield { type: "status", message: "Thinking." };

    const renderedContext = renderContextForPrompt(ctx);
    const userTurnText = `## User question\n${cleanedPrompt}\n\n## Workspace context (use this for citations, do not invent)\n${renderedContext}`;

    const messages: BetaMessageParam[] = [
      { role: "user", content: [{ type: "text", text: userTurnText }] },
    ];

    let finalText = "";
    let totalTokens = 0;
    const anthropic = getClient();

    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const stream = anthropic.beta.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        betas: ["context-management-2025-06-27"],
        tools: [{ type: "memory_20250818", name: "memory" }] as never,
        messages,
      });

      let stepText = "";
      const textHandler = (delta: string) => {
        stepText += delta;
        return delta;
      };

      for await (const event of stream as AsyncIterable<{
        type: string;
        index?: number;
        delta?: { type: string; text?: string };
      }>) {
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          typeof event.delta.text === "string"
        ) {
          const delta = textHandler(event.delta.text);
          yield { type: "text-delta", text: delta };
        }
      }

      const final = await stream.finalMessage();
      const usage = final.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      totalTokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);

      const toolUses: Array<{ id: string; input: unknown }> = [];
      for (const block of final.content as BetaContentBlock[]) {
        if (block.type === "tool_use" && block.name === "memory") {
          toolUses.push({ id: block.id, input: block.input });
        }
      }

      if (stepText) finalText = stepText;

      if (toolUses.length === 0) break;

      if (totalTokens > MAX_TOTAL_TOKENS) {
        console.warn(`[stream] token budget hit (${totalTokens}); stopping early.`);
        break;
      }

      yield { type: "status", message: "Reading memory." };

      messages.push({ role: "assistant", content: final.content as BetaContentBlock[] });

      const toolResults: BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        let outcome = "";
        try {
          outcome = await handleMemoryCommand(toolUse.input as MemoryCommand);
        } catch (error) {
          outcome = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: outcome });
      }
      messages.push({ role: "user", content: toolResults });

      if (final.stop_reason === "end_turn") break;
    }

    const citations = buildCitationsFromText(finalText, ctx);

    await db
      .from("workspace_deliverables")
      .update({
        status: "ready",
        body_markdown: finalText.trim(),
        citations,
        metadata: {
          user_email: input.userEmail,
          chunk_count: ctx.chunks.length,
          fact_count: ctx.facts.length,
          entity_count: ctx.entities.length,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliverableId);

    yield {
      type: "done",
      deliverableId,
      bodyMarkdown: finalText.trim(),
      citations,
      scope: ctx.scope,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (deliverableId) {
      await db
        .from("workspace_deliverables")
        .update({
          status: "failed",
          error_message: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliverableId);
    }
    yield { type: "error", deliverableId, message };
  }
}
