# Dual-lane workspace → chat → deck architecture spec

**Date:** 2026-04-21
**Trigger:** Workspace-native canary failed the user test. A 6.3 MB Pet Food CSV dropped in a workspace chat did not surface in the next message; retrieval leaked old unrelated Snack Salati material. The product feels like two stitched systems (memory platform + deck generator) because the architecture is, in fact, two systems stitched together.
**Authors:** Marco (product) + Claude (forensic + research synthesis)
**Status:** Ready for build. Supersedes no spec (additive to the already-shipped V1 Workspace + runtime contract merge).
**Scope:** Architecture for workspace ↔ chat ↔ deck. Explicitly does NOT change the already-shipped deck runtime contract owned by port-louis.

---

## 1. Forensic diagnosis — what's actually happening today

This is what the code does today, traced file-by-file. No speculation.

### 1.1 Upload path

`POST /api/workspace/uploads` (`apps/web/src/app/api/workspace/uploads/route.ts:23-113`):

- Receives multipart/form-data
- Hashes file (SHA-256), dedupes by content hash
- Writes blob to Supabase Storage bucket `knowledge-base` at `workspace/{yyyy}/{mm}/{dd}/{hash}-{filename}`
- Inserts a row into `knowledge_documents` bound to `workspace_id` (via `organization_id` back-compat), **NOT** to `conversation_id`
- Triggers `processWorkspaceDocument(documentId)` via `after()` — asynchronous, non-blocking
- Returns 200 with `status: "processing"`

**Missing:** there is no `conversation_documents` junction table. The upload has no conversation identity. The document is a workspace artifact from birth.

### 1.2 Ingestion path

`processWorkspaceDocument()` (`apps/web/src/lib/workspace/process.ts:31-146`):

- Downloads blob, parses by filetype
- Chunks text, embeds via OpenAI `text-embedding-3-small` (1536-dim)
- Writes to `knowledge_chunks` bound to `document_id` + `workspace_id` only
- Extracts entities + facts
- Marks document `status="indexed"`

**Missing:** ingestion does not ping the originating conversation. The chat has no signal that "your file is ready" and no signal that "your file is still processing." The user sees the success toast from the upload endpoint and assumes the file is usable. It isn't, for up to several seconds.

### 1.3 Retrieval path

User sends a chat message → `POST /api/workspace/chat` → `streamText()` with `retrieveContextTool` available. The LLM decides to call the tool (or not).

`retrieveContextTool.execute()` → `assembleWorkspaceContext()` (`context.ts:51-186`) → calls `workspace_hybrid_search` RPC (`supabase/migrations/20260419120000_v1_workspace_schema.sql:193-300`).

The RPC is Reciprocal Rank Fusion over two branches:

- **FTS branch:** `websearch_to_tsquery()` on chunk content
- **Semantic branch:** cosine distance on 1536-dim embedding
- Combined: `(1/(rrf_k + fts_rank)) * fts_weight + (1/(rrf_k + sem_rank)) * sem_weight`

Both branches filter only by `WHERE organization_id = workspace_org_id`. **No conversation filter. No recency boost. No freshly-uploaded-file preference.** Top-10 chunks win by pure relevance, and relevance is 100% driven by the semantic similarity of the stored embedding to the current query embedding.

### 1.4 Why Snack Salati beat Pet Food

The canary failure mode:

1. User uploads `Pet_Food_Products.csv`, worker starts indexing
2. User types: "what's our strategy here?"
3. Agent calls `retrieveContext` with "strategy" or a paraphrase
4. RPC searches the whole workspace. Pet chunks are either still processing (not in index yet) or indexed but with generic column headers (`product`, `price`) that have lower cosine match to "strategy" than Snack Salati chunks that have rich narrative embedded context about "snack strategy"
5. Snack Salati wins the RRF ranking. The assistant cites old unrelated material.

**The system is working exactly as designed.** The design is wrong.

### 1.5 Context pack assembly (the pack carried to deck generation)

`buildWorkspaceContextPack()` (`apps/web/src/lib/workspace/build-context-pack.ts:134-249`):

