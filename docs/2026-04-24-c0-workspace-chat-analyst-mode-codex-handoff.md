# C0 handoff: workspace chat analyst mode (third codex lane)

Session date: 2026-04-24
Owner on hand-off: fresh codex session via Conductor worktree
Branch: cut a fresh branch from `origin/main` (Conductor auto-renames to `marcodicesare-dev/c0-chat-analyst-mode` or similar prefix; accept the rename)
Expected effort: two working days, single PR
Do NOT rebase or merge `codex/chat-ux-p0` or `marcodicesare-dev/p0-data-primacy` into this branch

## 1. Mission

Turn Basquio's workspace chat from a RAG-over-workspace wrapper into a real FMCG analyst agent that Rossella, Giulia, Alessandro, Francesco, Veronica, and paying clients will actually use for daily work. Current quality 1/10 per co-founder dogfood. Target 10/10, matching the bar set by Claude Code, Claude.ai, Cursor, Notion AI, Legora.

Ship eight coordinated changes in one PR. Partial merges leave users with half a product.

Vertical FMCG knowledge stays in the system prompt. Model upgrade lands. Firecrawl-backed web search lands. Multi-file analyst-mode reasoning lands. Graceful tool error recovery lands. First-turn and next-turn suggestions land. Telemetry lands.

## 2. Forensic context (verified empirically)

### 2.1 Current chat architecture

- Route: `apps/web/src/app/api/workspace/chat/route.ts`, 123 lines, AI SDK v6 `streamText` with `stepCountIs(10)`
- Model: `claude-sonnet-4-5` locked in [apps/web/src/lib/workspace/agent.ts:39](../apps/web/src/lib/workspace/agent.ts). Downgraded from Opus 4.7 on commit `91ac71b` (Task 7f fix 2) "for compatibility" about one week ago. This is a stale ceiling
- Twelve tools available via `getAllTools`: `readMemory`, `retrieveContext`, `analyzeAttachedFile`, `listConversationFiles`, `saveFromPaste`, `scrapeUrl`, `editRule`, `teachRule`, `editStakeholder`, `createStakeholder`, `showStakeholderCard`, `draftBrief`, `suggestServices`, `explainBasquio`, plus CRUD editorials. Reviewed in [apps/web/src/lib/workspace/agent-tools.ts](../apps/web/src/lib/workspace/agent-tools.ts) and sibling files
- System prompt in [apps/web/src/lib/workspace/agent.ts:3-37](../apps/web/src/lib/workspace/agent.ts) is 90% tool-routing checklist and 10% analyst guidance

### 2.2 Rossella's feedback (2026-04-24, Discord)

> "gli ho chiesto quali sono i trend emergenti del caffè e mi ha detto che non ha dati a supporto, che poteva basarsi su quello trovato online. gli ho allora detto di darmi una panoramica sul mercato del caffè in italia basandosi su dati online e mi ha risposto che può consigliarmi dei siti. Mi aspettavo appunto qualche paragrafo con le fonti citate di quello che riusciva a trovare online."

Translation: she asked for coffee market trends. The chat said "no data to support, can suggest online sources." She expected paragraphs with cited sources, synthesized from the web. She got a recommendation list. The failure is: there is no web search tool, so the assistant cannot do the work, only talk about doing it.

### 2.3 Giulia's feedback (2026-04-24, Discord)

> "avevo messo il file ppt e mi diceva 'tool result is missing for tool call bla bla bla' e viene fuori un errore"

She uploaded a PPTX and the chat surfaced raw AI SDK v6 streaming protocol errors. When a tool_call is emitted but the tool_result never arrives, the user sees protocol debris.

> "commentami questa slide basandoti sia su quello che vedi scritto nelle altre slide che avevo già commentato sia su tutta la parte teorica del pdf"

She wanted the chat to comment on a specific slide, drawing on prior commented slides AND a theoretical PDF she uploaded. The chat could not do multi-file synthesis.

> "Io vorrei che mi commentasse le slides con insights come se fosse un analyst, così ho già una base di partenza senza essermi fatta dello sbatti"

She wants analyst-grade slide commentary as a starting point. The current chat has no tool for that behavior.

### 2.4 Gap summary (forensic, not pattern-matched)

