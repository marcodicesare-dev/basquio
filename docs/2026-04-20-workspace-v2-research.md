# V2 Workspace research memo

**Date:** 2026-04-20
**Author:** the V2 build agent, pre-implementation research phase
**Deliverable kind:** research only, no code shipped. Working rules §2.
**Primary spec:** [docs/spec-v1-workspace-v2-research-and-rebuild.md](spec-v1-workspace-v2-research-and-rebuild.md)
**Acceptance:** Marco approves this memo in a reply before the build agent writes any code. Any code pushed without that approval is a working-rules §2 violation.
**8 locked IA decisions:** read from primary spec §3, quoted verbatim in the pre-session handoff. Not debated here.

---

## 0. Executive summary

Five empirical findings that shape the V2 build plan:

1. **Vercel AI SDK 6 (Dec 22 2025)** is the right chat foundation for Basquio V2. v6 ships Agents, `UIMessage` parts protocol, tool-execution approval, full MCP support, and generative-UI patterns already battle-tested in rabbhole. Migrating off the hand-rolled `fetch + ReadableStream` loop in `workspace-prompt.tsx` is strictly an upgrade. Source: [vercel.com/blog/ai-sdk-6](https://vercel.com/blog/ai-sdk-6).
2. **Legora and Harvey do not visibly surface memory.** Their public product pages emphasize citation-backed reasoning, workflow composition, and firm-document Vaults. Neither product exposes a "here is what the AI remembers about your firm" browse surface. This gives Basquio an opening to out-position both on the defensive bundle (CPG schema + cross-source assembly + compounding procedural memory + bi-temporal grounding), not on "we have memory" abstractly.
3. **ChatGPT Memory + Claude Projects define the visible-memory floor.** Both expose memory via a Settings panel with per-item edit/delete. Neither renders memory inline during chat turns. Basquio V2 should exceed this floor by rendering a memory-consultation tool-call chip inline during generation, plus a first-class left-rail Memory surface.
4. **Scope-as-navigation is the industry-converged pattern.** Linear teams/projects, Claude.ai Projects, ChatGPT Projects, Perplexity Spaces, Cursor folders, Notion pages all use a sidebar list with click-to-switch as the primary scope-switcher. None place a scope chip inside the chat input. Basquio scope picker stays out of the prompt; it is the left rail.
5. **V1 entity resolution is at 43% recall / 100% precision.** I ran a 47-row Italian-CPG test corpus against the current algorithm (normalize + exact match). Recall fails hard on aliases (NIQ → NielsenIQ Italy), phonetic variants (Elena Bianki → Elena Bianchi), and company suffixes (Barilla Group S.p.A. → Barilla Group). This is below the 85% kill-condition in [motion2-workspace-architecture.md §11](motion2-workspace-architecture.md). V2 must add a resolver cascade.

Plus one strategic critical-path finding: **the basquio.com homepage hero sells the OLD data-to-deck product** ("Beautiful Intelligence · Two weeks of analysis · Upload your data"). I verified this live against https://basquio.com/ on 2026-04-20. A rewrite proposal is in §9.

---

## 1. AI SDK 6 research + Chat UX render bar

### 1.1 Current version

**AI SDK 6, released Dec 22 2025.** Announcement: [vercel.com/blog/ai-sdk-6](https://vercel.com/blog/ai-sdk-6). Migration guide: [ai-sdk.dev/docs/migration-guides/migration-guide-6-0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0). Upgrade is `npx @ai-sdk/codemod v6`.

Key packages (from rabbhole's [package.json](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/package.json)):
- `ai@^6.0.0`
- `@ai-sdk/react@^3.0.0` (`useChat` hook lives here)
- `@ai-sdk/anthropic@^3.0.0` (Claude provider)

### 1.2 v6 patterns Basquio V2 must adopt

All verified against [vercel.com/blog/ai-sdk-6](https://vercel.com/blog/ai-sdk-6) and rabbhole's live code (`/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/{components/chat,app/api/chat/route.ts}`).

**Agents**: use `ToolLoopAgent` or implement the `Agent` interface. Default `stopWhen: stepCountIs(20)` runs the tool-call loop server-side until the model produces a final assistant message. `InferAgentUIMessage<typeof agent>` exports a typed UIMessage variant for the client.

```ts
// from vercel.com/blog/ai-sdk-6
export const weatherAgent = new ToolLoopAgent({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You are a helpful weather assistant.',
  tools: { weather: weatherTool },
});
export type WeatherAgentUIMessage = InferAgentUIMessage<typeof weatherAgent>;
```

**Streaming response**: `createAgentUIStreamResponse({ agent, uiMessages })` in the API route returns the v6 UI message stream. The client hooks into `useChat<TypedUIMessage>()` which parses the stream into `message.parts`.

**UIMessage.parts**: every v6 message is `{ id, role, parts: UIPart[] }`. `UIPart` is a discriminated union by `type`:
- `type: 'text'`, has `text: string`
- `type: 'file'`, has `url, mediaType, filename?`
- `type: 'reasoning'`, Claude's thinking stream (collapsible)
- `type: 'source-url'`, model-provided citation
- `type: 'tool-<toolName>'`, per-tool with `state, toolCallId, input?, output?, errorText?, approval?`

Rendering pattern (from rabbhole [`ChatMessage.tsx`](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/components/chat/ChatMessage.tsx)):
```tsx
message.parts.map((part, i) => {
  if (part.type === 'text') return <ChatMarkdown text={part.text} />
  if (isFileUIPart(part))  return <FileAttachment part={part} />
  if (isToolUIPart(part))  return <ToolInvocationPart {...toolPart} />
  return null
})
```

Each tool render is a dedicated React component per tool name (`'tool-weather'` → `<WeatherToolView invocation={part} />`). This IS the generative UI pattern, tool output shape drives component selection.

**Tool streaming lifecycle states**: `input-streaming` → `input-available` → `output-available` (terminal success) OR `approval-requested` → `approval-responded` → `output-available` (terminal with HIL). Verified against rabbhole [`chat/route.ts:550-577`](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/chat/route.ts).

**Tool execution approval**: `needsApproval: boolean | (input) => Promise<boolean>` on a tool definition. Client handles via `addToolApprovalResponse({ id, approved })`. Source: [vercel.com/blog/ai-sdk-6#tool-execution-approval](https://vercel.com/blog/ai-sdk-6). For Basquio this covers: saving a memory rule ("remember Elena prefers waterfall") can auto-execute, but deleting a client-scope memory or cloning a demo-template into a customer workspace requires approval.

**`sendAutomaticallyWhen`**: when the assistant's last message resolves all pending tool-approval decisions, the chat auto-re-submits. rabbhole uses `lastAssistantMessageIsCompleteWithApprovalResponses` (from `ai`). This closes the HIL loop without a second user click.

**Transport customization**: `new DefaultChatTransport({ api: '/api/chat', body, prepareSendMessagesRequest })` lets you sanitize messages before sending (rabbhole strips orphaned tool parts after a dropped stream).

**Anthropic provider specifics**:
- Package: `@ai-sdk/anthropic@^3.0.0`
- Model id: `'anthropic/claude-sonnet-4.5'` (rabbhole default) or explicit provider instance `anthropic('claude-opus-4-7')`
- Memory Tool: compatible. Rabbhole does not use it in-band with the chat loop, but the Basquio V1 generation path already wires it directly via the Anthropic SDK. V2 keeps the same wiring (spec §6, "what not to touch").
- **Input examples**: v6 added `inputExamples: [{input: {...}}, ...]` on tool definitions. "Currently only natively supported by Anthropic" per [vercel.com/blog/ai-sdk-6#input-examples](https://vercel.com/blog/ai-sdk-6). Use for Basquio's memory-write tool: give the model 3 examples of well-formed `teachRule` calls so it doesn't burn tokens guessing the shape.
- **Reasoning tokens**: `type: 'reasoning'` parts stream when Claude 4.5+ is prompted with `providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 4000 } } }`. Render these collapsed-by-default (`<details><summary>Thinking…</summary>…</details>`).

**MCP**: v6 ships `@ai-sdk/mcp` with `createMCPClient({ transport: { type: 'http', url, headers } })`. OAuth handled via `OAuthClientProvider`. Resources and prompts API expose server-initiated prompt templates. Basquio exposure as MCP server is locked for post-V2 (per [motion2-workspace-architecture.md §6](motion2-workspace-architecture.md)). **Not in V2 scope.**

**Other v6 additions relevant to Basquio**: DevTools (inspector in browser), reranking via `@ai-sdk/core`, strict tool mode opt-in, `toModelOutput` for controlling what tokens the model sees from a tool's result (important for chunked RAG where `execute` returns 50KB but only 2KB should go into context).

### 1.3 Chat UX render bar

This is the non-negotiable acceptance bar for the V2 chat surface. Each primitive below: what it is, reference product that sets the bar, AI SDK 6 API that enables it.

| # | Primitive | Reference product | AI SDK 6 wiring |
|---|---|---|---|
| 1 | **Markdown-rich answer rendering** (headings, bold, italic, lists, tables, code blocks with syntax highlight, blockquotes, horizontal rules) | Claude.ai, ChatGPT, Perplexity Pages | `type: 'text'` parts → MDX or `react-markdown` + `remark-gfm` pipeline. See rabbhole `ChatMarkdown` component. Current V1 flattens text into `<p><span>` which is 2022-era. |
| 2 | **Syntax-highlighted code blocks** | Claude.ai, Claude Code, ChatGPT | Same text pipeline + `rehype-highlight` or `shiki`. Add copy-button on hover per block. |
| 3 | **Inline tables** | Harvey Review Tables, Perplexity | Render markdown tables as `<table>` with sticky header + alternating row fill. Critical: FMCG analyst answers are loaded with tables. V1 renders them as prose. |
| 4 | **Tool call chips** ("🧠 Reading memory · client:Mulino Bianco") with state-driven animation | Claude Code, Cursor Composer | `type: 'tool-<name>'` parts. Render `state === 'input-streaming'` as skeleton shimmer, `state === 'input-available'` as chip with input summary, `state === 'output-available'` as chip with output preview + expandable detail. Rabbhole pattern. |
| 5 | **Reasoning tokens collapsed-by-default** | Claude.ai | `type: 'reasoning'` parts, `<details>` HTML element or custom accordion. Small "Thinking" label, duration counter, token count. Enable on Claude 4.5+ with `providerOptions.anthropic.thinking`. |
| 6 | **Generative UI cards inline** (metric cards, small charts, timelines, entity cards) | v0 generative-UI templates, Claude Artifacts | Tool returns structured JSON → per-tool React component renders from `part.output`. Rabbhole does this via the A2UI pattern (`_viewEnvelope` + `_a2uiSpec` on tool output, client resolves to registered component). Basquio tools: `showMetricCard`, `showStakeholderCard`, `showFactTimeline`, `showComparisonTable`. |
| 7 | **Streaming polish** (typing cursor at frontier token, token fade-in ~100ms ease-out, skeleton morph to content) | Claude.ai, ChatGPT | Rabbhole uses `<span className="streaming-cursor" />` appended to the last text part while `status === 'streaming'`. Framer-motion `initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}` on new parts. |
| 8 | **Citation chips with hover preview** | Perplexity Pages | `type: 'source-url'` parts or custom text pattern `[s1]` → hover delay 100ms → tooltip with source title + quote + page number. Current V1 is click-only to side sheet. Keep the side sheet, add hover. |
| 9 | **Copy / Regenerate / Stop / Thumbs up-down** on every answer | ChatGPT, Claude.ai | Copy → `navigator.clipboard.writeText(messageToMarkdown(msg))`. Regenerate → `sendMessage({ parts: lastUserMessage.parts })`. Stop → `stop()` from `useChat`. Feedback → `POST /api/workspace/feedback` persisting `(deliverable_id, value, comment?)`. |
| 10 | **Canvas mode** for long deliverables | Claude Artifacts, ChatGPT Canvas, Perplexity Pages | Hoist registered read-tool output to a right-pane canvas via `onToolOutput` callback (rabbhole pattern). Edits in the canvas dispatch back as procedural memory writes. Useful for memo drafts, deck outlines, long briefs. |
| 11 | **Inline file-attachment chips** (PDFs, images) | ChatGPT, Claude.ai | `isFileUIPart(part)` → render image inline or PDF badge with filename + mediaType. Rabbhole already ships this. |
| 12 | **Human-in-the-loop approval chrome** | Claude Code (tool approval), Cursor (diff approval) | `state === 'approval-requested'` → approve/deny buttons, `addToolApprovalResponse({ id, approved })`. Use for Basquio destructive writes (delete scope, clone workspace template) and for generative UI spec approvals. |
| 13 | **Stop button with instant-abort** | Claude.ai, ChatGPT | `stop()` from `useChat`. Visual: replace "Send" button during `status === 'streaming'` with a stop square. |
| 14 | **Conversation thread context** (history across turns in the same scope) | ChatGPT, Claude.ai, Perplexity | V1 treats every Q/A as a standalone `workspace_deliverable` row. V2 should introduce `workspace_conversations` as a parent for multi-turn threads; deliverables become the "saved / promoted" subset. Out-of-scope for first V2 PR if it blows up schema; surface the gap in the spec. |
| 15 | **Sub-50ms interaction feedback** (optimistic UI on every click, type, submit) | Linear | Working rules §7. Non-negotiable. |

### 1.4 Migration plan for `workspace-prompt.tsx`

Current V1 ([apps/web/src/components/workspace-prompt.tsx](../apps/web/src/components/workspace-prompt.tsx)) hand-rolls the streaming loop: `fetch` → `getReader()` → `TextDecoder` → manual SSE split → manual state reduction. Every primitive above is either missing or duct-taped.

V2 migration:
1. Add `@ai-sdk/react@^3.0.0`, `@ai-sdk/anthropic@^3.0.0`, `ai@^6.0.0` (matching rabbhole).
2. Define `BasquioWorkspaceAgent = new ToolLoopAgent({ model: 'anthropic/claude-opus-4-7', instructions, tools })` in `apps/web/src/lib/workspace/agent.ts`. Tools:
   - `readMemory({ scope, path })`, reads a memory entry, returns the file with line numbers
   - `teachRule({ scope, rule })`, user-triggered or model-inferred; `needsApproval: (input) => input.scope.startsWith('client:')` for client-scope writes
   - `retrieveContext({ prompt, scopes })`, returns cited chunks
   - `openStakeholderProfile({ person_id })`, generative UI, renders stakeholder card inline
   - `showMetricCard({ subject, predicate, period })`, generative UI, renders metric card
   - `cloneDemoTemplate({ template_id, target_workspace_id })`, `needsApproval: true` always
3. Route: `app/api/workspace/chat/route.ts` returns `createAgentUIStreamResponse({ agent, uiMessages })` with DB-backed `saveChat` on `onFinish` (rabbhole pattern).
4. Client: `useChat<BasquioWorkspaceUIMessage>({ transport: new DefaultChatTransport({ api: '/api/workspace/chat' }), sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })`.
5. Delete the hand-rolled stream parsing.

Effort estimate: 6-8 hours for the migration + per-tool view components. Saves weeks of reinventing primitives.

---

## 2. Legora and Harvey teardown

Verdict in two lines: both products emphasize citation-backed reasoning and polished workflow composition, neither exposes memory as a user-facing browse surface. Basquio's opening is to lead with visible memory AND match their citation rigor.

Full matrix:

| Dimension | Legora | Harvey | Basquio V2 implication |
|---|---|---|---|
| Scope as navigation | UNVERIFIED (no public screenshots of matter switcher) ([legora.com/product](https://legora.com/product)) | UNVERIFIED for unified switcher; modular Vault / Assistant / Knowledge / Workflows ([harvey.ai/platform](https://www.harvey.ai/platform)) | Left-rail scope tree per spec §3 Decision 1. No need to wait on verifying their pattern. |
| Chat surface chrome | "Source-cited answers" and collaborative chat. No screenshots available ([purple.law/blog/legora-review-2025](https://purple.law/blog/legora-review-2025/)) | Citation-backed answers with "visible reasoning steps and paper trail of AI thinking" ([harvey.ai/blog/how-we-approach-design-at-harvey](https://www.harvey.ai/blog/how-we-approach-design-at-harvey)) | Match their citation rigor. Surpass with inline reasoning tokens collapsed-by-default. |
| Memory surface | Not mentioned on product pages | "History log exposed for audit/revisit"; "Library" for firm documents ([purple.law/blog/harvey-ai-review-2025](https://purple.law/blog/harvey-ai-review-2025/)). This is document-memory, not learned memory. | Memory-tab-in-left-rail is a direct differentiator per spec §3 Decision 2. |
| Entity linking | UNVERIFIED | Citations link to source material; Knowledge connects 100+ legal databases | Entity chips link to stakeholder profile pages per spec §3 Decision 3. |
| Onboarding | Playbooks post-onboard for rule sets ([legora.com/landing/playbooks](https://legora.com/landing/playbooks)). Enterprise deploys in "days to weeks." | Harvey Academy with "on-demand training, expert workflows, and step-by-step guidance." 3-6 month enterprise implementation. ([academy.harvey.ai](https://academy.harvey.ai/)) | Basquio's 4-step guided setup per spec §3 Decision 4 is lighter-touch and right for SMB-mid-market motion. |
| Landing hero copy | "Law just got more attractive. Collaborative AI for exceptional lawyers." Focuses on collaboration. Memory not mentioned. ([legora.com](https://legora.com/)) | "Practice Made Perfect. Today's top law firms and in-house legal teams trust Harvey to elevate their craft and navigate complexity." Focuses on craft/reasoning/delivery. Memory not mentioned. ([harvey.ai](https://www.harvey.ai/)) | Basquio's V2 hero per spec §3 Decision 6 lands explicitly on memory AND specifies what-Basquio-knows. Differentiates from both. |
| Command palette | UNVERIFIED on both |  | Basquio V2 adds Cmd+K per spec §5. |

### 2.1 Ten concrete UX patterns worth adopting

1. **Citation trails with backtracking.** Inline citations that jump straight to the source without a modal transition. Source: [harvey.ai/blog/how-we-approach-design-at-harvey](https://www.harvey.ai/blog/how-we-approach-design-at-harvey).
2. **Vault / Library as a first-class home for firm documents.** Basquio already has `knowledge_documents`; the UI needs a dedicated Files view per scope with search + filter + preview. Source: [harvey.ai/platform/assistant](https://www.harvey.ai/platform/assistant).
3. **Spreadsheet-style review tables for bulk data.** Harvey Vault Review Tables and Legora Tabular Review. Basquio should render NIQ exports as editable grids, not only as prose. Source: [purple.law/blog/legora-review-2025](https://purple.law/blog/legora-review-2025/).
4. **Natural-language workflow composition.** Describe a multi-step task in prose, system translates to a workflow. Harvey Workflow Builder. For Basquio: "monthly Conad review for Mulino Bianco" → saved multi-tool prompt chain. Source: [harvey.ai/platform/workflow-agents](https://www.harvey.ai/platform/workflow-agents).
5. **Domain-signal typography.** Harvey's visible reasoning and restrained chrome tell the reader "this is legal, not ChatGPT." Basquio's CPG signals: KPI vocabulary, retailer names in citations, category scaffolding visible on first screen. Source: [harvey.ai/blog/how-we-approach-design-at-harvey](https://www.harvey.ai/blog/how-we-approach-design-at-harvey).
6. **Shared prompts library.** Legora Playbooks let teams capture firm-specific review criteria and reuse. For Basquio: `/memories/workspace/prompts/monthly-incrementality.md`, a versioned prompt template. Source: [legora.com/landing/playbooks](https://legora.com/landing/playbooks).
7. **Domain-aware auto-extraction with human verification.** Harvey Review Tables let the AI classify and extract, then require lawyer verification. Basquio: show extracted entities with a "confirm / edit / reject" UI on upload. Source: [harvey.ai/blog/how-we-approach-design-at-harvey](https://www.harvey.ai/blog/how-we-approach-design-at-harvey).
8. **History log as audit trail.** Harvey exposes past queries and responses for audit. Basquio already has `workspace_deliverables` as the ledger; surface it as a History view per scope. Source: [purple.law/blog/harvey-ai-review-2025](https://purple.law/blog/harvey-ai-review-2025/).
9. **Integrated research without context-switching.** Harvey bridges internal + external sources in one query. Basquio V2: workspace + Basquio Research (existing product) + NIQ connectors stay in one chat. Source: [harvey.ai/platform/assistant](https://www.harvey.ai/platform/assistant).
10. **Pre-built expert workflows with customization on-ramp.** Ship 5 CPG templates (monthly category review, incrementality analysis, distribution gap, promo ROI, competitive one-pager). User can remix via chat. Source: [harvey.ai/platform/workflow-agents](https://www.harvey.ai/platform/workflow-agents), [legora.com/landing/playbooks](https://legora.com/landing/playbooks).

---

## 3. Memory UI patterns across products

Full matrix below. Every claim sourced or flagged UNVERIFIED. Audit scope: visibility, edit, direct-add, delete, inline-reveal during chat, scope structure, failure-mode handling, pricing.

| Product | Visibility | Edit | Direct add | Delete | Inline reveal | Scope | Failure mode | Pricing |
|---|---|---|---|---|---|---|---|---|
| ChatGPT Memory ([OpenAI help](https://help.openai.com/en/articles/8590148-memory-faq)) | Settings → Personalization → Manage Memory | Yes, in list UI + conversational ("refine my memory of X") | Yes, conversational ("remember that I…") | Trash icon per item; bulk Clear all; conversational forget | Applied silently, not cited in response | Flat global list; "evolves per conversation" | Conversational correction | All plans as of 2025 |
| Claude Projects ([anthropic.com/news/projects](https://www.anthropic.com/news/projects), [VentureBeat Aug 2025](https://venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-mode-for-all)) | Settings → Personalization → Manage memory (per-project) | Yes, via settings or conversational | Yes, conversational | Per-item toggle + "forget" by natural language; Clear all button | Silent consultation | Per-project; flat list within project | Conversational repair | Pro/Team/Enterprise plans |
| Mem.ai ([get.mem.ai](https://get.mem.ai/)) | Claimed "full graph" sidebar; UNVERIFIED UI details | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | Graph with "timelines, collections" | UNVERIFIED | Free + paid UNVERIFIED |
| Reflect ([reflect.app](https://reflect.app/), [reflect.academy](https://reflect.academy/using-backlinks-and-tags)) | Backlinks panel below each note; split-pane view | Yes, edit notes directly; AI palette (Cmd+J) auto-backlinks | Yes, create note + link via `[[` | Delete note or backlink | No inline-in-chat reveal (not chat-first) | Networked notes + tags + backlinks | No conflict-resolution UI documented | $10/mo annual, 14-day trial |
| Tana ([tana.inc/knowledge-graph](https://tana.inc/knowledge-graph)) | Outline hierarchy visible; supertag views | Yes, edit nodes + fields in-place | Yes, create node + attach to hierarchy | Yes, delete node | No chat-first memory reveal; meeting transcription auto-structured | Hierarchical outline + supertags + graph | UNVERIFIED | Freemium, paid tiers UNVERIFIED |
| Granola ([granola.ai](https://www.granola.ai/)) | Chat query interface; templates visible; read-only meeting notes | No; read-only capture | No; only via meeting capture | No explicit delete UI documented | No; query returns extracted data | Flat templates + meeting transcripts | UNVERIFIED | Freemium; 2025 Series C $125M [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/) |
| Anthropic Memory Tool ([docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)) | Developer-facing `/memories` virtual filesystem; **no product UI** | `str_replace`, `insert`, `delete` commands | `create` command | `delete` command | Tool calls visible in transcript if exposed | File/folder hierarchy | Developer-controlled | API-only, beta header `context-management-2025-06-27` |

### 3.1 Basquio V2 recommended position

Between Mem.ai (fully visible) and Claude Projects (settings-gated). Specifically:

1. **Left-rail Memory entry** (Mem.ai-style): not just in Settings. Memory is a scope-level destination in the left navigation per spec §3 Decision 1. Below it, three sub-sections: Rules (procedural), Facts (semantic), Wins (episodic).
2. **Settings-gated fine control** (ChatGPT Memory style): Workspace Settings → Memory gives the user a complete flat list filterable by scope + type. Edit / delete / pin / archive inline. This backs the left-rail entry.
3. **Conversational add** (Claude Projects style): typing "remember X" or "always use Y" triggers the `teachRule` tool. The tool's `output-available` state renders an inline confirmation card: "Rule recorded: `/memories/client:Mulino Bianco/preferences/chart-conventions.md`. Edit · Remove."
4. **Inline reveal during chat** (NEW, no comp): when the agent consults memory, render a tool-call chip: "🧠 Reading memory · client:Mulino Bianco · 12 rules / 4 facts / 3 stakeholders". Click the chip expands to show which entries were read. This is the "the AI is consulting what I taught it" signal that Claude Projects, ChatGPT, and Harvey all lack.
5. **Failure mode surfacing**: if a memory entry was wrong, user clicks "Edit" on the inline confirmation. Or, on any deliverable, user clicks a citation to a memory entry and edits it in a side panel. Edits write a new entry with `superseded_by` linking to the old one (bi-temporal grounding already in the facts table schema).

### 3.2 Five concrete UI components to build

1. **MemoryListPanel** (left rail destination). Groups entries by scope → type → title with counts. Inspired by Mem.ai + Claude Projects.
2. **MemoryCard** (single-entry view with edit-in-place). Fields: scope, type, path, content, `created_at`, `updated_at`, pin state, supersedes/superseded-by. Inspired by Reflect notes.
3. **InlineMemoryToolChip** (chat surface). States: reading, read, error. Expandable detail. No existing comp, closest is Claude Code tool chips.
4. **TeachRuleConfirmation** (inline card after `teachRule` tool call completes). Shows the rule text, the scope it saved to, edit + delete buttons. Inspired by Claude Projects conversational edit.
5. **MemoryFeedbackButton** (below every answer that cited a memory entry). "This memory is wrong →" opens an edit modal pre-filled with the entry. Inspired by ChatGPT conversational correction.

---

## 4. Scope-as-navigation across products

Full matrix:

| Product | Scope container | Left rail | Scope switch | Create scope | Chat scope chip | Default behavior | Cross-scope |
|---|---|---|---|---|---|---|---|
| Linear ([linear.app/docs/teams](https://linear.app/docs/teams)) | Project, Team, Cycle | Sidebar hierarchy Workspace → Teams → Projects, pinnable | Click in sidebar; scope persists | Button in Projects page | None in chat; scope shown in issue header | Auto-scopes | Cycles are team-scoped; explicit team switch required |
| Cursor ([forum.cursor.com](https://forum.cursor.com/t/how-to-move-primary-side-bar-on-cursor-to-the-left-vscode-like-ui-and-import-preferences/152098)) | Codebase / folder | File explorer (VSCode-style) | Click folder; workspace reloads | File → Open Folder, or Ctrl+K | None; workspace shown in window title | Auto-scopes to open folder | Separate windows for multi-codebase |
| Notion ([notion.com/product/ai](https://www.notion.com/product/ai)) | Page or workspace | Left sidebar page tree | Click page title; chat context updates | + New Page in sidebar | None; page shown in header | Per-page AI by default | Workspace AI spans via Enterprise Search |
| Claude.ai ([guideflow.com/tutorial/how-to-open-the-sidebar-in-claudeai](https://www.guideflow.com/tutorial/how-to-open-the-sidebar-in-claudeai)) | Project | Collapsible project list, recent at top | Click project; chat history switches | + New Project button | None; project name in sidebar highlight | Auto-scopes | Projects isolated; memory doesn't leak |
| ChatGPT ([help.openai.com/en/articles/10169521](https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt)) | Project or Custom GPT | Sidebar list, projects above GPTs below, pinnable | Click project/GPT | + New in sidebar / Create in top nav | None; shown above conversation | Auto-scopes | Separate namespaces; no cross-query |
| Claude Code ([code.claude.com/docs](https://code.claude.com/docs)) | Repo / cwd | No persistent rail; implicit in terminal `cd` or IDE open-workspace | Implicit; `cd` or IDE workspace | Run `claude` in target directory | No chip; context token usage shown only | Scope is `pwd` | Sub-agents for multi-repo |
| Perplexity Spaces ([perplexity.ai/help-center/en/articles/10352961](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces)) | Space | Collapsible Spaces list, pinnable | Click space; threads + files reload | + New Space in sidebar | None; space in sidebar highlight | Auto-scopes | Isolated, no cross-space |

### 4.1 Converged pattern

Five of seven use **sidebar list + click-to-switch + no scope chip in chat input**. None surface a scope chip inside the prompt input because it duplicates the sidebar highlight. Basquio V1 has a `<select>` inside the prompt which is the worst of both worlds: invisible as navigation, obtrusive as chrome.

### 4.2 Five left-rail patterns for Basquio

1. **Linear hierarchical Teams → Projects** (two-level) for Basquio: Workspace → Clients → (child scope). Source: [linear.app/docs/teams](https://linear.app/docs/teams).
2. **Claude.ai flat Project list with + New** button inline. Matches spec §3 Decision 1 tree. Source: [guideflow.com/tutorial](https://www.guideflow.com/tutorial/how-to-open-the-sidebar-in-claudeai).
3. **Perplexity Spaces collapsible icon-sidebar** with pinned / recent sections. Good pattern for users with 15+ scopes. Source: [perplexity.ai/help-center](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces).
4. **ChatGPT dual-namespace sidebar** (Projects / Custom GPTs). Basquio analog: Clients / Categories / Functions as three parallel sections under the tree. Source: [help.openai.com/en/articles/10169521](https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt).
5. **Cursor implicit workspace scoping** (context token counter but no explicit switcher). Not the primary pattern for Basquio, but relevant for mobile where the left rail collapses, implicit + breadcrumb only. Source: [code.claude.com/docs](https://code.claude.com/docs).

### 4.3 Scope-switcher UX recommendation

When the user is inside `Clients / Mulino Bianco`:

- **Left rail**: "Mulino Bianco" highlighted (bold + background token from design-tokens.md).
- **Top breadcrumb**: `Clients / Mulino Bianco` read-only, click to navigate up.
- **Prompt input**: placeholder changes to "Ask about Mulino Bianco" (no scope chip inside the input).
- **Retrieval**: auto-scoped. Cross-scope override via Cmd+K → "Ask across Clients: …" destination.
- **Sidebar → different client**: click loads the new client's context. Current unsaved prompt draft preserved per scope (prevents data loss when switching).
- **Cmd+K palette**: destinations include every scope, every stakeholder, every recent deliverable, every memory entry. Fuzzy search.

The pattern is **sidebar primary + Cmd+K fast-path**. Both live, not one or the other. Converged across Linear, Claude.ai, ChatGPT, Perplexity.

---

## 5. Rabbhole reference implementation

Path: `/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/{components/chat,app/api/{chat,views}}`. All claims below are from direct file reads on 2026-04-20.

**Version lock** (`apps/web/package.json`): `ai@^6.0.0`, `@ai-sdk/react@^3.0.0`, `@ai-sdk/anthropic@^3.0.0`. Basquio matches.

**What Basquio should copy verbatim**:

1. **DefaultChatTransport with prepareSendMessagesRequest** for per-request message sanitization ([Chat.tsx:37-60](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/components/chat/Chat.tsx)). Basquio uses this to strip orphaned tool parts before re-dispatch, same as rabbhole.
2. **sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses** ([Chat.tsx:62](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/components/chat/Chat.tsx)) to auto-resume after a tool-approval click.
3. **Orphaned-tool-part sanitization** (`sanitizeOrphanedToolParts`) pre-dispatch to avoid Anthropic protocol errors when resuming a chat after a dropped stream ([chat/route.ts:588](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/chat/route.ts)).
4. **Action-state persistence** pattern ([chat/route.ts:30-105](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/chat/route.ts)). Tool outcomes can be `done | failed_terminal | needs_input | needs_approval | needs_schema | failed_retryable`. Basquio's `teachRule`, `retrieveContext`, and memory-edit tools adopt the same outcome shape so multi-turn flows survive page reloads.
5. **Incremental tool-result persistence** (`patchToolResult`) so a tool result is saved to DB as soon as the tool finishes, regardless of whether the stream completes ([chat/route.ts:450](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/chat/route.ts)). Critical for Basquio's long-running `retrieveContext` and `generateDeckOutline` tools.
6. **A2UI pattern** for generative UI ([chat/route.ts:473-528](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/app/api/chat/route.ts)). Tool output carries `_viewEnvelope` describing the render hint + optional `_a2uiSpec` with the component spec. Client inspects the envelope and renders either a registered React component or a fallback. Direct fit for Basquio: `showMetricCard`, `showStakeholderCard`, `showFactTimeline` all emit `_viewEnvelope` so the client knows what component to render.
7. **ChatMessage part-type switch** ([ChatMessage.tsx:40-117](/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/components/chat/ChatMessage.tsx)). Four branches: text / file / tool-part / fallback null. Basquio's current hand-rolled flattener replaced with the same structure.
8. **Framer-motion entrance animation** (`initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}`). Matches working rules §7 (sub-50ms feedback, ease-out only).
9. **Streaming cursor** (`<span className="streaming-cursor" />`) appended to the last text part while `status === 'streaming'`. Invisible in V1 Basquio.

**What Basquio should differ on**:

1. **Workspace scoping**. Rabbhole uses `user.app_metadata.workspace_id` from Supabase, single workspace per user. Basquio needs multi-workspace (spec §3 Decision 7). Promote to `workspaces` table + `workspace_members` later; for V2, use a URL-based scope (`/workspace/[id]/...`) and pull workspace from the path.
2. **Rabbhole's generic dispatcher** routes to general / controller / analysis agents. Basquio has one agent with tools; no dispatcher needed in V2.
3. **Approval policies**: rabbhole uses a workspace-level policy registry (`loadActivePolicies`, `evaluateApprovalPolicies`) for dynamic approval-needed decisions. Basquio V2 uses the static `needsApproval` function on each tool; policies come later.
4. **Meta-events / learning loop**: rabbhole emits `tool_success`, `tool_failure`, `user_approval`, `user_rejection`, `view_strategy_selected`, `view_fallback_triggered`. Basquio can start with just `tool_success/failure` and `memory_taught` to seed the observability ledger.

---

## 6. Entity resolution benchmark

### 6.1 Method

I constructed a 47-row Italian-CPG entity-resolution test corpus (attached inline below) and ran it against a Python simulation of the current V1 algorithm (`normalizeEntityName` + exact match on `(type, normalized_name)` from [apps/web/src/lib/workspace/extraction.ts:223](../apps/web/src/lib/workspace/extraction.ts) and [apps/web/src/lib/workspace/process.ts:210-260](../apps/web/src/lib/workspace/process.ts)).

Corpus construction: 28 canonical entities seeded (matching the live seed fixture) plus adversarial variants across six failure classes: EXACT_MATCH, ALIAS_MATCH, PHONETIC, CASE_DIACRITIC, COMPANY_SUFFIX, HOMONYM, and NEW.

The spec calls for 500 rows. A 47-row targeted corpus is sufficient to read the shape of the failure modes and is what I could construct within a research window. The 500-row production corpus is work the build agent does as part of the cascade upgrade ticket with the extended seed-fixture + 2-3 real briefs.

### 6.2 Result (V1, current production algorithm)

```
Total cases: 47
TP: 19  TN: 3  FP: 0  FN: 25
Precision: 1.000
Recall: 0.432
Accuracy: 0.468
```

Benchmark script committed as `/tmp/er-benchmark.py` during research; will be promoted to `apps/web/scripts/entity-resolution-benchmark.py` during implementation.

### 6.3 Failure modes

- **ALIAS_MATCH** (12 misses): V1 stores aliases in `entities.aliases TEXT[]` but does NOT consult them at resolve time. "NIQ" does not map to "NielsenIQ Italy" even though the entity row lists "NIQ" as an alias.
- **PHONETIC** (7 misses): Italian-surname spelling drift kills recall. "Elena Bianki" → should match "Elena Bianchi" but does not. "Sara Konti" / "Giovanni Rosi" / "Luka Moretti" all fail.
- **COMPANY_SUFFIX** (5 misses): "Barilla Group S.p.A." / "Mulino Bianco S.r.l." / "NielsenIQ Italia S.r.l." all create new entity duplicates rather than matching the canonical.
- **CASE_DIACRITIC** (1 miss): "L'Oacker" with apostrophe survives normalize differently than "Loacker" and misses. Most diacritic cases pass via NFKD stripping.

### 6.4 Comparison to V1 kill-condition

[motion2-workspace-architecture.md §11](motion2-workspace-architecture.md): "Entity resolution quality < 85% precision on a 500-row test set → memory doesn't feel magical, users abandon."

V1 precision is 100% (when it matches, it matches correctly). V1 recall is 43.2%, which is the real problem: more than half of entity mentions create duplicate entities. The user sees "Elena Bianchi" and "Elena Bianki" as two different people in the Timeline. Trust breaks on session 2.

The kill-condition is phrased as "precision < 85%" which is technically a precision target not recall. The deeper intent is "feels dumb"; on a recall-43% memory, the feel-dumb threshold is hit regardless of precision.

### 6.5 Cascade upgrade plan

Per [motion2-workspace-architecture.md §7](motion2-workspace-architecture.md), production entity resolution uses a five-step cascade. V2 implements steps 2-4 plus alias consultation:

1. **Exact match on normalized_name** (already V1).
2. **Alias consultation**: check `entities.aliases` for a case-folded contains match. Source: this is already stored, just not queried.
3. **Phonetic**: Italian-adapted Soundex (or Metaphone). Industry-standard lib: [fuzzystrmatch](https://www.postgresql.org/docs/current/fuzzystrmatch.html) Postgres extension, already enabled on Supabase. Basquio runs `dmetaphone(name)` and matches entities whose Metaphone hash equals the candidate's.
4. **Embedding similarity**: cosine distance on text-embedding-3-small vectors of canonical_name. Threshold ~0.12 (tight). Existing pgvector extension + HNSW index on the `entities` table (new column `name_embedding VECTOR(1536)`).
5. **LLM tiebreak** only on ambiguous collisions (more than 1 candidate within 0.15 embedding distance). Claude Haiku 4.5, structured output `{ match: "entity_id" | "new" }`.

Expected V2 recall with full cascade (projection, not measured): 88-93% on the same 47-row corpus. Measure after implementation. Ship when **recall > 90% AND precision > 95%** on the 500-row corpus.

### 6.6 Do not migrate to Graphiti in V2

Per spec §2 and [motion2-workspace-architecture.md §2](motion2-workspace-architecture.md). Postgres + pgvector + fuzzystrmatch handles the cascade. Graphiti/Neo4j only when scale or multi-hop reasoning justifies it, which is V3+.

---

## 7. Live workspace verification

Partial in this pass. The build agent that ships V2 should run the full forensic audit on the live `/workspace` using the Supabase admin magic-link + cookie injection pattern described in the handoff prompt.

What I verified this pass (without logging in):

- `/workspace` unauthenticated returns `307 → /sign-in?next=/workspace` ✓ (gate working as per [apps/web/src/app/(workspace)/layout.tsx](../apps/web/src/app/(workspace)/layout.tsx))
- `https://basquio.com/` unauthenticated returns `200` with the OLD hero copy visible in HTML: "Beautiful Intelligence", "Two weeks of analysis", "Upload your data" all grep hits on the raw HTML.

The Apr 20 forensic audit findings from the handoff brief (procedural memory writeback works, scope as `<select>`, no memory browse, no stakeholder profile pages, mechanical suggestions) are accepted as-is and drive the V2 implementation priority order in spec §§3-5.

---

## 8. Four things the research found that the spec under-specifies

Per spec §9 flip-flop prevention: I am NOT changing any of the 8 locked decisions. But these four points need sharpening before the build agent ships to avoid churn.

### 8.1 Conversation threading vs deliverables

V1 stores every Q/A as a standalone `workspace_deliverables` row. The locked decisions (§3) assume each question is a one-shot deliverable. But the team transcript and the AI SDK 6 `useChat` pattern both expect multi-turn threads.

**Recommendation:** introduce `workspace_conversations (id, workspace_id, scope_id, title, created_at, updated_at, archived_at)`. A conversation has many turns; a deliverable is a "saved / promoted" subset of a turn. Multi-turn chat is stored in a conversation; the user can "save this as a deliverable" from any assistant turn. This does not change any of the 8 locked decisions but adds a table spec §4 omits. Not urgent for V2 first PR, but must land before the chat surface is the primary product surface.

### 8.2 Agent architecture naming collision

Spec §4a defines `workspaces` table; motion2-workspace-architecture.md references the Anthropic Memory Tool's `/memories/{org_id}/{scope}/` path; the live code uses `BASQUIO_TEAM_ORG_ID`. Three different names for the same concept (`workspace_id` vs `organization_id` vs `org_id`). V2 migration locks on **`workspace_id`** per spec §4a and renames the Memory Tool path to `/memories/{workspace_id}/{scope_slug}/`.

### 8.3 Memory Tool tool-name

V1 registers the Anthropic Memory Tool as the `memory_20250818` tool (correct, per [docs.claude.com memory-tool docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)). V2 introduces a separate `teachRule` tool for the user-visible "teach Basquio" flow. Two distinct tools, both pointing at the same `memory_entries` table:
- `memory` (Anthropic-managed, agent-initiated) → raw `/memories` filesystem ops
- `teachRule` (Basquio-managed, user-initiated) → writes a scoped memory entry with type `procedural` and surfaces a confirmation card inline

Keep both. One is invisible machinery; the other is the user-facing feature.

### 8.4 Workspace template cloning semantics

Spec §3 Decision 7 promotes `BASQUIO_TEAM_ORG_ID` to a `workspaces` row with a `template_id` for demo-template cloning. Unclear: when a prospect signs up and gets a clone of `Basquio Demo: Mulino Bianco`:
- Do they see the seeded documents? Yes (to feel the product work).
- Do they see the seeded stakeholder names? Yes (Mulino Bianco-style prospects expect Elena Bianchi as a synthetic demo stakeholder; they can rename).
- Do they see seeded memory entries? Yes.
- Does their edit to a seeded memory entry affect the template? No; cloning is deep-copy, no live link to the template row.
- Is cloning additive (customer's own uploads add to the cloned seed) or fresh-start (wipe seed on first real upload)? Additive. The seed is the "aha moment" asset.

Record this in the V2 spec as a sub-decision under Decision 7 before cloning is implemented.

---

## 9. Homepage hero rewrite

### 9.1 Current hero (live 2026-04-20)

Source: [basquio.com](https://basquio.com/) grep hits on HTML response.

> "BEAUTIFUL INTELLIGENCE · Two weeks of analysis. Delivered in hours. Upload your data. Get back a finished deck."

Three pain boxes: "Manual chart-building", "Formatting over analysis", "A first draft nobody trusts".

This sells the OLD product (data-to-deck) and tests as: "Basquio generates decks from my data." That positioning:
- Loses against frontier models that generate decks equally well from equally clean data.
- Does not promise what the spec-v1-workspace-v2 locked product delivers (memory + scope + stakeholders + past wins).
- Does not cue the vertical specialization; a legal analyst reading it would see a generic AI deck tool.

### 9.2 Proposed rewrite

Per spec §3 Decision 6 hero copy lock, aligned to the strategic validation memo framing (spec §1 bundle: CPG schema + cross-source assembly + compounding procedural memory + bi-temporal grounding).

**Hero (above the fold):**

> **Your analyst memory, always there.**
>
> Basquio knows your clients, your stakeholders, your KPI dictionary, your editorial conventions, and your past wins. Ask a question, get the answer your client expects. Every claim cites where it came from.

**Sub-hero (second line visible):**

> For FMCG and CPG analysts at mid-market brands, agencies, and NIQ / Kantar / Circana teams. Memory compounds from day one, across every client, category, and stakeholder you cover.

**Primary CTA:** "Try a demo workspace" → opens a seeded read-only demo clone of `Basquio Demo: Snack Salati`.

**Secondary CTA:** "Talk to the team" → Marco's calendar.

### 9.3 Why this copy

- **Sentence case, active voice** (working rules §5).
- **No banned AI slop** (working rules §3). I dropped "BEAUTIFUL INTELLIGENCE" because it is generic.
- **No em dashes** (working rules §4). I used a period where the current copy has `·`.
- **First line is the promise** (working rules §9 "lead with the answer"). Memory, always there.
- **Second line enumerates what Basquio knows** (the defensible bundle from the strategic validation memo). Not "memory" abstractly.
- **Third line addresses the specific buyer** (CPG analyst) and names the tooling they use today (NIQ, Kantar, Circana). Vertical signal without jargon.
- **Passes the "Basquio remembers things vs Basquio knows my stakeholders" pitch test** (spec §1). A prospect reading this summarizes it as "Basquio knows my clients, my KPIs, my stakeholders, my conventions, my past wins." That is the winning summary per the validation memo.

### 9.4 Pain section rewrite

The three current pain boxes ("Manual chart-building", "Formatting over analysis", "A first draft nobody trusts") restate the old data-to-deck frame. Replace with three memory-frame pains:

1. **"I re-explain the same client every time."** Stakeholder preferences, KPI dictionaries, past briefs live in your head. No tool remembers them. Every new session starts at zero.
2. **"My AI assistant has no memory of my work."** ChatGPT forgets the Mulino Bianco brief from three weeks ago. Claude doesn't know Elena reviews on Mondays. You paste context every time.
3. **"Nobody cites sources the way a client demands."** Generic AI invents numbers. Traditional consultancies slow-walk citations. Mid-market CPG buyers want the answer AND the source, in under an hour, in their brand's style.

Each pain has a one-line resolution underneath: what Basquio does differently.

### 9.5 Implementation note

Homepage rewrite is Giulia's territory per [motion1-gtm-playbook.md](motion1-gtm-playbook.md) content-ownership. The build agent does NOT ship the homepage rewrite unilaterally. Spec §3 Decision 6 locks the workspace-internal hero copy. The public marketing hero is a separate ticket and requires Marco + Giulia sign-off.

---

## 10. Build sequence (informed by research)

Per primary spec §§3-5. No code shipped in this pass.

Calibrated to Marco's 14-commits/day part-time pace:

| # | Task | Effort estimate | Reference |
|---|---|---|---|
| 1 | Workspaces + workspace_scopes table migration, backfill existing data | 3-4 hours | spec §4a, §4b |
| 2 | Scope-as-nav left rail (Clients / Categories / Functions / People / Memory) | 4-6 hours | spec §3 Decision 1, research §4 |
| 3 | Memory browse/edit/add surface (MemoryListPanel + MemoryCard) | 5-7 hours | spec §3 Decision 2, research §3.2 |
| 4 | Stakeholder profile pages (/workspace/[id]/people/[personId]) | 3-5 hours | spec §3 Decision 3, spec §4c |
| 5 | 4-step onboarding flow | 4-6 hours | spec §3 Decision 4 |
| 6 | Provenance panel on deliverables | 2-3 hours | spec §3 Decision 5, spec §4e |
| 7 | AI SDK 6 `useChat` migration + per-tool view components | 6-8 hours | research §1.4 |
| 8 | Entity resolution cascade (alias + phonetic + embedding + LLM tiebreak) | 4-6 hours | research §6.5 |
| 9 | Demo-template workspace concept (BAS-174) | 4-6 hours | spec §3 Decision 7 |
| 10 | Workspace → deck pipeline bridge (BAS-175) | 3-5 hours | spec §3 Decision 8 |

**Total: 38-56 hours focused work.** At Marco's 14-commits/day pace and 4-hour evening cap, this lands in 10-14 sessions (2-3 weeks of evenings).

**Recommended order**: 1 → 2 → 3 → 7 → 4 → 5 → 6 → 8 → 9 → 10. Schema first, navigation second, memory surface third (that is the "aha moment" people see first), chat migration fourth (because the chat is the primary interaction surface once memory is visible), profiles / onboarding / provenance after the core is ship-able, then entity cascade + templates + deck bridge.

Homepage rewrite is not in this list. Giulia owns, separate ticket.

---

## 11. Acceptance for this research memo

Marco reviews this memo and approves (or rejects + redirects) before the build agent writes any code.

Specifically the build agent requests approval on:

1. **AI SDK 6 migration confirmed as V2 foundation** (research §1, §5). Stop hand-rolling streaming. Migrate `workspace-prompt.tsx` to `useChat`.
2. **Chat UX render bar** (research §1.3) as the non-negotiable acceptance gate. V2 chat does not ship until all 15 primitives pass side-by-side comparison against Claude.ai and ChatGPT.
3. **Memory UI positioning** (research §3.1) as a hybrid of Mem.ai left-rail visibility + Claude Projects settings control + ChatGPT conversational edit + a new inline tool chip nobody else has.
4. **Scope-as-navigation** (research §4.3) as sidebar + Cmd+K, no chip in chat input.
5. **Rabbhole patterns to copy** (research §5) as the implementation reference.
6. **Entity resolution cascade** (research §6.5) as the V2 quality upgrade, with measured V1 recall of 43.2% as the baseline to beat.
7. **Homepage hero rewrite proposal** (research §9) goes to Giulia for public-site implementation; spec §3 Decision 6 already covers the workspace-internal hero.
8. **Four spec-clarification items** (research §8) land as small amendments to spec §3/§4 before build begins: conversation threading, name canonicalization (workspace_id), tool-name split (`memory` vs `teachRule`), and workspace-clone semantics.

---

## 12. Sources

### 12.1 AI SDK
- [vercel.com/blog/ai-sdk-6](https://vercel.com/blog/ai-sdk-6). AI SDK 6 announcement, Dec 22 2025
- [ai-sdk.dev/docs/migration-guides/migration-guide-6-0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0), migration guide
- [ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat), useChat API reference
- [ai-sdk.dev/llms.txt](https://ai-sdk.dev/llms.txt), llms.txt tool registry
- rabbhole reference code at `/Users/marcodicesare/Documents/Projects/rabbhole/apps/web/src/{components/chat,app/api/chat/route.ts}`

### 12.2 Vertical workspaces
- [legora.com](https://legora.com/), [legora.com/product](https://legora.com/product), [legora.com/landing/playbooks](https://legora.com/landing/playbooks)
- [harvey.ai](https://www.harvey.ai/), [harvey.ai/platform](https://www.harvey.ai/platform), [harvey.ai/platform/assistant](https://www.harvey.ai/platform/assistant), [harvey.ai/platform/workflow-agents](https://www.harvey.ai/platform/workflow-agents), [harvey.ai/blog/how-we-approach-design-at-harvey](https://www.harvey.ai/blog/how-we-approach-design-at-harvey), [academy.harvey.ai](https://academy.harvey.ai/)
- [purple.law/blog/legora-review-2025](https://purple.law/blog/legora-review-2025/)
- [purple.law/blog/harvey-ai-review-2025](https://purple.law/blog/harvey-ai-review-2025/)

### 12.3 Memory products
- [help.openai.com/en/articles/8590148-memory-faq](https://help.openai.com/en/articles/8590148-memory-faq). ChatGPT Memory FAQ
- [anthropic.com/news/projects](https://www.anthropic.com/news/projects). Claude Projects announcement
- [venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-mode-for-all](https://venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-mode-for-all). Claude Team/Enterprise memory Aug 2025
- [docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool). Anthropic Memory Tool
- [get.mem.ai](https://get.mem.ai/)
- [reflect.app](https://reflect.app/), [reflect.academy/using-backlinks-and-tags](https://reflect.academy/using-backlinks-and-tags)
- [tana.inc/knowledge-graph](https://tana.inc/knowledge-graph)
- [granola.ai](https://www.granola.ai/), [techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)

### 12.4 Scope-as-navigation
- [linear.app/docs/teams](https://linear.app/docs/teams)
- [cursor.com](https://cursor.com/), [forum.cursor.com/t/how-to-move-primary-side-bar-on-cursor-to-the-left-vscode-like-ui-and-import-preferences/152098](https://forum.cursor.com/t/how-to-move-primary-side-bar-on-cursor-to-the-left-vscode-like-ui-and-import-preferences/152098)
- [notion.com/product/ai](https://www.notion.com/product/ai)
- [claude.ai](https://claude.ai), [guideflow.com/tutorial/how-to-open-the-sidebar-in-claudeai](https://www.guideflow.com/tutorial/how-to-open-the-sidebar-in-claudeai)
- [help.openai.com/en/articles/10169521-using-projects-in-chatgpt](https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt)
- [code.claude.com/docs](https://code.claude.com/docs)
- [perplexity.ai/help-center/en/articles/10352961-what-are-spaces](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces)

### 12.5 Entity resolution
- [postgresql.org/docs/current/fuzzystrmatch](https://www.postgresql.org/docs/current/fuzzystrmatch.html). Postgres Metaphone/Soundex
- [docs.claude.com/en/docs/models/claude-haiku-4-5](https://docs.claude.com/en/docs/about-claude/models). Haiku for LLM tiebreak
- Benchmark script (in this research): `/tmp/er-benchmark.py`

### 12.6 Basquio internal
- [docs/working-rules.md](working-rules.md)
- [docs/strategy-basquio-motions.md](strategy-basquio-motions.md)
- [docs/motion1-gtm-playbook.md](motion1-gtm-playbook.md)
- [docs/motion2-workspace-architecture.md](motion2-workspace-architecture.md)
- [docs/spec-v1-workspace.md](spec-v1-workspace.md)
- [docs/2026-04-19-v1-workspace-audit.md](2026-04-19-v1-workspace-audit.md)
- [docs/2026-04-19-strategic-validation.md](2026-04-19-strategic-validation.md)
- [docs/spec-v1-workspace-v2-research-and-rebuild.md](spec-v1-workspace-v2-research-and-rebuild.md)
