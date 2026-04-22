# Basquio strategic session handoff — 2026-04-22

**Purpose:** neutral handoff to a new agent. The previous agent (this one, writing this document) repeatedly drifted opinion turn-by-turn and pattern-matched Basquio onto horizontal enterprise SaaS tropes that the co-founders never said. Marco caught this and asked for a clean restart.

This document contains:

1. What the co-founders have actually said across 20+ hours of discussion + Discord chat (in their own words where quotable)
2. Canonical strategy doc references (path-only; don't summarize, read them)
3. Locked-in decisions vs open decisions
4. Anti-patterns the previous agent fell into — do not repeat

Nothing in this document is a recommendation from the previous agent. It is evidence + state.

---

## 1. The AHA moments — what the team has actually said

These are the three aha moments Marco has repeatedly named across discussions and this session (last time, verbatim: *"their aha moment is when they saw what basquo produced as 30 slides deck. it's when they saw the chat memory workspace where they could track rules and context and stakeholders 'rules' and preferences and make that become the context of the brief. their aha is when they see basquio avoid them to reprompt everything chatgpt telling same things and all context every time."*):

1. **Output shock — the 30-slide deck.** When Rossella, Fra, Ale, Giulia, Veronica saw Basquio produce a consulting-grade 30-slide deck from data, the reaction was "fuck, this would have saved me weeks." The manual-deck-polish toil they've lived with for years got compressed. This is the unit of value.

2. **Memory of rules, context, stakeholders, preferences.** The workspace tracks things like "Rossella prefers 52-week reads excluding private label," "Giulia likes source callouts bottom-left," stakeholder-specific tone rules, client KPI dictionaries. The aha is: *Basquio remembers this; I don't have to re-explain it every session.*

3. **Anti-re-prompt.** ChatGPT / Claude make you re-type the full context every conversation. Basquio carries the rules, context, and preferences forward so the user's output is pre-aligned without re-priming. Rossella's quote (paraphrased from Discord, 2026-04-21): "ragioniamo sempre in ottica nielsen, e basquio bot vorrei usarlo per capire come vendere servizi ai clienti" — the assumption being Basquio already knows her NIQ angle.

**What the team has NOT said is the killer feature** (the previous agent fabricated some of these):
- "Team collaboration." Not in the discussions Marco has heard. Not in the strategy docs as a named aha.
- "Brief synthesizer." The previous agent extracted this as the product pitch; the team hasn't framed it that way.
- "Scope dossier as landing surface." This is a UX proposal the previous agent made; the team hasn't validated it yet.
- "Gap analysis as the flagship workflow." Rossella proposed it as ONE workflow she'd use. The team has not said it's THE flagship.

Treat everything the previous agent said as hypothesis that needs the team's confirmation. Treat the three ahas above as grounded.

---

## 2. The motion debate — each person's stated position

| Stakeholder | Stated position (verbatim-ish) | Source |
|---|---|---|
| Rossella | "Basquio bot vorrei usarlo per capire come vendere servizi ai clienti. Gli darei in knowledge i servizi NIQ, poi sulla base dei dati excel gli chiederei qual è il gap che il servizio x mi aiuterebbe a colmare." | Discord 2026-04-21 |
| Rossella | Challenged the idea of the user "living in the chat" — feels chat-first makes Basquio look like another chat wrapper. | Marco paraphrasing on 2026-04-22 |
| Veronica | Amazed by the workspace concept but does not yet know HOW to use it day-to-day. | Marco paraphrasing on 2026-04-22 |
| Ale, Fra, Giulia | Amazed by the concept but don't grok the UI yet; started imagining too many adjacent things. | Marco paraphrasing on 2026-04-22 |
| Marco (on PLG) | "PLG, the current Basquio published product is amazing. It's just difficult to market because of external distribution constraints." "We don't want to trash it to the bin." | 2026-04-22 session |
| Marco (on cost economics) | "Decks cost $5-10 in API calls, so you have to sell it for at least $30-50. An individual, not backed by their company, I'm not sure, is going to spend $40 on making a deck." | 2026-04-22 session |
| Marco (on agency model) | "I need to understand the motion saas legora model, with workspace context, not the agency model for now unless you demonstrate me agency model is better." | 2026-04-22 session |
| Marco (on vertical) | "We've built a hyper-specialized agentic sort of colleague for market research teams." "Find one company that trusts us because we are ex-Nielsen or Nielsen, and we can ship an AI-native product like Mad Men." | 2026-04-22 session |

---

## 3. Documents to read (path-only — don't summarize)

Primary strategy corpus (read these first, cover to cover):

- `docs/strategy-basquio-motions.md` — 3-channel canonical strategy (Crosby / Workspace SaaS / PLG tail)
- `docs/motion1-gtm-playbook.md` — Channel 1 agency tactical playbook
- `docs/motion2-workspace-architecture.md` — Workspace SaaS technical architecture (memory scopes, catalogs, ingestion)
- `docs/2026-04-19-strategic-validation.md` — 5 hypotheses, verdicts, TAM framing
- `docs/spec-v1-workspace-v2-research-and-rebuild.md` — V2 IA spec (scope-first landing)
- `docs/2026-04-21-team-call-reconstructed.md` — reconstruction of the lost 2-hour call
- `CLAUDE.md` — operational rules, including the Railway multi-service deploy lesson
- `rules/canonical-rules.md` — hard-won rules across sessions
- `memory/canonical-memory.md` — product + technical memory index

Related specs (read if relevant):

- `docs/specs/2026-04-21-dual-lane-workspace-chat-deck-architecture-spec.md`
- `docs/specs/2026-04-21-file-in-chat-execution-first-architecture.md`
- `docs/2026-04-20-workspace-v2-research.md`
- `docs/2026-04-18-plan-to-10k-mrr.md`

---

## 4. What is locked vs what is open

### Locked (team has converged, do not re-debate)

- Vertical = CPG/FMCG market research analysts (Italian mid-market first, EU expansion 9-12 months out).
- Memory + domain knowledge + workflows = the moat bundle. Not memory alone.
- The existing basquio.com data-to-deck product stays live. Don't trash. Don't invest primary build.
- Channel 1 agency Crosby is opportunistic, not the primary build. Take one anchor customer if offered.
- V1 workspace UI puts a chat prompt at the top of each scope — the team reads this as "chat wrapper." Rossella named this explicitly.
- No PLG marketing budget. No Twitter network. Warm-intro via NIQ/client networks is the distribution reality.

### Open (team has NOT converged, new agent: propose or ask)

- Is the motion: (a) three channels as the strategy doc says, (b) two motions + an opportunistic agency (the previous agent's framing), or (c) something else entirely? The previous agent flipped on this multiple times.
- Should the data-to-deck product and the workspace be one unified product with tiers (Linear/Notion pattern), or two separate products at different URLs for different ICPs (Harvey/Legora vertical-AI pattern)?
- Who is the FIRST concrete customer (the "one company that trusts us because we are ex-NIQ")? Candidates named: Affinity Petcare (via Rossella / Ale), Rossella's active NIQ accounts, Veronica-at-Victorinox as internal design partner. Not decided.
- What is the FIRST concrete workflow recipe to ship? Candidates: service-gap-analysis (Rossella's), JBP prep (Alce Nero shape), whatever Veronica names as top Victorinox toil. Not decided.
- Do we ship V2 scope-first landing IA THIS WEEK or not? Previous agent has proposed this multiple times; Marco has not green-lit.
- Pricing: Tier 2a €500/mo is locked in the strategy doc but previous agent suggested revisiting to €1-2K/mo under a sharper framing. Team has not decided.

---

## 5. Anti-patterns the previous agent fell into — do not repeat

1. **Pattern-matching Basquio onto horizontal enterprise SaaS tropes.** "Team collaboration is the killer feature," "institutional knowledge sharing compounds," "seat expansion is the growth lever" — these are Notion/Linear/Slack frames. The team has not validated any of them as the Basquio killer. Use Harvey/Legora/Rogo/Hebbia as comps, but DO NOT assume their internal value props (team collaboration, shared workspace) map to Basquio without team validation.

2. **Flipping framings turn-by-turn.** The previous agent said "kill PLG" in one turn, then "PLG is the tail, keep it" in the next, then "2 motions not 3" after Rossella's challenge was quoted, then "no, 2 products 2 motions + agency" when Marco pushed back. Each flip was reflection of the latest speaker's framing, not independent strategic grounding. Never flip without stress-testing against the evidence base (strategy docs + Harvey/Legora/Rogo/Hebbia/TAM research).

3. **Fabricating product features without team validation.** "Brief synthesizer" as the product pitch, "scope-first landing" as the demo, "Mad Men concierge" as the motion — all were previous-agent inventions. Some may be right; none have been validated by the team. Label previous-agent proposals explicitly as hypothesis, not settled truth.

4. **Using jargon without defining.** "Mad Men concierge" was opaque. "Chat-as-verb + scope-as-surface" is internal shorthand. If the team hasn't said the phrase, don't use it as if they had.

5. **Closing with "decisions you need to make" + 3-4 multiple-choice questions every turn.** This pressures premature commitment. The team is 5-6 part-time co-founders; they need time to discuss. Don't force binary green-lights in a single exchange.

6. **Hype disguised as analysis.** When Rossella says X, saying "Rossella is right" without independent fact-check is flattery, not thinking. When Marco says Y, agreeing before stress-testing Y against the strategy docs is hype. Marco explicitly named this and demanded better.

---

## 6. The evidence base the previous agent gathered (reuse, don't redo unless new data)

- Harvey: $195M ARR, $11B valuation, enterprise-only, $1,200/lawyer/mo × 20-seat min = $288K floor. No individual tier.
- Legora: $100M ARR, $5.55B valuation, $3K/user/yr × 10-seat min = €30K floor. No individual tier.
- Rogo: $75M Series C, enterprise-only.
- Hebbia: Matrix product, grid-first not chat-first, $130M raised on $13M profitable revenue, 30%+ of top asset managers.
- Sierra: enterprise-only, $150M ARR.
- OpenEvidence: medical, free for verified doctors, no individual paid tier.
- CPG vertical TAM: Italian mid-market ~€30-50M ARR ceiling; EU ~€150M-€2B; global analyst seat base 50-150K at top tier → ~$1B addressable at Harvey/Legora pricing.
- NIQ Ask Arthur (shipped Apr 1 2026) + Circana Liquid AI (Jan 2026) = 12-18 month competitive window.
- Tome post-mortem: horizontal presentation market, 20M users, shuttered Apr 2025. "They needed more context."
- Jasper: -53% revenue 2023→2024 on horizontal AI writing compression.

---

## 7. What the new agent should do first

1. Read everything listed in §3. Do not summarize; absorb.
2. Form an independent view on §4's open questions.
3. Do not propose any new product feature or motion unless it can be cited to a team quote in §2 or an evidence point in §6.
4. If you disagree with the previous agent's framings (likely), say so directly. Do not apologize for disagreeing.
5. Respond to Marco with one honest assessment: where are we aligned, where is there still tension, what would you need to hear from the team to make a concrete recommendation.
6. Do NOT close with "green-light X Y Z?" multiple-choice questions. Ask one question at a time, rooted in what's actually undecided.
