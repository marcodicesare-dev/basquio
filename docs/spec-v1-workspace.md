# V1 Workspace — build spec

**Status:** ready to hand off to build session
**Scope:** Motion 2 Tier 2a workspace. Built on top of existing multi-tenant foundation. Team-gated per `spec-v1-team-access-mode.md`.
**Goal:** Veronica on Victorinox data and Francesco on his NIQ client data can use Basquio Workspace end to end, decide it saves time, and want to keep using it.

Canonical references the build session must read first:
- `/docs/working-rules.md` (non-negotiable rules)
- `/docs/strategy-basquio-motions.md` (why this exists)
- `/docs/motion2-workspace-architecture.md` (architecture decisions already locked)
- `/docs/design-tokens.md` (visual language)
- `/docs/spec-v1-team-access-mode.md` (how it gets deployed)

---

## What V1 is, in one paragraph

A workspace where a consumer insights analyst uploads the artifacts of their job (brief, prior deck, data export, meeting transcript) and asks questions. Basquio extracts entities, remembers facts with temporal validity, pulls context across everything at generation time, and produces deliverables (decks, memos, charts, direct answers) with every claim linked to source. Memory compounds across sessions. Every output reflects what the analyst learned in prior uploads without re-explaining.

The deck is one output. The workspace is the product.

---

## The three screens

Only three screens in V1. Anything more is scope creep.

### Screen 1: Workspace home

Route: `/workspace`

Layout: golden ratio split. Left column 38% width ("minor"), right column 62% width ("major"). 1 : 1.618.

**Left column** (context panel):
- Workspace name and scope picker at top. Scopes are: `analyst`, `client:<brand>`, `category:<name>`, `workspace`. The picker defaults to the scope inferred from the most recent activity.
- Timeline of what Basquio knows, grouped by entity type: people, brands, categories, retailers, metrics, deliverables. Each entity is clickable, opens a side sheet with all its mentions and facts.
- Empty state: "Upload a brief, a meeting transcript, a prior deck, or a data file. Basquio learns from everything you give it."

**Right column** (main surface):
- "Ask anything" input at top, always focused on page load. Accepts text prompt. Submit produces either a direct answer (chat-style) or a deliverable (deck, memo, chart, workbook) depending on intent.
- Below the input: recent deliverables list, most-recent first, with one-line summary and link to re-open.
- Suggestions panel at the bottom: surfaces open commitments from past sessions. Example: "3 weeks ago your CMO asked for a quarterly incrementality dashboard. You have a review in 8 days. Want a draft?" One primary action button. Dismissible. Never more than 3 suggestions at a time.

### Screen 2: Upload area

Route: `/workspace/upload` (or inline modal on `/workspace`)

Single drop zone. Accepts PDF, PPTX, DOCX, XLSX, CSV, MD, TXT, MP3, MP4, or pasted text. On drop:
1. File uploads to Supabase Storage via existing `uploadKbFile` pattern from the Discord bot
2. Content type detected, parsed with the existing parsers in `apps/bot/src/parsers/`
3. Extraction runs in the background (Claude Haiku): people, brands, categories, retailers, metrics, dates, claims
4. Entities are resolved against existing entities in the workspace (exact match plus normalized-string match; LLM tiebreak on collision)
5. UI shows a live progress timeline: "Parsing", "Extracting entities", "Indexing", "Ready"
6. When ready, a card appears on the Workspace home left column with: filename, entity count, "Basquio now knows: 14 more people, 3 new brands, 47 new facts"

**Copy rules for status messages:** specific, not generic. "Reading your Q3 deck" not "Processing". "Found 12 people including Elena (Head of Category, Victorinox)" not "Extraction complete."

### Screen 3: Deliverable view

Route: `/workspace/deliverable/[id]`

Shows the generated artifact (deck, memo, etc.) with every claim linked to the source it came from. Clicking a citation opens a side sheet with the relevant excerpt from the original document or transcript. The user can edit the deliverable and save edits (edits become procedural memory: "next time, the user prefers this phrasing").

Export options inline: PPTX download, PDF download, copy to clipboard, share link.

---

## User flow (Veronica path, end to end)

