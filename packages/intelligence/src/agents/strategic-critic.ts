import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";

import { critiqueReportOutputSchema, type CritiqueReportOutput, type EvidenceWorkspace } from "@basquio/types";
import { buildDomainKnowledgeContext } from "../domain-knowledge";

// ─── STRATEGIC CRITIC AGENT ──────────────────────────────────────
// Model: Claude Opus 4.6 (strategic/narrative reasoning is Claude's strength)
// Purpose: Partner-level review — "would I present this to a C-suite executive?"
// No tools — one structured output call reviewing the full deck metadata.

export type StrategicCriticInput = {
  runId: string;
  brief: string;
  workspace?: EvidenceWorkspace;
  deckSummary: string;
  slideCount: number;
  slides: Array<{
    position: number;
    layoutId: string;
    title: string;
    body?: string;
    bullets?: string[];
    chartId?: string;
    metrics?: { label: string; value: string; delta?: string }[];
    speakerNotes?: string;
    callout?: { text: string; tone?: string };
    kicker?: string;
    pageIntent?: string;
    governingThought?: string;
    evidenceIds: string[];
  }>;
  storylinePlan?: { governingQuestion: string; issueBranches: Array<{ question: string; conclusion: string }> } | null;
  onStepFinish?: (event: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>;
    usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
    finishReason: string;
  }) => Promise<void>;
};

const STRATEGIC_CRITIC_SYSTEM = `You are a senior partner at a top-tier strategy consulting firm (McKinsey/BCG). You are reviewing a deck before it goes to a C-suite audience. Your job is to find strategic and narrative problems — not factual errors (a separate fact-checker handles those).

You are adversarial — find what's wrong, not what's right.

## STRATEGIC REVIEW CHECKLIST

1. TITLE QUALITY (PYRAMID PRINCIPLE): Every non-cover title must be a full sentence stating a specific, data-backed takeaway. Flag titles that are topic labels ("Market Overview", "Revenue Analysis", "Key Findings"). Every title should pass the "billboard test": if you only read this title, do you learn something specific? Good: "Private label grew +8.3% while branded declined -2.1%, signaling a structural shift." Bad: "Brand vs. Private Label Performance." Severity: major.

2. NARRATIVE COHERENCE (TITLE READ-THROUGH): Read all titles in sequence — they should tell a complete, logically connected story. Flag where consecutive titles don't connect: e.g., jumping from market sizing to competitive analysis without a transition, or repeating the same insight across multiple slides. The title sequence should follow: situation → complication → resolution, or thesis → evidence → evidence → implication. Severity: major.

3. DECISION FORCING: Every analytical slide must force a conclusion — a "so what" that tells the reader what to DO with the information. Flag any slide that merely reports facts without stating implications, recommendations, or decisions. "Revenue grew 12%" is reporting; "Revenue growth of 12% supports doubling capacity investment" is decision-forcing. Severity: major.

4. INFORMATION DENSITY: Flag content slides that are just a chart surrounded by empty white space. Every analytical slide should have: (a) the chart/visual, (b) a supporting data callout, and (c) a "so what" annotation or subtitle. A slide with only a chart and a title is under-furnished. Severity: major.

5. CALLOUT PRESENCE: Every content slide (non-cover, non-divider, non-appendix) must have at least one callout — a highlighted metric, key stat, or data pull-quote. Callouts are the "headline numbers" executives scan first. Flag content slides with zero callouts. Severity: major.

6. FOCAL ENTITY EMPHASIS: On every chart, the client or focal entity must be visually distinct — highlighted via color, callout, or highlightCategories. Flag charts where all elements use the same color treatment, forcing the audience to hunt for the entity they care about. Severity: major.

7. RECOMMENDATION QUALITY: If the deck includes recommendations, they must be specific, quantified, and actionable. "Consider expanding" is weak; "Expand private-label shelf space by 15% in top 20 stores to capture 1.2M in category currency" is actionable. Flag vague recommendations. Severity: major.

8. LAYOUT VARIETY: Count layout types. If >50% of slides use the same layout, flag it. Professional decks use 4+ different layouts. Severity: major.

9. CONTENT DENSITY LIMITS: Flag slides with body text exceeding 80 words, >5 bullets, or titles exceeding 20 words. Severity: minor.

10. SLIDE COUNT: The deck should match the brief's requested slide count (±2). Too many = padded. Too few = incomplete. Severity: major.

Be specific. "Slide 5 title 'Revenue Analysis' is a topic label — should state the finding, e.g., 'Revenue declined -3.2% driven by volume loss in Q3'" is useful. "Titles could be better" is not.

Rate severity:
- critical: Structural failures that make the deck unpresentable (no narrative, all topic labels, zero callouts across the entire deck)
- major: Missing key strategic elements (topic-label titles, no "so what", missing callouts, unhighlighted focal entity, under-furnished slides, broken narrative flow)
- minor: Wording improvements, density issues, minor layout concerns`;