| Gap | Current | Expected |
|---|---|---|
| Model | Sonnet 4.5 (1 week behind) | Sonnet 4.6 default, Opus 4.7 for deep mode |
| Web research | None; `scrapeUrl` requires a URL, not a query | `webSearch` tool powered by Firecrawl `/v2/search` |
| Multi-file synthesis | `analyzeAttachedFile` handles pandas on structured data only | `analystCommentary` tool that reads N PDFs/PPTX/MD attachments and produces structured analyst commentary |
| Tool error handling | Raw protocol strings surface to UI | Server-side try/catch wraps every tool, user-facing error message |
| System prompt | Tool routing checklist | Analyst playbook with explicit when-web-search, when-commentary, when-draft guidance |
| First-turn experience | Empty chat, user guesses what to ask | Auto-streamed greeting + 3 concrete-action pills derived from workspace state |
| Next-turn suggestions | None | 2-3 follow-up pills after every assistant turn |
| Chat telemetry | None | `chat_tool_telemetry` table logs every tool call latency, error, success |

## 3. Non-negotiables

- Do NOT touch files under `apps/web/src/components/workspace-chat/**` or `apps/web/src/components/scope-landing.tsx` or `apps/web/src/app/(workspace)/workspace/**` or `apps/web/src/app/global.css`. The codex/chat-ux-p0 session owns these
- Do NOT touch `packages/workflows/**`, `packages/intelligence/**`, `packages/research/**`, or `supabase/migrations/**` outside what is explicitly scoped below. The codex/p0-data-primacy session owns the workflow+intelligence lanes. Shared Firecrawl client in `packages/research/src/clients.ts` is read-only for this session
- Do NOT touch `memory/**`, `rules/**`, `docs/domain-knowledge/**`. Those are Marco's knowledge pack territory
- No em-dashes anywhere. Lefthook has an em-dash hook that blocks commits. Use commas
- No emojis anywhere
- Working rules at [docs/working-rules.md](working-rules.md) apply

## 4. C1: Model upgrade (Sonnet 4.6 default, Opus 4.7 deep mode toggle)

### 4.1 Agent config change
[apps/web/src/lib/workspace/agent.ts](../apps/web/src/lib/workspace/agent.ts), replace the single `BASQUIO_MODEL_ID` constant with a selector:

```ts
export type ChatModelMode = "standard" | "deep";

export const CHAT_MODEL_IDS: Record<ChatModelMode, string> = {
  standard: "claude-sonnet-4-6",
  deep: "claude-opus-4-7",
};

export function resolveChatModel(mode: ChatModelMode | null | undefined): string {
  return CHAT_MODEL_IDS[mode ?? "standard"];
}
```

Delete the `BASQUIO_MODEL_ID` export. Update every importer (there should be exactly one, the chat route) to call `resolveChatModel(body.mode)`.

### 4.2 Route change
[apps/web/src/app/api/workspace/chat/route.ts](../apps/web/src/app/api/workspace/chat/route.ts): accept `mode: "standard" | "deep"` on the request body, default to `"standard"`. Pass to `streamText` via `model: anthropic(resolveChatModel(body.mode))`.

Also persist `mode` to `conversations.metadata.chat_mode_last` so the composer can remember the last toggle state for this user/conversation.

### 4.3 Diagnose and fix the original Sonnet 4.5 compatibility bug
Commit `91ac71b` switched away from Opus 4.7 for an unnamed reason. Before shipping, run this test locally:

```bash
pnpm --filter @basquio/web dev
# In another terminal:
curl -X POST http://localhost:3000/api/workspace/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: <paste your auth cookie>" \
  -d '{"id":"test-deep","messages":[{"role":"user","parts":[{"type":"text","text":"hello"}]}],"mode":"deep"}'
```

If the response throws or streams garbage, diagnose and fix the original bug BEFORE merging. Likely causes:
- AI SDK v6 `@ai-sdk/anthropic` version mismatch. Check `apps/web/package.json` for the installed version, bump to latest if below 2.0
- `stepCountIs(10)` incompatibility with Opus 4.7's extended thinking. Try `stopWhen: [stepCountIs(12), hasToolCall('finalAnswer')]` or remove the step cap for deep mode
- Tool schema rejection. Opus 4.7 is stricter on JSON schema than Sonnet 4.5. Run `pnpm typecheck` and fix any zod schemas that rely on loose inference

Document the fix in the PR description. Do NOT leave a "known issue" note. Opus 4.7 must work.

### 4.4 Acceptance
- `resolveChatModel("standard")` returns `"claude-sonnet-4-6"`, `resolveChatModel("deep")` returns `"claude-opus-4-7"`, `resolveChatModel(undefined)` returns `"claude-sonnet-4-6"`
- POST to `/api/workspace/chat` with `{mode: "deep"}` streams a valid Opus 4.7 response, no errors
- `conversations.metadata.chat_mode_last` is stored after each response
- Unit test in new file `apps/web/src/lib/workspace/agent.test.ts` covering the resolver