1. Marco logs her in at basquio.com. She sees "Workspace (beta)" in the account menu. She clicks it.
2. Landing page: empty state. "Upload a brief, a meeting transcript, a prior deck, or a data file. Basquio learns from everything you give it."
3. She drags 4 files onto the upload zone: Q4 brief PDF, Q3 deck PPTX, NIQ Discover export XLSX, last client meeting transcript TXT.
4. Left column fills with the timeline: 14 people, 8 brands, 5 retailers, 12 KPIs, 3 claims from Q3 deck. Each entity clickable.
5. She types in "Ask anything": "What should my Q1 narrative be?"
6. Submit triggers generation. Visible progress: "Reading Q4 brief. Reading Q3 deck framing. Pulling NIQ Q4 data. Checking meeting notes for client feedback." Under 30 seconds for a memo, under 2 minutes for a deck.
7. Output appears on the right: a 3-act narrative for Q1, every claim with a superscript citation linked to the source. A "Generate deck" button below the memo.
8. She clicks "Generate deck". Existing deck pipeline runs on the memo and source data. Template is Victorinox's (if uploaded) or Basquio default.
9. Deliverable appears in her recent list. She opens it. Scrolls. Edits slide 5. Save.
10. Week 2: she opens the workspace again. Drops a new meeting transcript. Asks "update the narrative with what Elena said." Basquio reads the transcript, identifies the new private-label threat comment, regenerates the relevant narrative section, updates the deck.
11. Week 4: she opens the workspace for a different task. The Suggestions panel shows: "3 weeks ago your CMO Giovanni asked for a quarterly incrementality dashboard. Your next review is in 8 days. Want a draft now using Q4 data?"

That is V1. If Veronica uses the workspace three times in two weeks and does not want to stop, the thesis is validated.

---

## Architecture (already locked, see motion2 doc)

Use Postgres with these tables (add them in the migration alongside team-beta gating):

- `entities` (organization_id, type, canonical_name, aliases, metadata)
- `entity_mentions` (organization_id, entity_id, source_type, source_id, excerpt, mentioned_at, confidence)
- `facts` (organization_id, subject_entity, predicate, object_value, valid_from, valid_to, ingested_at, source_id, superseded_by)
- `memory_entries` (organization_id, scope, memory_type, content, embedding, created_at)

Plus `organization_id` columns added to existing tables: `knowledge_documents`, `knowledge_chunks`, `transcript_chunks`.

Plus `is_team_beta BOOLEAN` on all of the above for data isolation per team-access spec.

Anthropic Memory Tool integrated into the deck generation path with beta header `context-management-2025-06-27`. Memory Tool reads and writes to `/memories/{organization_id}/{scope}/` which is a virtual filesystem backed by `memory_entries`.

Existing `hybrid_search` RPC from the Discord bot gets extended with `organization_id` scoping. No new search infrastructure.

---

## Design rigor (mandatory)

These are non-negotiable. Every screen meets every item.

### Layout
- Golden ratio split: left column 38%, right column 62%. Not 30/70 or 40/60.
- Max content width: 1440px (existing `.site-wrap` token)
- Vertical rhythm: Fibonacci gaps only. 4, 8, 13, 21, 34, 55, 89 px.
- Panel padding: 30px (existing `.panel` token)

### Typography
- Body: Manrope (existing `--font-manrope`)
- Mono: JetBrains Mono (existing `--font-jetbrains-mono`)
- Type scale 1.25 modular: 13, 16, 20, 25, 32, 40, 50, 64 px
- Line height: 1.5 body, 1.3 subheads, 1.15 display
- Max reading width: 66 characters per line
- Headings: sentence case, never Title Case

### Color
- Tokens only from `/docs/design-tokens.md`. Do not introduce new hex values.
- Canvas background: `#f5f1e8` (warm cream)
- Primary action: `#1A6AFF` (ultramarine)
- Highlight: `#F0CC27` (amber) sparingly, never on primary actions
- Text primary: `#0B0C0C` (onyx)
- Borders: `rgba(11,12,12,0.1)` default

### Radius
- Cards: `--radius-lg` (8px)
- Buttons/inputs: `--radius-md` (6px)
- Pills: `--radius-pill` (4px)

### Shadows
- Card elevation: `--shadow-soft`
- Panel elevation: `--shadow-panel`
- Hero/stage: `--shadow-stage`

### Motion
- All transitions: 150-250ms ease-out, not linear
- Never ever ease-in on enter animations
- Page transitions: instant or under 80ms
- Hover states: visible within 1 frame (16ms)

### Interaction
- Every click, type, submit shows visual feedback within 50ms
- Writes apply optimistic UI. The UI changes immediately. Network confirms async. Failure surfaces as a toast, not a page reload.
- Command palette at `Cmd+K` (always)
- Keyboard focus rings visible, accessible, never removed
- All interactive elements have a visible hover state

### Empty states
- Every screen has a designed empty state with: a 1-line headline, a 1-2 sentence description of what to do, one primary action button
- Empty states are never a wall of text explaining the feature. They show the user what to do next.

### Copy
- Every label and message human-crafted per `/docs/working-rules.md` section 5
- Zero AI slop words per working rules section 3
- Zero em dashes per working rules section 4
- Button labels are verbs: "Upload files", "Generate deck", "Save edits", not "Submit" or "OK"
- Error messages tell the user how to fix, not what went wrong internally