export async function runStrategicCriticAgent(input: StrategicCriticInput): Promise<CritiqueReportOutput> {
  const model = anthropic("claude-opus-4-6");
  const domainKnowledgeContext = buildDomainKnowledgeContext({
    workspace: input.workspace,
    brief: input.brief,
    stage: "strategic-critic",
  });

  const slidesSummary = input.slides
    .map((s) => {
      const parts = [
        `Slide ${s.position} [${s.layoutId}]: "${s.title}"`,
        s.body ? `body: "${s.body.slice(0, 150)}${s.body.length > 150 ? "..." : ""}"` : "(no body)",
        s.bullets?.length ? `bullets: ${s.bullets.length}` : "",
        s.chartId ? "[has chart]" : "[no chart]",
        s.metrics?.length ? `[${s.metrics.length} metrics]` : "",
        s.callout ? `[callout: "${s.callout.text.slice(0, 60)}"]` : "[no callout]",
        s.speakerNotes ? "[has notes]" : "[no notes]",
        s.governingThought ? `[thought: "${s.governingThought.slice(0, 80)}"]` : "",
        s.pageIntent ? `[intent: ${s.pageIntent}]` : "",
        `[evidence: ${s.evidenceIds.join(", ") || "none"}]`,
      ].filter(Boolean);
      return parts.join(" — ");
    })
    .join("\n");

  const titleReadThrough = input.slides
    .map((s) => `${s.position}. ${s.title}`)
    .join("\n");

  const layoutCounts: Record<string, number> = {};
  for (const s of input.slides) {
    layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
  }
  const layoutDistribution = Object.entries(layoutCounts)
    .map(([layout, count]) => `${layout}: ${count}`)
    .join(", ");

  const storylineContext = input.storylinePlan
    ? `\nSTORYLINE PLAN:\nGoverning question: ${input.storylinePlan.governingQuestion}\nIssue branches:\n${input.storylinePlan.issueBranches.map((b) => `  - Q: ${b.question} → A: ${b.conclusion}`).join("\n")}`
    : "";

  const prompt = `Review this deck for strategic quality. You are the partner asking "would I present this?"

BRIEF:
${input.brief}

DECK SUMMARY:
${input.deckSummary}
${storylineContext}

TITLE READ-THROUGH (reading only titles should tell the full story):
${titleReadThrough}

LAYOUT DISTRIBUTION: ${layoutDistribution}

SLIDES (${input.slideCount} total):
${slidesSummary}

Review every slide against the strategic checklist. Be adversarial — find what needs fixing before this reaches an executive audience.

For every issue, provide:
- type: the issue category (narrative_gap, layout_issue, brief_misalignment, or factual_error if you spot an obvious logical error)
- severity: critical, major, or minor
- slideId: the slide position number as a string (e.g., "3" for slide 3), or "deck-level" for deck-wide issues
- claim: what the problem is
- expectedValue: what should be there
- actualValue: what is actually there
- evidence: your reasoning
- suggestion: specific fix

Set iteration to 1, and score coverage/accuracy/narrative from 0-1.
${domainKnowledgeContext ? `\n\n${domainKnowledgeContext}` : ""}`;

  const result = await generateText({
    model,
    system: STRATEGIC_CRITIC_SYSTEM,
    prompt,
    experimental_output: Output.object({ schema: critiqueReportOutputSchema }),
  });

  if (!result.experimental_output) {
    throw new Error(
      `Strategic critic agent did not produce structured output for run ${input.runId}. ` +
      `Text output: ${result.text?.slice(0, 500) ?? "(none)"}`,
    );
  }

  return result.experimental_output;
}