## 5. C2: webSearch tool via Firecrawl

### 5.1 Why Firecrawl not Anthropic native
Rossella needs full scraped content, not snippets. Firecrawl `/v2/search` with `scrapeOptions` returns the article body plus metadata (published date, language, location, topics). Anthropic's native `web_search_20250305` returns URLs and snippets only. Verified empirically against a real "Italian coffee market trends" query: Firecrawl returned the NIQ Italy On Premise Consumer Pulse Report full body (28KB of markdown with actual trend data). Anthropic would have returned a link.

Basquio already has a Firecrawl client at [packages/research/src/clients.ts](../packages/research/src/clients.ts) with auth, retry, and budget tracking. The new tool wraps it. Do NOT duplicate the client.

### 5.2 Tool definition
New file: `apps/web/src/lib/workspace/agent-tools-web-search.ts`

```ts
import { tool } from "ai";
import { z } from "zod";
import { firecrawlSearch } from "@basquio/research/clients";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";

const WEB_SEARCH_SOFT_WARN = 10;
const WEB_SEARCH_HARD_CAP = 200;

export function webSearchTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Search the live web for information NOT in the workspace. Returns scraped article content, not just links. Use when the user asks a market-research, trend, competitor, or any question that requires current external knowledge. Search operators supported: site:, -site:, intitle:, \"exact phrase\". Italian market results by default. Before calling, always check listConversationFiles and retrieveContext first, because the answer may already be in the workspace.",
    inputSchema: z.object({
      query: z.string().min(2).max(400).describe("The search query. Natural language or with Firecrawl operators like site:nielseniq.com"),
      max_results: z.number().int().min(1).max(10).default(5).describe("Number of results to scrape. Default 5, keep low to stay under budget"),
      recency: z.enum(["anytime", "past_year", "past_month", "past_week"]).default("anytime"),
      source_type: z.enum(["web", "news"]).default("web"),
      country: z.string().length(2).default("IT").describe("ISO country for search localization"),
      language: z.string().length(2).default("it").describe("ISO language for search localization"),
    }),
    execute: async (input) => {
      // 1. Check per-conversation budget
      const currentCount = await countConversationSearches(ctx.conversationId);
      if (currentCount >= WEB_SEARCH_HARD_CAP) {
        return {
          error: `This conversation has reached the web search cap (${WEB_SEARCH_HARD_CAP}). Start a new conversation to continue searching.`,
        };
      }

      // 2. Call Firecrawl via shared client
      try {
        const results = await firecrawlSearch({
          query: input.query,
          limit: input.max_results,
          sources: [{ type: input.source_type }],
          location: { country: input.country, languages: [input.language] },
          tbs: recencyToTbs(input.recency), // "qdr:y" for past_year etc
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
            parsers: ["pdf"], // handle NIQ PDFs natively
            maxAge: 24 * 60 * 60 * 1000, // 24h cache
          },
        });

        // 3. Log the call (for budget enforcement + telemetry)
        await logWebSearchCall({
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          query: input.query,
          resultCount: results.length,
          creditsUsed: results.reduce((a, r) => a + (r.creditsUsed ?? 1), 0),
        });

        // 4. Shape results for Claude to read
        return {
          budget_remaining: WEB_SEARCH_HARD_CAP - currentCount - 1,
          warning: currentCount + 1 >= WEB_SEARCH_SOFT_WARN
            ? `Approaching web search cap (${currentCount + 1}/${WEB_SEARCH_HARD_CAP}). Summarize findings efficiently.`
            : null,
          results: results.map((r) => ({
            url: r.url,
            title: r.title,
            published_at: r.metadata?.["article:modified_time"] ?? r.metadata?.["parsely-pub-date"] ?? null,
            markdown: r.markdown?.slice(0, 15000) ?? "", // cap per-result at ~15k chars
          })),
        };
      } catch (error) {
        return {
          error: `Web search failed: ${error instanceof Error ? error.message : "unknown error"}. Try rephrasing the query or check workspace context with retrieveContext.`,
        };
      }
    },
  });
}
```

### 5.3 Shared Firecrawl client API surface
Do NOT write a new Firecrawl client. Reuse `firecrawlSearch` from [packages/research/src/clients.ts](../packages/research/src/clients.ts). If the exported API there does not match the shape needed here (e.g., missing `location` or `tbs`), extend it additively. Do NOT break the research layer's existing signature.