### Performance budget
- Page first contentful paint: under 500ms on a warm cache
- Interaction to visual feedback: under 50ms every time
- Any operation over 1 second shows a designed progress indicator (not a spinner)
- Streaming outputs render progressively, first character visible within 500ms of user submit

---

## Build sequencing (calibrated to Marco's pace)

V1 is 5 focused sessions of 3 to 5 hours each. Total 15 to 25 hours. If a session would exceed 5 hours, split it.

### Session A (3 to 5 hours): schema plus route plus upload

- Migration: add `organization_id` to `knowledge_documents`, `knowledge_chunks`, `transcript_chunks`. Create `entities`, `entity_mentions`, `facts`, `memory_entries`. Add `is_team_beta` column to all of them.
- Team-beta gate per `/docs/spec-v1-team-access-mode.md`
- Route `/workspace` with layout and empty state
- Upload zone with drag and drop, wires to existing `uploadKbFile` and parsers

Acceptance: Marco logs in, hits /workspace, drops a PDF, sees it upload and parse. External user logs in, /workspace returns 404.

### Session B (3 to 5 hours): entity extraction and resolution

- Extraction pipeline: invoke Claude Haiku on each uploaded document, extract entities and facts into the new tables
- Entity resolution V1: exact match plus normalized string match, LLM tiebreak on collision
- Left column Timeline view renders from `entities` plus `entity_mentions` scoped by org_id
- Clickable entity opens a side sheet with all mentions and facts

Acceptance: Marco uploads 3 documents, Timeline shows correct entity counts, clicking an entity shows all its sources.

### Session C (3 to 5 hours): memory and generation

- Wire Anthropic Memory Tool into deck generation path with the context-management-2025-06-27 beta header
- Memory Tool reads `/memories/{org_id}/{scope}/` from `memory_entries`
- "Ask anything" input submits to a generate endpoint that pulls entities, facts, memories, and relevant document chunks into context
- Output renders in the right column with citations

Acceptance: Marco asks a question, gets an answer that references uploaded content, every claim has a working citation.

### Session D (3 to 5 hours): deliverables and citations

- Existing deck pipeline wired to workspace context: takes entities, facts, memories, documents as input
- Deliverable view route `/workspace/deliverable/[id]` renders the artifact with citation side sheet
- Edit and save: edits update the deliverable and write a procedural memory entry

Acceptance: Marco generates a deck from a question, opens the deliverable, clicks a citation, sees the source excerpt, edits a slide, saves, new version generated.

### Session E (3 to 5 hours): polish, suggestions, dogfood

- Suggestions panel: background job that scans recent transcripts for open questions and commitments, surfaces 1 to 3 at a time
- Scope picker polish: auto-infer from most recent activity, allow manual override
- Keyboard shortcuts: Cmd K for command palette, Cmd U for upload, Cmd Enter to submit
- Error states, loading states, empty states all designed to spec
- Deploy to production (team-gated)
- Invite Veronica and Francesco

Acceptance: Veronica uses it on real Victorinox data for one category review cycle. Francesco uses it for one Stefania deliverable. Both say they would use it again next week.

---

## Out of scope for V1 (do not build)

These land in V2 or later. Do not expand scope.

- Microsoft Graph, Gmail, Slack, Teams connectors
- Recall.ai meeting bot
- Graphiti bi-temporal KG (Postgres facts table is V1)
- Entity resolution cascade beyond exact plus LLM (no phonetic, no embedding match)
- Per-org custom skills
- Team admin UI (seat management, retention config)
- SSO
- SOC 2 prep
- DPA template library
- MCP server exposure
- Cross-workspace aggregation
- Public share links for deliverables
- Non-team-beta user access

---

## Acceptance, end of V1

One simple test. If Veronica at Victorinox and Francesco on his NIQ client work both:
- Use the workspace at least 3 times in 2 weeks
- Produce at least 1 deliverable they would actually share with a stakeholder
- Say "I would pay for this if I did not already own it"

Then V1 is done and we move to Tier 2a commercial positioning with confidence.

If either of them drops off after 1 session, something in the UX or memory quality is wrong. Diagnose before scaling.

---

## Handoff note for the build session

- Do not invent design tokens. Use `/docs/design-tokens.md`.
- Do not expand scope. If something feels missing, flag it in a `TODO-v2.md` file. Do not build it in V1.
- Do not fabricate timelines. Report actual time spent per session. If a session overruns, say why.
- Every piece of copy you write must pass the working rules test (no slop, no em dashes, human-crafted).
- Every UI state (empty, loading, error, success) is designed to the same bar as the happy path.
- Every database change is reversible. Migrations ship with down steps.
- Deploy to `basquio.com` continuously. No preview branches. Team-beta gate keeps it safe.