- Reads citations from the triggering chat message
- For each citation with `source_type === "document"`, looks up `knowledge_documents` → adds to `pack.sourceFiles`
- **Only cited documents survive into `pack.sourceFiles`.** A freshly uploaded file that the assistant never cited (because retrieval surfaced Snack Salati instead) is simply absent from the deck pack.

### 1.6 Deck handoff

`POST /api/workspace/generate` canonicalizes the pack against real `source_files` rows, scoped by org + project. Safe from spoofing. But the pack it canonicalizes is already missing the uploaded file, because the chat never cited it.

**Net result:** The deck generator runs on the wrong files. The user has a correct suspicion that "the deck doesn't actually use what I uploaded."

### 1.7 UX after upload (Chat.tsx)

`apps/web/src/components/workspace/Chat.tsx:60-84`:

- 0-50ms: `setUpload({ kind: "uploading", filename })` → "Uploading X…" status line
- ~500ms: POST returns → `setUpload({ kind: "success", filename })` → "Added X. Basquio is indexing it in the background."
- 4s later: status clears

**What's missing:**
- No inline chip in the composer showing "X is attached to this conversation"
- No ingestion-ready signal (chat lets user type but retrieval may return nothing from the file)
- No "ask me about X" prompt
- No explicit model of "this file is in THIS chat" vs "this file is in workspace memory"

The user's correct mental model ("it's here in the chat now") is broken by an implementation that treats every upload as a pure workspace-memory write.

---

## 2. State-of-the-art reference (April 2026)

Only the load-bearing findings. Full citation sheet in appendix.

### 2.1 ChatGPT Projects / Claude Projects — explicit dual-lane, user decides
Two physical attach buttons: project-level (persistent across chats) vs chat-level (ephemeral). The user is forced to choose upfront. **Rejected pattern for Basquio:** analysts don't want to classify uploads; they want to drop a file and have it work.

### 2.2 Harvey Vault — matter-scoped, agent-orchestrated
Everything is matter-scoped; chat is a thin view over the matter. Retrieval is agent-driven: the LLM decides which of (user files | long-term Vault | third-party DB) to query. Tool-selection precision trained from ~0 to 0.8-0.9 via eval data. **Takeaway:** static priority rules eventually lose to an agent that decides dynamically — but only after you've built the eval loop.

### 2.3 Cursor — the direct architectural analog
This is the load-bearing reference. Cursor's documented layered priority stack:

1. Active file + cursor position (auto-included every message)
2. Recently viewed files (auto)
3. Semantic search of the codebase (auto-retrieved)
4. Active errors / recent edits (auto)
5. `@-mentions` — explicit overrides
6. `.cursor/rules/` — always injected

A newly opened file is ALWAYS in context for the next message, with no user action. The codebase index catches the file passively in the background. Cursor is the only product where "current file" vs "workspace" is NOT a user-facing dichotomy. Retrieval itself is two-stage: vector search → LLM reranker.

**Takeaway for Basquio:** the dual-lane problem is solved by making the lane invisible to the user. Every upload goes through BOTH lanes automatically — immediate chat context AND background workspace index.

### 2.4 Anthropic Contextual Retrieval
Pre-generate a 50-100 token context per chunk at index time, then dual-index (embeddings + BM25) + optional reranker. Failure-rate reductions on top-20 recall: 35% (embeddings alone) → 49% (+BM25) → 67% (+reranker). Cost: ~$1.02 per million document tokens, one-time, with prompt caching.

**Takeaway:** Basquio's current pure-RRF (FTS + pgvector) without contextualization or reranking is leaving 40+ percentage points of recall on the table. CPG data has heavy exact-match needs (SKUs, brand names, Nielsen scope IDs) that BM25 + contextualization catch, and embeddings alone miss.

### 2.5 Notion Q&A — recency + popularity as explicit rank signals
Public docs: "Q&A takes the creation date, last edited date, and total number of visits into account." **Takeaway:** a file uploaded 30 seconds ago must dominate retrieval on recency alone, not on semantic match. This is the single most direct fix for the Snack Salati regression.