Check the current export:
```bash
grep -n "^export" packages/research/src/clients.ts | head
```

If `firecrawlSearch` is not exported, add it. Read the file first, then propose the minimal addition via a named export. The research layer is currently feature-flagged off in production (per `BASQUIO_RESEARCH_PHASE_ENABLED` unset), so adding an export is safe as long as no signature changes.

### 5.4 Add the tool to getAllTools
[apps/web/src/lib/workspace/agent-tools.ts:getAllTools](../apps/web/src/lib/workspace/agent-tools.ts), add:
```ts
import { webSearchTool } from "./agent-tools-web-search";
// ...
return {
  // ... existing tools,
  webSearch: webSearchTool(ctx),
};
```

### 5.5 Migration
New migration `supabase/migrations/<timestamp>_add_chat_web_search_calls.sql`:

```sql
create table if not exists public.chat_web_search_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  user_id uuid references auth.users(id),
  query text not null,
  result_count int not null default 0,
  credits_used int not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_chat_web_search_calls_conversation_id
  on public.chat_web_search_calls(conversation_id);

create index if not exists idx_chat_web_search_calls_created_at
  on public.chat_web_search_calls(created_at);
```

### 5.6 Acceptance
- Unit test in `apps/web/src/lib/workspace/agent-tools-web-search.test.ts` using a stubbed Firecrawl response: covers budget soft-warn, budget hard-cap, cache hit, successful search
- Live test: with Marco's FIRECRAWL_API_KEY in local .env, run a chat query "what are the coffee market trends in Italy", confirm the tool is called, results include NIQ or equivalent source, chat cites the URLs with published dates
- Budget enforcement: 200 searches per conversation hard cap, soft warning at 10

## 6. C3: analystCommentary tool (multi-file synthesis)

### 6.1 Why
Giulia's use case: "comment this slide based on both the other slides I already commented AND the theoretical PDF I uploaded." Today's tools:
- `analyzeAttachedFile` handles pandas on XLSX/CSV. Cannot read PDFs
- `retrieveContext` returns chunks, not synthesis
- No way to ask "read these files and reason as an analyst"

The new tool reads N attached files (PDFs, PPTX, markdown, DOCX) in a Files API `container_upload` call, runs code execution with a focused analyst prompt, returns structured commentary.

### 6.2 Tool definition
New file: `apps/web/src/lib/workspace/agent-tools-analyst-commentary.ts`

```ts
import { tool } from "ai";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";
import { fetchAttachedFilesByDocumentIds } from "@/lib/workspace/documents";
import { CLAUDE_ANALYST_COMMENTARY_PROMPT } from "@/lib/workspace/agent-analyst-commentary-prompt";

const FILES_BETA = "files-api-2025-04-14";
const CODE_EXEC_BETA = "code-execution-2025-08-25";

export function analystCommentaryTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Read multiple attached files (PDFs, PPTX, DOCX, MD) and produce analyst-grade commentary. Use when the user asks to comment on a slide, synthesize insights across documents, or add analyst annotations to attached content. Prefer this over retrieveContext when the user explicitly refers to attached files. Do NOT use for structured-data questions; use analyzeAttachedFile for those.",
    inputSchema: z.object({
      document_ids: z.array(z.string().uuid()).min(1).max(8).describe("IDs of knowledge_documents attached to this conversation"),
      objective: z.string().min(10).max(500).describe("What the commentary should focus on, e.g. 'comment slide 3 using the shifting theory PDF and the prior commented slides as reference'"),
      output_format: z.enum(["analyst_markdown", "slide_speaker_notes", "inline_bullets"]).default("analyst_markdown"),
      scope_context: z.string().max(500).nullable().default(null).describe("Optional workspace scope context (client name, category) to ground the commentary"),
    }),
    execute: async (input) => {
      try {
        // 1. Fetch files + validate they belong to the user's workspace
        const files = await fetchAttachedFilesByDocumentIds(ctx.workspaceId, input.document_ids);
        if (files.length === 0) {
          return { error: "No accessible files found for the given document IDs." };
        }

        // 2. Upload to Anthropic Files API
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const uploaded = await Promise.all(
          files.map((f) =>
            client.beta.files.upload({
              file: f.blob,
              betas: [FILES_BETA],
            }),
          ),
        );

        // 3. Call Sonnet 4.6 with code_execution + the uploaded files as container_uploads
        const response = await client.beta.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          betas: [FILES_BETA, CODE_EXEC_BETA],
          tools: [
            { type: "code_execution_20250825", name: "code_execution" },
          ],
          system: CLAUDE_ANALYST_COMMENTARY_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                ...uploaded.map((u) => ({ type: "container_upload", file_id: u.id } as const)),
                {
                  type: "text",
                  text: renderCommentaryInstruction({
                    fileNames: files.map((f) => f.filename),
                    objective: input.objective,
                    outputFormat: input.output_format,
                    scopeContext: input.scope_context,
                  }),
                },
              ],
            },
          ],
        });

        // 4. Extract the markdown commentary from the final assistant message
        const commentary = extractCommentaryMarkdown(response);

        return {
          commentary,
          file_names: files.map((f) => f.filename),
          model: "claude-sonnet-4-6",
          output_format: input.output_format,
        };
      } catch (error) {
        return {
          error: `Analyst commentary failed: ${error instanceof Error ? error.message : "unknown error"}. Try with fewer files or a more focused objective.`,
        };
      }
    },
  });
}
```

