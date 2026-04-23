import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { WorkspaceContextPack } from "@/lib/workspace/build-context-pack";

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type SynthesizedBrief = {
  title: string;
  objective: string;
  narrative: string;
  audience: string;
  thesis: string;
  stakes: string;
  slideCount: number;
};

const fallbackSchema = z.object({
  title: z.string(),
  objective: z.string(),
  narrative: z.string(),
  audience: z.string(),
  thesis: z.string().default(""),
  stakes: z.string().default(""),
  slideCount: z.number().int().min(5).max(60).default(10),
});

const SYSTEM_PROMPT = `You are Basquio's brief synthesizer. A CPG analyst has been having a conversation and wants to turn it into a deck. Your job: read the whole conversation and the workspace context, and produce a crisp brief.

Output JSON only, no commentary:

{
  "title": "string, 60 chars max, no period at end",
  "objective": "string, one sentence, what the deck must deliver",
  "narrative": "string, 3-5 sentences, the story the deck should tell — concrete facts, numbers, and tensions surfaced in the conversation",
  "audience": "string, one short phrase (e.g., 'Head of Category', 'Executive stakeholder')",
  "thesis": "string, optional one-sentence point of view if the conversation landed on one",
  "stakes": "string, optional one-sentence why-this-matters if the conversation surfaced it",
  "slideCount": integer between 5 and 30
}

Rules:
- Lean on the conversation, not the workspace rules. The rules shape style, not content.
- Use the numbers the conversation cited. Don't invent.
- If the conversation ended with the assistant asking a clarifying question, use the user's latest intent, not the question.
- No em dashes. No emojis. No "leverage", "unlock", "seamless".
- Italian or English — match the conversation's dominant language.`;

function buildUserPrompt(input: {
  pack: WorkspaceContextPack;
  turns: ConversationTurn[];
}): string {
  const pack = input.pack;
  const contextLines: string[] = [];
  if (pack.scope.name) contextLines.push(`Scope: ${pack.scope.kind ?? "scope"}:${pack.scope.name}`);
  if (pack.stakeholders.length > 0) {
    // Full stakeholder preferences block per spec §6.10. The
    // pre-flattened styleContract is still handy for fallbacks, but
    // the structured preferences carry per-stakeholder nuance
    // (chart, tone, review cadence) that the flattening drops.
    contextLines.push("Stakeholder preferences:");
    for (const s of pack.stakeholders) {
      const prefs = (s as typeof s & {
        preferences?: {
          free_text?: string | null;
          structured?: {
            chart_preference?: string | null;
            deck_length?: string | null;
            language?: string | null;
            tone?: string | null;
            review_day?: string | null;
          } | null;
        } | null;
      }).preferences;
      const structured = prefs?.structured ?? null;
      const bits = [
        structured?.chart_preference ? `chart: ${structured.chart_preference}` : null,
        structured?.deck_length ? `deck length: ${structured.deck_length}` : null,
        structured?.language ? `language: ${structured.language}` : null,
        structured?.tone ? `tone: ${structured.tone}` : null,
        structured?.review_day ? `review day: ${structured.review_day}` : null,
      ].filter(Boolean);
      const line = `- ${s.name}${s.role ? ` (${s.role})` : ""}`;
      const details = bits.length > 0 ? ` | ${bits.join("; ")}` : "";
      const free = prefs?.free_text ? ` | free text: ${prefs.free_text.slice(0, 240)}` : "";
      contextLines.push(`${line}${details}${free}`);
    }
  }
  if (pack.styleContract.deckLength) {
    contextLines.push(`House deck length: ${pack.styleContract.deckLength}`);
  }
  if (pack.styleContract.language) {
    contextLines.push(`House language: ${pack.styleContract.language}`);
  }
  if (pack.styleContract.chartPreferences.length > 0) {
    contextLines.push(`Chart preferences: ${pack.styleContract.chartPreferences.join("; ")}`);
  }
  // renderedBriefPrelude is built by the pack but never consumed today.
  // Inject it as an additional context section when present so the
  // synthesizer can see it. Spec §6.10.
  if (pack.renderedBriefPrelude && pack.renderedBriefPrelude.trim().length > 0) {
    contextLines.push("");
    contextLines.push("Brief prelude:");
    contextLines.push(pack.renderedBriefPrelude.trim().slice(0, 2000));
  }

  // Trim the conversation to the last ~6 turns to keep tokens low. Keep the
  // first user prompt always — it's often the strongest intent signal.
  const trimmed: ConversationTurn[] = [];
  if (input.turns.length > 0 && input.turns[0].role === "user") {
    trimmed.push(input.turns[0]);
  }
  const tail = input.turns.slice(-6);
  for (const t of tail) {
    if (trimmed.length > 0 && trimmed[trimmed.length - 1] === t) continue;
    trimmed.push(t);
  }

  const conversation = trimmed
    .map((t) => `[${t.role}] ${t.text.slice(0, 1200)}`)
    .join("\n\n");

  return [
    "## Workspace context",
    contextLines.length > 0 ? contextLines.join("\n") : "(no structured context)",
    "",
    "## Conversation",
    conversation || "(empty conversation)",
    "",
    "Produce the JSON brief now. Output JSON only.",
  ].join("\n");
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Fallback when the synthesizer is unavailable or errors. Builds a
 * minimal brief from the pack + first user prompt so the drawer still
 * has something sensible to show.
 */
export function buildFallbackBrief(input: {
  pack: WorkspaceContextPack;
  turns: ConversationTurn[];
}): SynthesizedBrief {
  const firstUser = input.turns.find((t) => t.role === "user");
  const scopeName = input.pack.scope.name;
  const deckLength = input.pack.styleContract.deckLength;
  const slideFromLength = deckLength ? Number(deckLength.match(/\d+/)?.[0] ?? 10) : 10;
  return {
    title: scopeName ? `Deck: ${scopeName}` : "Workspace deck",
    objective: firstUser?.text.slice(0, 240) ?? "Workspace-led analysis",
    narrative: firstUser?.text.slice(0, 1200) ?? "",
    audience: input.pack.stakeholders[0]?.role ?? "Executive stakeholder",
    thesis: "",
    stakes: "",
    slideCount: Math.max(5, Math.min(30, slideFromLength || 10)),
  };
}

export async function synthesizeBrief(input: {
  pack: WorkspaceContextPack;
  turns: ConversationTurn[];
}): Promise<SynthesizedBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return buildFallbackBrief(input);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(input),
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return buildFallbackBrief(input);
    }

    const parsed = tryParseJson(textBlock.text);
    if (!parsed) return buildFallbackBrief(input);

    const validated = fallbackSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("[synthesize-brief] schema validation failed", validated.error.issues);
      return buildFallbackBrief(input);
    }

    return {
      title: validated.data.title.slice(0, 120),
      objective: validated.data.objective.slice(0, 400),
      narrative: validated.data.narrative.slice(0, 4000),
      audience: validated.data.audience.slice(0, 80),
      thesis: validated.data.thesis.slice(0, 320),
      stakes: validated.data.stakes.slice(0, 320),
      slideCount: validated.data.slideCount,
    };
  } catch (err) {
    console.error("[synthesize-brief] failed", err);
    return buildFallbackBrief(input);
  }
}