### 2.6 Anthropic Memory Tool + Graphiti — what gets "promoted" to memory
Memory is not every file. Memory is facts derived from files, versioned bi-temporally (Zep/Graphiti: `t_valid` + `t_ingested`). The file itself lives in storage; the memory layer holds extracted facts, entities, relationships.

**Takeaway:** Basquio already has `facts` + `entities` + `memory_entries` tables. The dual-lane design keeps files as files (chat-scoped or workspace-scoped) and promotes only facts/entities to the long-term memory layer. Users don't upload into memory; they upload into a chat, and memory accumulates as a side effect.

---

## 3. Target architecture — dual-lane, zero user choice

The product is ONE system with two internal lanes. The user never sees the lanes. Every file goes through both.

### 3.1 Principles

1. **Drop, it works.** When a user drops a file in a workspace chat, the file is addressable in that chat within 300 ms. No "processing" wait from the user's perspective.
2. **Memory grows in the background.** The same file enrichens workspace memory (chunks, entities, facts) asynchronously. The user never has to "promote" anything.
3. **Current chat wins on tie.** A file uploaded in THIS chat outranks everything else in retrieval, always.
4. **Scope is a filter, not a lane.** A workspace scope (e.g. "Pet Food client") narrows retrieval. It is not a separate memory silo.
5. **The deck inherits the chat.** When the user clicks Generate deck, the pack includes every file attached to this conversation automatically, not just files the assistant happened to cite.

### 3.2 Two lanes, one upload

```
                     ┌──────────────────────────────────┐
                     │  User drops file in chat composer │
                     └──────────────┬───────────────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
             ▼                      ▼                      ▼
  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
  │ LANE A — CHAT      │  │ LANE B — WORKSPACE │  │ LANE C — FACTS     │
  │ (synchronous)      │  │ (async, within 5s) │  │ (async, within 30s)│
  │                    │  │                    │  │                    │
  │ conversation_      │  │ chunker +          │  │ entity / fact      │
  │ attachments row    │  │ embedder →         │  │ extractor →        │
  │ ready in <300 ms   │  │ knowledge_chunks   │  │ memory_entries,    │
  │                    │  │                    │  │ entities, facts    │
  │ addressable as     │  │ addressable via    │  │ surfaced as rules  │
  │ inline chip        │  │ hybrid retrieval   │  │ / stakeholders /   │
  │ always-in-context  │  │ with recency boost │  │ cited signals      │
  └────────────────────┘  └────────────────────┘  └────────────────────┘
```

### 3.3 Data model changes

Additive. No breaking changes to existing runtime contract.

**New table `conversation_attachments`:**

```sql
CREATE TABLE conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES workspace_conversations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  attached_at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL CHECK (origin IN ('chat-drop','chat-paste','referenced-from-workspace')),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL
);

CREATE INDEX ON conversation_attachments (conversation_id, attached_at DESC);
CREATE INDEX ON conversation_attachments (document_id);
CREATE INDEX ON conversation_attachments (organization_id, project_id);
```

This is the junction that lets the chat prove "this file belongs to this conversation." The document itself remains a workspace citizen (in `knowledge_documents`) — we're adding chat-level identity, not a duplicate store.

**New columns on `knowledge_chunks`:**

```sql
ALTER TABLE knowledge_chunks
  ADD COLUMN contextual_summary text,
  ADD COLUMN indexed_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX ON knowledge_chunks (indexed_at DESC);
CREATE INDEX ON knowledge_chunks (document_id);
```

`contextual_summary` holds the 50-100 token chunk context from Anthropic's Contextual Retrieval pattern. `indexed_at` enables recency boost in retrieval ranking.

**No schema change to the pack.** `WorkspaceContextPack` already has `sourceFiles`. We just start populating it with conversation attachments instead of only-cited sources.

### 3.4 Retrieval priority stack

New RPC: `workspace_chat_retrieval(conversation_id, workspace_org_id, query_text, query_embedding, match_count)` — stacks results in this order:

| Rank | Source | Boost | Rationale |
|---|---|---|---|
| 1 | Current-message attachments (the file being dropped this turn) | +∞ (always in context, not retrieved) | Mirrors Cursor active file |
| 2 | Current-chat attachments (`conversation_attachments` rows for this conversation) | Recency decay (last 24h: 1.0, 24-72h: 0.6, older: 0.3) applied as multiplier on RRF score | Mirrors Cursor recently viewed files |
| 3 | Current-scope workspace memory (chunks where document's scope = chat's scope) | Baseline RRF | Scope isolation |
| 4 | Whole-workspace memory | Baseline RRF × 0.7 | Broader fallback |
| 5 | Facts / entities (from `memory_entries`, `facts`, `entities`) | Separate structured signal, not competing with chunks | Rules / stakeholders / cited signals |

**Retrieval implementation:**

1. Exact-retrieval of chat attachments for ranks 1-2 (always returned; not subject to vector ranking)
2. For ranks 3-4: hybrid retrieval = semantic search (pgvector) + BM25 (Postgres FTS) with Contextual Retrieval's chunk context prepended to the indexed text
3. LLM reranker (Anthropic Haiku) over the top-50 combined candidates → top-10 final

This is the 67%-failure-reduction stack from Anthropic's blog, adapted for Basquio's scope + recency needs.

### 3.5 UX contract — the 50-300ms window

When a file is dropped into the chat composer:

| t | Behavior | Surface |
|---|---|---|
| 0ms | Optimistic chip appears in composer: `Pet_Food_Products.csv · 6.3 MB · uploading…` | Client-side, no network |
| 0-80ms | Chip upgrades to `uploading (42%)` with progress | Client-side from fetch stream |
| ~300ms | Upload completes. Chip: `Pet_Food_Products.csv · attached · indexing for memory` | Server responded, `conversation_attachments` row exists |
| 300ms+ | User can type and send. Their next message automatically includes the file in context via rank-1 retrieval (we already have the row). The `indexing for memory` badge is cosmetic; retrieval already works for this chat. | — |
| ~5s | Ingestion worker finishes chunks + embeddings for Lane B. Chip drops the memory badge. Nothing user-visible changes. | Worker toast optional |
| ~30s | Fact extractor finishes Lane C. Any extracted stakeholders / rules are surfaced in the memory panel. | Memory panel refresh |

**The critical UX invariant:** the user can ask a question about the file the moment the chip turns solid (~300ms). They never see "indexing, please wait." The assistant has the file in context because rank-1 retrieval pulls `conversation_attachments` directly — not via the vector index.

