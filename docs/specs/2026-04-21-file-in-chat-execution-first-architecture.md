# File-in-chat: execution-first architecture

**Date:** 2026-04-21
**Trigger:** Canary on a 6.6 MB CSV dropped in a workspace chat hung for 5 minutes; Vercel killed the serverless function mid-chunk-insert at `maxDuration=120s`, leaving the document stuck in `status=processing` with 1400 of ~5000 chunks written. Raising `maxDuration` to 800s is a band-aid. The real fix is an architecture change.
**Status:** Proposal, not started. Supersedes the chunk-insert batching fix (`ed18f56`) only for the file-in-chat path; the deck pipeline is unchanged.

---

## 1. The architectural mistake we made

We treated "a file dropped in chat" like "a document added to a knowledge base". Those are different jobs.

- **Knowledge base**: many files, cross-file retrieval, long-term memory → vector DB with hybrid retrieval is the right tool.
- **Chat attachment**: one file, questions about that file, answer in seconds → pandas / code execution is the right tool.

By forcing the chat-attachment path through chunk → embed → insert → retrieve, we pay 6-8 minutes of latency for a question that pandas answers in 5 seconds. Worse: for a CSV, the embedding loses the structure that pandas preserves. `groupby('region').agg(...)` is a real answer; cosine similarity over 5000 row-fragments is an approximation of whatever the embedding model decided the rows "meant".

## 2. What every other shipped product is doing (April 2026)