### 6.3 Analyst commentary system prompt
New file: `apps/web/src/lib/workspace/agent-analyst-commentary-prompt.ts`

```ts
export const CLAUDE_ANALYST_COMMENTARY_PROMPT = `You are a senior FMCG/CPG insights analyst writing commentary on uploaded materials for a colleague's deck.

Your job:
1. Read all attached files carefully (PDFs, PPTX, DOCX, MD). Files are mounted in your code execution container
2. Produce analyst-grade commentary anchored in what you read
3. Every claim cites its source file by name
4. Native Italian if the source files are Italian, native English if English. Match the language
5. Output format depends on the requested mode:
   - analyst_markdown: 3 to 6 short paragraphs, each starting with the headline insight, then the evidence, then the so-what
   - slide_speaker_notes: 1 to 3 sentences suitable as PowerPoint speaker notes
   - inline_bullets: 3 to 5 bullet points, each under 30 words
6. No em-dashes. Use commas, periods, parentheses
7. No AI slop. Banned: dive deep, leverage, unlock, empower, elevate, seamless, game-changer, revolutionize, cutting-edge, transformative
8. No invented numbers. If the attached files do not contain a specific number or claim, say "(non nei file)" or "(not in files)" in line

Before writing commentary, explore the files using code execution if useful (for example pandas on structured sheets, pypdf on PDFs). If the files are visual slides, describe what you see and cite by slide position.

Respond with only the commentary markdown. No preamble, no meta-explanation.`;
```

### 6.4 Files fetcher helper
New file: `apps/web/src/lib/workspace/documents.ts` (or extend existing `conversations.ts` / `knowledge-documents.ts`). Exposes `fetchAttachedFilesByDocumentIds(workspaceId, documentIds)` which:

- Queries `knowledge_documents` by id, filters by `organization_id` + `is_team_beta` + workspace membership
- Rejects documents with `status !== "indexed"` (still processing)
- Downloads blobs from Supabase Storage
- Returns `Array<{documentId, filename, blob, fileType}>`

Reuse the existing Supabase clients and workspace RLS pattern. Do NOT duplicate auth checks.

### 6.5 Add to getAllTools
Same pattern as `webSearch`.

### 6.6 Acceptance
- Unit test with mocked Anthropic client: returns commentary when given 2 file IDs
- Unit test: returns error when zero files match the workspace
- Live test: upload a NIQ PDF to a chat, ask "comment on the key findings in analyst terms," confirm the tool is called, commentary cites the PDF filename, output is in the language of the PDF
- Max files per call = 8, per conversation total file-read count = unlimited (file reads are cheap after upload)

## 7. C4: graceful tool error handling

### 7.1 Server-side catch wrapper
Every tool in `agent-tools*.ts` currently can throw unhandled errors that surface as raw AI SDK v6 protocol strings. Wrap each tool's `execute` in a server-side try/catch that ALWAYS returns a structured result, never throws.