**What the assistant actually reads for rank-1:** the raw file content (or a parsed text extract produced inline during the upload synchronous phase — parse is cheap, embedding is what's slow). For small files (< 1 MB) we inline-parse in the POST. For larger files we parse synchronously to extract a header/summary + schema (row count, columns), which is enough for the first turn; full chunking happens in Lane B.

### 3.6 Deck handoff contract

When the user clicks **Generate deck** in a workspace chat, the pack handoff is:

1. `buildWorkspaceContextPack(viewer, { conversationId, scopeId })` — NOT `{ citations }`-driven anymore
2. Pack's `sourceFiles` = union of:
   - All `conversation_attachments` for this conversation
   - All documents the assistant explicitly cited in the chat (kept for assistant-added workspace-memory references)
3. Pack's `lineage` = current conversation metadata
4. Pack's `rules` = scope + analyst + workspace (unchanged)
5. Pack's `citedSources` = the subset that was explicitly cited (for auditing)
6. Pack's `renderedBriefPrelude` = the synthesized brief from the conversation

The deck drawer pre-fills from this pack. The user confirms and hits Start — runtime contract unchanged from port-louis' work.

**Invariant:** the deck never generates on fewer files than the chat had visible. If the user dropped 3 files, the deck starts with 3 files. Period.

---

## 4. "One product, not two" — the mental model we're selling

Before: the analyst sees a **workspace memory platform** (files pile up in a knowledge base, retrieval is opaque, memory rules accumulate) AND a **deck generator** (form-first drawer, pick files, confirm, launch). The seam between them is where Marco tripped: dropping a file felt like depositing it into a library, not attaching it to a conversation.

After: the analyst sees **one analyst workspace**. Every action is a conversation. Dropping a file attaches it to this conversation immediately, AND enriches workspace memory in the background. Clicking Generate deck hands off everything this conversation has seen. Memory rules + scope + stakeholders are side effects of the conversation, not a separate admin surface.

The architectural proof that it's one product:
- **One entry point** (the chat).
- **One pack** (`WorkspaceContextPack` — already canonical).
- **One retrieval stack** (dual-lane priority; the user never chooses).
- **One handoff contract** (`/api/workspace/generate` — already shipped).

The lanes are internal. The user sees conversations, files attached to conversations, and memory that grows on its own.

---

## 5. Rollout plan — failure-safe, no regressions

Five merges, each independently shippable. Each merge is gated on the prior one succeeding in a production canary.

### Merge 1 — `conversation_attachments` table + rank-1 retrieval
**What ships:**
- `supabase/migrations/2026-04-22-conversation-attachments.sql` (additive)
- `apps/web/src/app/api/workspace/uploads/route.ts` writes a `conversation_attachments` row alongside the existing `knowledge_documents` insert (requires `conversationId` in the POST body)
- `apps/web/src/components/workspace/Chat.tsx` passes `conversationId` on upload
- `apps/web/src/lib/workspace/context.ts` prepends conversation attachments to retrieval results before the vector search
- `apps/web/src/components/workspace/Chat.tsx` renders the solid chip with the indexing sub-label

**What doesn't change:** the RPC, the runtime contract, the deck drawer, the worker.

**Regression risk:** zero to existing paths. The runtime contract sees the same pack shape. Existing docs without `conversation_attachments` rows retrieve identically to today.

**Canary:** Marco uploads a file in a chat, asks about it, assistant cites that file not Snack Salati.

### Merge 2 — inline parse on upload, visible chip from 300ms
**What ships:**
- Synchronous parse during the POST (xlsx/csv: schema + first 200 rows; pdf: first 5 pages; txt: full). Store as `knowledge_documents.inline_excerpt` (new column).
- Rank-1 retrieval reads `inline_excerpt` for freshly-uploaded docs that haven't finished Lane B.
- Chip UX upgrade (file size, indexing badge, hover to preview).

**Canary:** upload a 6MB CSV, ask "what columns are in this" within 2 seconds, get a correct answer from `inline_excerpt`.

### Merge 3 — Contextual Retrieval + recency boost in RPC
**What ships:**
- New RPC `workspace_chat_retrieval` with: conversation-attachment rank, scope filter, recency decay multiplier, Contextual-Retrieval-prepended chunks.
- Backfill job: re-embed all `knowledge_chunks` with `contextual_summary` prepended. Rate-limited Claude-Haiku call per chunk (~$1/M doc tokens).
- New Haiku reranker step: top-50 candidates → top-10.

**Canary:** run the same "strategy" query against a workspace with Pet + Snack data. Pet wins if freshly uploaded; Snack wins if query genuinely matches Snack's contextual summary better.

### Merge 4 — deck handoff uses conversation attachments as source-of-truth
**What ships:**
- `buildWorkspaceContextPack()` signature adds `conversationId`, reads `conversation_attachments` to populate `sourceFiles`. Citation-only path is preserved as fallback.
- `api/workspace/generate/route.ts`: the authoritative pack includes all conversation attachments (not only what the assistant cited).
- Drawer UI: shows all attached files explicitly with a "remove from this deck" affordance.

**Canary:** drop 3 files in a chat, click Generate deck, confirm the drawer shows 3 files, confirm the run used all 3.

### Merge 5 — memory surface (Lane C visibility)
**What ships:**
- Sidebar memory panel shows extracted entities / facts / stakeholders, grouped by scope.
- Memory rules become click-to-edit.
- "Remembered from this conversation" chip next to auto-generated rules.

**Canary:** a conversation that uploads a file about Client X surfaces Client X as a stakeholder candidate within a minute. User confirms to persist.

---

## 6. What this does NOT change

- **The runtime deck pipeline.** `generate-deck.ts`, `worker.ts`, visual QA, PPTX skill — untouched. The pack contract is additive.
- **The canonicalization trust boundary.** Still scoped by org + project via `loadSourceFilesForWorkspaceContext` (commit `80c8c3c`).
- **The `jobs/new` path.** Still exists for uploads from outside a workspace. Not the workspace-native happy path.
- **Existing reruns.** `sourceRunId` still wins; persisted pack is respected.

---

## 7. Measurement — how we know it's one product

A shipped dual-lane is only real if these four numbers move:

1. **Time-to-first-useful-response after upload** (current: unbounded, often 5-30s; target: <2s)
2. **Citation precision@1** (current unknown; target: 90%+ of queries after an upload cite the uploaded file when it's the correct source)
3. **Deck-vs-chat file overlap** (current: unknown; target: 100% of files visible in the chat appear in the deck pack)
4. **"Re-upload required" incidents** (current: high, per canary; target: zero)

We instrument all four on ship of Merge 1 and track across Merges 2-5.

---

## 8. Explicit non-negotiables

- **No user-facing lane switcher.** Nothing analogous to ChatGPT's "project vs chat" toggle. Every upload goes through both lanes.
- **No re-architecture of the runtime pack contract.** Additive only.
- **No "promote to memory" button.** Memory grows passively.
- **No regression to jobs/new form-first UX for workspace users.** The workspace is the happy path.
- **No vector-only retrieval.** BM25 + embeddings + reranker, or we bleed recall on exact-match CPG queries.

---

## 9. Open questions (to resolve before Merge 3)

1. **Contextual Retrieval cost:** Contextualizing every chunk via Haiku costs ~$1/M doc tokens. At current workspace sizes (~100 docs), this is trivial; at 10,000 docs it's meaningful. **Decision:** cap contextualization to docs with ≥5 retrieval hits OR ≥1 citation, lazily.
2. **Reranker model:** Haiku 4.5 vs Voyage rerank-2-lite vs Cohere rerank-v3. **Decision path:** eval on an internal Basquio retrieval eval set (TBD with Alessandro / Rossella), pick the best precision@5.
3. **Recency decay curve:** linear vs exponential. **Default:** exponential with 24h half-life, tune after canary.
4. **`workspace_scope_id` on chunks:** port-louis' runtime has scope on `facts` + `memory_entries` but not on `knowledge_chunks`. **Decision:** add in Merge 3; backfill by inheriting from the document's scope at upload time.

---

## 10. Appendix — research citations

Cursor: layered context stack (docs.cursor.com/en/guides/working-with-context), semantic search blog (cursor.com/blog/semsearch), codebase indexing (docs.cursor.com/context/codebase-indexing).

Anthropic Contextual Retrieval: anthropic.com/news/contextual-retrieval — 67% failure-rate reduction on top-20 recall with embeddings + BM25 + reranker.

Anthropic Memory Tool: platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool — client-side memory files, just-in-time retrieval.

Notion Q&A: notion.com/help/guides/understanding-how-q-and-a-finds-answers — "creation date, last edited date, and total number of visits" as explicit rank signals.

Harvey Vault: harvey.ai/blog/scaling-harveys-document-systems-vault-file-upload-and-management, harvey.ai/blog/how-agentic-search-unlocks-legal-research-intelligence — tool-selection precision from ~0 to 0.8-0.9 via evals.

ChatGPT Projects: help.openai.com/en/articles/10169521-using-projects-in-chatgpt — explicit dual attach buttons, user-decided scope.

Claude Projects: support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects — auto-RAG switch when project knowledge exceeds 200K context.

Graphiti / Zep: arxiv.org/abs/2501.13956 — bi-temporal KG, 94.8% DMR.

MemGPT: arxiv.org/abs/2310.08560 — dual-tier main / external context with LLM-as-memory-manager.