- **Claude.ai analysis tool**: files dropped in chat are read via sandboxed pandas (code execution). No embedding. First answer in seconds. Official docs confirm the container has pandas/numpy/openpyxl/pypdf pre-installed; 5 GiB RAM; 5 GiB disk. [[Anthropic code execution tool docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/code-execution-tool)]
- **ChatGPT Desktop** on a CSV: same pattern — code-execution-backed for single-file Q&A, no visible indexing step. [[OpenAI projects docs](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)]
- **Cursor** on an un-indexed repo: publishes median 525ms time-to-first-query via Merkle-tree index sharing + ability to query the in-flight index. The UX invariant is "never block the first query on ingestion completion". [[Cursor engineering](https://cursor.com/blog/secure-codebase-indexing)]
- **Claude Projects**: hybrid — loads everything into 200K context below the RAG threshold; flips to `project_knowledge_search` above it. Threshold undocumented. [[Anthropic RAG for Projects](https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects)]

Every production-grade answer to "drop a file, ask a question" is execution-first, not retrieval-first. We're the outlier.

## 3. The architecture we should ship

Three layers. Each answers a different question.

### Layer A — Immediate chat (execution-first)

Path on file drop:

1. Client streams bytes direct to Supabase Storage (existing prepare → PUT → confirm flow). Takes seconds.
2. `/api/workspace/uploads/confirm` does two new things:
   - Uploads the same bytes to **Anthropic Files API** via the Node SDK. Stores the returned `file_id` on `knowledge_documents.anthropic_file_id` (new nullable column).
   - Writes the `conversation_attachments` row (already landed).
3. Returns `200` within ~2s. User can type a question.

Path on the first chat turn after upload:

4. `/api/workspace/chat` detects the conversation has unindexed attachments with an `anthropic_file_id`.
5. Sends a Sonnet call with:
   - `tools: [{type: "code_execution_20250825", name: "code_execution"}, {type: "web_fetch_20260209", ...}]` — the web_fetch entry makes code execution **free** per Anthropic's pricing doc.
   - `messages: [{role:"user", content:[ {type:"text", text:"User: …"}, {type:"container_upload", file_id}, ... ]}]` — container_upload costs **0 input tokens**.
   - System instruction: "use pandas / openpyxl to read the attached files. Answer with exact numbers. Cite by filename + the operation you ran (e.g., `df.groupby('region')['sales'].sum()`)."
6. Container cold-start ≈ 2-6s (no published number, consistent third-party reports). Answer streams back.

**Latency: drop → answer ≈ 5-10 seconds** for a 6.6 MB CSV, end to end.

No chunking, no embedding, no pgvector involved in the first-answer path.

### Layer B — Background enrichment (Railway worker, no timeout)

After a successful upload and independently of the chat, enqueue a `file_ingest_run` row. A new loop in the existing Railway worker (`scripts/worker.ts`) polls this queue, exactly like the deck-run loop it already runs:

```
while (running) {
  claim next file_ingest_run where status='queued'
  download from storage
  parse + chunk
  embed via OpenAI text-embedding-3-small
  insert into knowledge_chunks in batches (already batched in process.ts)
  extract entities + facts via Claude Haiku
  mark status='indexed'
  heartbeat on updated_at
  on SIGTERM: drain + release claim
}
```

Railway has no timeout. A 30-minute embed run isn't a problem. Background worker is invisible to the user; it enables Layer C later.

Move the current `processWorkspaceDocument` out of `after()` entirely. The Vercel serverless budget disappears as a constraint because the Vercel function no longer owns this workload.

### Layer C — Cross-file retrieval (pgvector, unchanged)

When a chat question needs to span multiple documents or pull from workspace memory that isn't attached to this conversation, the existing `workspace_chat_retrieval` RPC handles it. Still the right tool for "last month we saw X in Lavazza data, does it repeat for Pet?" queries.

The agent decides at runtime: current-conversation single-file question → Layer A; broader question → Layer C. Both are already tools Claude can call.

### Promotion rule (when does a file go from A to C?)

A file enters Layer C the moment the Railway worker finishes its `file_ingest_run`. The chat seamlessly starts retrieving from it. No user action. From the user's POV: "file dropped, answerable now, also durable in memory within a minute."

## 4. Data model changes

Additive. No breaking changes.

```sql
-- Layer A bridge to Anthropic Files API
ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS anthropic_file_id TEXT;

-- Layer B queue table
CREATE TABLE IF NOT EXISTS public.file_ingest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','indexing','indexed','failed')),
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  error_message TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id)
);

CREATE INDEX idx_file_ingest_runs_status ON public.file_ingest_runs (status, created_at)
  WHERE status IN ('queued','claimed','indexing');
```

## 5. What stays the same

- `conversation_attachments` table — already landed (commit `ed18f56`).
- `workspace_chat_retrieval` RPC — still serves Layer C.
- `build-context-pack.ts` deck handoff — attachments already fold in unconditionally.
- Inline excerpt path on upload — kept as a fallback when Layer A can't run (e.g., no Anthropic API quota). Still writes `knowledge_documents.inline_excerpt`.
- Deck pipeline — untouched. Already uses container_upload for its own work.

## 6. What's removed from the hot path

- Synchronous chunking in `processWorkspaceDocument`.
- Synchronous embedding calls to OpenAI.
- Synchronous chunk inserts.
- The `after()` hook in `/api/workspace/uploads/confirm` that runs `processWorkspaceDocument`.

All of these move to Layer B on Railway, where wall-clock time doesn't matter.

## 7. Cost

Rough April 2026 numbers:

- Layer A per question: 1 Sonnet call, ~$0.03-0.10 depending on CSV size and response length. Code execution compute is **free** when `web_fetch_20260209` is in tools (confirmed in Anthropic's pricing page).
- Layer B per file: embedding cost identical to today (~$0.05 for a 6 MB CSV on `text-embedding-3-small`). Worker compute is a tiny fraction of a Railway instance's existing cost.
- Layer C per retrieval: one pgvector + BM25 query. Cents per thousand queries on Supabase's existing DB.

Net: Layer A is *new* spend of $0.03-0.10/question. In exchange, we recover 6-8 minutes of human time per upload. Obviously worth it.

## 8. What this does NOT solve

- **Layer C quality**: pgvector retrieval on ~5000 chunks is still limited by embedding model quality. Contextual Retrieval (already implemented behind a flag) helps. Haiku reranker (also implemented) helps more. Moving to `voyage-3-large` would help again at ~9× cost. None of that is a file-in-chat problem.
- **Very large files > 5 GiB**: container disk ceiling. If someone drops a 10 GB file, Layer A can't hold it. Fall back to Layer C retrieval only; the inline excerpt is the first-turn answer.
- **Images / audio / video without text**: pandas doesn't help. Separate spec.

## 9. Rollout plan

Three PRs, each independently shippable and canary-able.

### PR 1 — Data model + Files API upload
- Add `anthropic_file_id` column.
- Extend `/api/workspace/uploads/confirm` to POST the buffer to Anthropic Files API (in parallel with Supabase Storage upload) and store the `file_id`.
- No behavior change yet; chat still uses pgvector path.
- Canary: drop a file, confirm `knowledge_documents.anthropic_file_id` is populated and Anthropic reports the file via `files.list()`.

### PR 2 — Layer A agent tool
- Add an `analyzeAttachedFile` tool to the workspace agent. Input: `{question, document_ids}`. Implementation: POST to Sonnet with code execution + container_upload for each file_id, returns the answer.
- Update the chat system prompt: "when the user asks a question and a file is attached to this conversation, prefer `analyzeAttachedFile` over `retrieveContext`."
- Canary: drop the Pet CSV, ask "quanti SKU per region", confirm the answer cites `df.groupby('region')` output and is correct within seconds.

### PR 3 — Move chunk ingestion to Railway
- Add `file_ingest_runs` table + migration.
- New loop in `scripts/worker.ts` that claims `file_ingest_runs` and calls the existing `processWorkspaceDocument` code path.
- Remove the `after()` call from the confirm route.
- Keep `/api/workspace/documents/[id]/retry` but route it through the queue instead of `after()`.
- Revert `maxDuration=800` back to something sane (120s) on the confirm route.
- Canary: drop a 20 MB file, confirm chat answers via Layer A immediately, and Railway worker reports ingestion complete within 2 min without any Vercel function touching the insert loop.

## 10. Open questions

1. Anthropic Files API retention policy vs Supabase Storage retention — who is the source of truth? Proposal: Supabase Storage is canonical. Anthropic `file_id` is cache; if it expires, re-upload from Supabase on next Layer A call.
2. Rate limits on the Anthropic Files API. Need to pull the published quota and confirm we don't trip it on a burst of uploads.
3. Promotion signal: does the chat need to tell the user "now searchable across workspace" when Layer B finishes, or should it stay silent? Proposal: silent. Chat quality improves automatically.
4. Layer A on dedup hit — the file is already attached to another conversation with a valid `anthropic_file_id`. Reuse or re-upload? Reuse; `file_id` is workspace-scoped in our model.

## 11. Why this is better than the `maxDuration=800` band-aid

- Removes the timeout class of bugs entirely from the file-drop UX.
- Drops drop→answer latency from 6-8 min to 5-10s — that's a 40-100× improvement, not a 2× one.
- For CSVs specifically, pandas gives *correct* answers where retrieval gives *approximate* ones.
- Railway worker pattern is already owned and deployed.
- Every competitor shipped this exact architecture 6-12 months ago. We are catching up to table stakes, not inventing anything.

## 12. References

- [Anthropic: Code execution tool](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/code-execution-tool)
- [Anthropic: Files API](https://platform.claude.com/docs/en/build-with-claude/files)
- [Anthropic: Analysis tool announcement](https://www.anthropic.com/news/analysis-tool)
- [Anthropic cookbook: Data analyst agent with Managed Agents](https://platform.claude.com/cookbook/managed-agents-data-analyst-agent)
- [Cursor: Securely indexing large codebases](https://cursor.com/blog/secure-codebase-indexing)
- [OpenAI: Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)
- [Anthropic: RAG for Projects](https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects)
- [MTEB leaderboard March 2026](https://awesomeagents.ai/leaderboards/embedding-model-leaderboard-mteb-march-2026/)
- [TurboPuffer architecture deep dive](https://567-labs.github.io/systematically-improving-rag/talks/turbopuffer-engine/)