Pattern (apply to every `tool({...execute: async (input) => {...}})`):
```ts
execute: async (input) => {
  try {
    // existing body
  } catch (error) {
    return {
      error: `<tool-name> failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
},
```

Refactor this systematically. Goal: zero `throw` in any tool's execute. All errors become `{ error: string }`.

### 7.2 System prompt addition
In [agent.ts SYSTEM_PROMPT](../apps/web/src/lib/workspace/agent.ts), add a new section:

```
WHEN A TOOL RETURNS AN ERROR
Tools always return either a successful result or an object with an `error` field. If you see an error, acknowledge it to the user in plain language, do not surface protocol strings or tool names verbatim. Then try an alternative path. For example if webSearch fails, try retrieveContext. If analystCommentary fails, try analyzeAttachedFile on a structured file. Never leave the user with "tool result missing" or "error calling tool X".
```

### 7.3 Acceptance
- Grep `packages/web/src/lib/workspace/agent-tools*.ts` confirms zero `throw` statements in any `execute` body
- Manual test: force an error in `webSearch` by setting a bad Firecrawl API key in dev env. Confirm chat shows "web search failed, trying workspace search instead" or similar graceful message, NOT "tool result is missing for tool call web_search"

## 8. C5: system prompt rewrite for analyst behavior

### 8.1 Current prompt is a tool-routing checklist
[agent.ts:3-37](../apps/web/src/lib/workspace/agent.ts) reads as a list of "when X, call tool Y". It's technically correct but does not prescribe analyst behavior. Claude follows the checklist literally and misses the spirit: an analyst DOES the work, does not describe it.

### 8.2 Replace with analyst playbook
Rewrite the SYSTEM_PROMPT as follows. Keep every existing tool-routing rule but add explicit analyst-behavior guidance at the top.

```ts
export const SYSTEM_PROMPT = `You are Basquio, a senior FMCG/CPG insights analyst sitting next to a colleague. You live in their workspace and have memory of their clients, rules, and past work.

YOUR DEFAULT MODE IS DOING THE WORK, NOT DESCRIBING IT
When the user asks a research question, synthesize an answer with citations. Do not recommend websites or suggest they Google it.
When the user asks you to comment on a slide or file, write the commentary. Do not offer to "help them get started."
When the user asks for a market overview and the workspace has no data, call webSearch to find grounded information and synthesize. Never say "I have no data" without first searching the web.
When the user uploads files, do something useful with them on the first turn: summarize, surface key findings, or ask a focused follow-up. Do not leave the file untouched.

CAPABILITIES YOU CAN OFFER
- Web research with citations: webSearch (Firecrawl-backed, returns full article bodies, supports site: and Italian market filters)
- Multi-file analyst commentary: analystCommentary (reads PDFs, PPTX, DOCX, MD attached to the conversation and writes commentary)
- Structured data analysis: analyzeAttachedFile (pandas on XLSX/CSV attached to the conversation)
- Workspace memory and context: retrieveContext, readMemory, showMetricCard
- Workspace management: saveFromPaste, scrapeUrl, editRule, editStakeholder, draftBrief

TOOL PRIORITY
1. If the user refers to "this slide", "this file", "questo PDF", etc., use analystCommentary or analyzeAttachedFile. Never ignore attached files.
2. If the user asks a market-research, trend, competitor, or external-knowledge question AND retrieveContext returns nothing useful, call webSearch. Synthesize at least one paragraph with citations.
3. If the user asks about workspace rules, stakeholders, prior work, call retrieveContext or the specific read tool.
4. If the user pastes content or drops a URL, call saveFromPaste or scrapeUrl. Approval card, not silent ingest.
5. If the user states a preference or rule, call editRule action=create or action=update.

[... rest of the existing prompt, unchanged, about how to write, anti-patterns, etc ...]

TOOL ERROR HANDLING
Tools always return either a successful result or an object with an error field. When you see an error, explain in plain language what failed, then try an alternative. Never surface protocol strings like "tool result is missing for tool call".

ANTI-PATTERNS
Never refuse a workspace action that a tool supports.
Never recommend websites without first trying webSearch yourself.
Never leave attached files unread when the user refers to them.
Never say "I am just an AI".
Never invent URLs, numbers, stakeholder details, or preferences. If a claim has no citation, write "(not in workspace)" inline.`;
```

### 8.3 Acceptance
- `grep -c "webSearch" apps/web/src/lib/workspace/agent.ts` returns at least 3 (prompt mentions it multiple times)
- `grep -c "analystCommentary" apps/web/src/lib/workspace/agent.ts` returns at least 2
- Manual test: ask "what are coffee market trends" on a fresh workspace. Expected: Claude calls `webSearch`, not "I can recommend websites"
- Manual test: upload a PDF, ask "comment on the key findings". Expected: Claude calls `analystCommentary`, not "tell me more about what you want"

## 9. C6: first-turn suggestions

### 9.1 Server-side
New endpoint `apps/web/src/app/api/workspace/chat/suggestions/route.ts` (GET). Input: `workspace_id`, `scope_id`. Output: three concrete-action suggestions derived from the current workspace state.

Algorithm:
1. Query: count attached files in scope, count memory entries, count stakeholders, list recent deliverables, list research runs
2. If files present: suggestion 1 is "Summarize findings in <most-recent-file-name>"
3. If stakeholders present: suggestion 2 is "Draft a brief for <scope-name> targeting <top-stakeholder>"
4. If web search is useful: suggestion 3 is "Find recent trade press on <scope-name>"
5. Return `{suggestions: [{label, prompt}]}` with at most 3 items

### 9.2 Client-side
Must be consumed by the Chat component without touching its file. Instead, the suggestions appear as a server-rendered block ABOVE the composer on the empty-state surface. Coordinate with the chat-ux-p0 session via a public API: the suggestions endpoint is documented, chat-ux-p0 session consumes it when they rebuild the empty state. Your work is server-side only.

Write a README note in `docs/2026-04-24-chat-suggestions-api.md` describing the endpoint for the chat-ux-p0 session to consume.

### 9.3 Acceptance
- `curl /api/workspace/chat/suggestions?workspace_id=<uuid>` returns 3 suggestions for a workspace with data, 0-2 for an empty one
- Unit test with mocked workspace state covering each branch

## 10. C7: next-turn suggestions

### 10.1 Server-side
After every assistant turn, compute 2-3 follow-up suggestions inline in the stream. Two options:

**Option A (simpler):** add a hidden instruction to the system prompt that Claude must end every final assistant message with a `<suggestions>` XML block containing up to 3 follow-up items.

**Option B (cleaner):** a post-turn Haiku call that reads the last assistant message and the workspace context, returns 2-3 follow-ups. Slightly more cost (~$0.01 per turn) but decoupled from Claude's output quality.

Recommend Option A for this PR (no extra API call, low latency). The suggestions XML block is parsed server-side in `onFinish` and appended to the saved message metadata for the UI to render.

### 10.2 System prompt addition
Add to the SYSTEM_PROMPT:

```
ALWAYS END YOUR FINAL MESSAGE WITH SUGGESTIONS
After every response, append this block (lowercase xml tags, exact format):

<suggestions>
- <label>short verb phrase, max 7 words</label><prompt>full prompt the user could send as their next message</prompt>
- <label>...</label><prompt>...</prompt>
- <label>...</label><prompt>...</prompt>
</suggestions>

Include 2 or 3 suggestions. Each label is what the user sees on the pill. Each prompt is what gets sent when they tap. Suggestions must be actionable follow-ups to YOUR response, not generic help text.
```

### 10.3 Parser
In the chat route's `onFinish`, parse the `<suggestions>` block from the final assistant message, extract `label` + `prompt` pairs, store in `conversations.metadata.last_suggestions` array. The UI reads this field.

Also STRIP the `<suggestions>` block from the saved assistant text so it does not render in the chat body.

### 10.4 Acceptance
- Unit test parser: given a message with a well-formed `<suggestions>` block, returns 3 `{label, prompt}` pairs and strips the block from the text
- Unit test parser: handles malformed blocks gracefully, returns empty array
- Live test: every assistant response is followed by 2-3 pills, tapping a pill sends the pre-filled prompt

## 11. C8: chat tool telemetry

### 11.1 Migration
Append to the same migration as C2:

```sql
create table if not exists public.chat_tool_telemetry (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  user_id uuid references auth.users(id),
  tool_name text not null,
  input_hash text,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms int,
  status text not null check (status in ('success', 'error', 'timeout')),
  error_message text,
  result_size_bytes int,
  created_at timestamptz default now()
);

create index if not exists idx_chat_tool_telemetry_conversation_id
  on public.chat_tool_telemetry(conversation_id);

create index if not exists idx_chat_tool_telemetry_tool_name_status
  on public.chat_tool_telemetry(tool_name, status);

create index if not exists idx_chat_tool_telemetry_created_at
  on public.chat_tool_telemetry(created_at);
```

### 11.2 Instrumentation
Create a helper in `apps/web/src/lib/workspace/chat-tool-telemetry.ts`:

```ts
export async function withChatToolTelemetry<T>(input: {
  conversationId: string;
  userId: string;
  toolName: string;
  inputHash: string;
  execute: () => Promise<T>;
}): Promise<T>;
```

This wraps every tool's execute call, writes a row on success with duration, writes a row on error with error_message. Decouples telemetry from individual tools so you only change each tool by one line.

Apply to every tool in `agent-tools*.ts`.

### 11.3 Acceptance
- Unit test: `withChatToolTelemetry` writes a success row on ok, writes an error row on throw, returns the wrapped result
- After a chat conversation, `select count(*) from chat_tool_telemetry where conversation_id = <id>` equals the number of tool calls

## 12. Test plan

Run in order before PR:
1. `pnpm typecheck`
2. `pnpm qa:basquio`
3. `pnpm vitest run apps/web/src/lib/workspace/`
4. `pnpm --filter @basquio/web build`
5. Manual: cold chat, ask for Italian coffee market trends. Expect webSearch call, synthesized paragraph with NIQ/trade-press citations
6. Manual: upload a PDF, ask "comment on this in analyst terms." Expect analystCommentary call, structured markdown commentary in the file's language
7. Manual: toggle deep mode on, same question. Expect Opus 4.7 response (verify via telemetry or request ID)
8. Manual: force a Firecrawl error (invalid key in local env), confirm graceful error surface, not protocol string
9. Verify pill suggestions appear after every response

## 13. PR shape

One PR titled: `C0 workspace chat analyst mode (Sonnet 4.6, Firecrawl search, multi-file commentary)`

Body:
```
Turns the workspace chat from a RAG wrapper into a real FMCG analyst
agent. Addresses Rossella's and Giulia's dogfood feedback on 2026-04-24
where the chat recommended websites instead of synthesizing web
research, and surfaced raw streaming errors on PDF uploads.

Eight coordinated changes:

1. Model upgrade to Sonnet 4.6 default, Opus 4.7 as deep-mode toggle
2. webSearch tool via Firecrawl (200/conv hard cap, 10 soft warn)
3. analystCommentary tool for multi-file synthesis (PDF/PPTX/MD/DOCX)
4. Graceful tool error handling (zero throws, structured errors)
5. System prompt rewrite from tool-routing checklist to analyst playbook
6. First-turn suggestions API (consumed by chat-ux-p0 UI)
7. Next-turn suggestions embedded in every response via xml block
8. chat_tool_telemetry table + withChatToolTelemetry wrapper

Full spec at docs/2026-04-24-c0-workspace-chat-analyst-mode-codex-handoff.md
```

Reviewers: Marco. Do not self-merge.

## 14. What NOT to touch

Reaffirming:
- `apps/web/src/components/workspace-chat/**`
- `apps/web/src/components/scope-landing.tsx`
- `apps/web/src/app/(workspace)/workspace/**`
- `apps/web/src/app/global.css`
- `packages/workflows/**`
- `packages/intelligence/**`
- `packages/research/src/**` EXCEPT you may ADD a named export to `clients.ts` for `firecrawlSearch` if it is not already exported, with zero signature changes to existing exports
- `docs/domain-knowledge/**`
- `memory/**`, `rules/**`

## 15. Verification I did before writing this spec

- Read `apps/web/src/app/api/workspace/chat/route.ts` in full
- Read `apps/web/src/lib/workspace/agent.ts` in full
- Cataloged every tool in `apps/web/src/lib/workspace/agent-tools*.ts`
- Confirmed model is `claude-sonnet-4-5` via grep
- Ran a live Firecrawl search for "Italian coffee market trends 2025 CPG Nielsen" via the Firecrawl MCP. Top result was the NIQ Italy On Premise Consumer Pulse Report August 2025, scraped with 28KB of markdown + structured metadata. This proves Firecrawl is the right backend, not Anthropic native web_search
- Verified no existing webSearch or analystCommentary tool exists in the workspace chat path
- Verified Marco's decisions:
  - Sonnet 4.6 default, Opus 4.7 deep mode toggle
  - Firecrawl for web search, not Anthropic native
  - Per-conversation budget 200 hard cap, 10 soft warn
  - No emoji/em-dash ever

## 16. Open points, none blocking

- Pricing tier enforcement: the 200/conv cap is pure dogfood-friendly. When paying tiers land (Motion 2a/2b/2c), cap by plan: 10/conv Free, 50/conv 2a, 200/conv 2b, unlimited 2c. Separate PR, not this one
- Deep mode UX: the composer toggle UX itself is owned by the chat-ux-p0 session, they read `conversations.metadata.chat_mode_last`. This PR only ships the server-side model selector and persistence
- Follow-up: when `packages/research/src/clients.ts` lands its final export surface (owned by the deck-pipeline codex), revisit the webSearch tool wrapper to use the canonical export. For now, add what you need with minimum additive diff

End of spec.
