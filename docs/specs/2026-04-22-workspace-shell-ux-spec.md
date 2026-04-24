# Workspace Shell UX Implementation Spec

**Date:** 2026-04-22
**Status:** Ready for implementation agent
**Owner (product):** Marco
**Sibling spec:** [docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md](2026-04-22-workspace-chat-and-research-layer-spec.md) (covers chat tools and research layer; this spec covers everything around them)

**Apr 24 override:** the scope route is now chat-first. The Apr 22 context-first scope landing described in §4.3.1 is archived as a rejected staging pattern after live production review. Current requirement: `/workspace/scope/[kind]/[slug]` uses the existing chat pane plus right context rail pattern, with scope metadata, stakeholders, deliverables, suggestions, and memory in the rail. Suggested actions render as composer pills. See `docs/2026-04-24-workspace-ux-audit.md`.

This spec covers the workspace shell that surrounds the chat surface: scope landing redesign, workspace home, empty states, onboarding, suggested-actions surface, loading states, bilingual chrome, mobile viewport, and visual density rules. The chat is one tool inside the workspace; this spec makes the workspace itself feel like a workspace and not a chat wrapper.

It applies five design golden rules locked by Marco on 2026-04-22 in `memory/feedback_design_golden_rules.md`:

1. Research SOTA before designing.
2. Loading and motion must be ASMR-quiet, never AI slop.
3. Opinionated human-crafted design as a moat.
4. Every interaction handles every edge case production-grade.
5. Sub-50ms for every non-LLM interaction; trick the mind otherwise.

Every section below cites references, lists craft notes, enumerates edge cases, and states a latency budget per Rule 1, 3, 4, 5. Loading and motion specs follow Rule 2.

---

## 0. Read first

- `memory/feedback_design_golden_rules.md` (the five rules above)
- `docs/working-rules.md` (banned phrases, no em dashes, no emojis, sentence case)
- `docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md` (sibling spec; do not duplicate work)
- `docs/specs/2026-04-22-insight-regression-promo-storytelling-and-niq-decimal-spec.md` (landed on main 2026-04-22 22:38; relevant for understanding the deck-output quality bar this shell surrounds)
- `docs/domain-knowledge/niq-promo-storytelling-playbook.md` (domain context — what "good" output looks like for the deliverables the shell is organizing)
- `docs/2026-04-19-v1-workspace-audit.md` and `docs/2026-04-20-ui-redesign-review-report.md` (current UX audit findings, especially Findings D, E, F, G that this spec resolves)
- `docs/2026-04-20-workspace-v2-research.md` (locked hero copy, recall metrics)
- `docs/spec-v1-workspace-v2-research-and-rebuild.md` (8 IA decisions previously locked; honor them)
- `memory/canonical-memory.md` (updated 2026-04-22 with intelligence-non-negotiable rules)
- `apps/web/src/app/(workspace)/` (current shell pages)
- `apps/web/src/components/workspace-chat/Chat.tsx` (chat surface this spec wraps)
- `docs/design-tokens.md` (existing token contract; extend, do not replace)

**Branch state, resolved 2026-04-23.** Branch `v2-research-memo` has been fast-forwarded to `origin/main` at `334a8da`. The NIQ promo hardening and import cleanup are present in the working tree. Implementation runs against current state. See sibling chat-and-research spec §0 for the full merge record.

---

## 1. Executive summary

Five surfaces get redesigned to fix the "chat wrapper" critique Rossella raised on 2026-04-22:

| Surface | What ships | Net effect |
|---|---|---|
| Scope landing page | Visible context strip (stakeholders, rules, recent deliverables, suggested next), then the chat below | First 2 seconds signal "your workspace" not "another ChatGPT" |
| Workspace home | Cross-scope dashboard with recent activity, pinned stakeholders, suggested actions, "what Basquio learned this week" digest | New user opens Basquio and immediately sees the value the memory has accumulated |
| Empty states (per scope, per workspace) | Three grades: brand-new, sparse-data, populated. Each delivers the locked sub-hero ("Basquio knows your clients, stakeholders, and style") through visible UI, not just copy | First-time users (Giulia, Veronica) understand what to do without reading a tutorial |
| Onboarding | 3-step guided setup on first login: name your scopes, drop one document, add one stakeholder. Then chat takes over | Co-founders and early users can self-onboard without a Marco demo |
| Suggested actions surface | Proactive prompt chips after every long pause, on scope landing, after every deck completion. Max 3 chips, contextual | Memory's value becomes immediately legible: "Basquio remembers Maria prefers Thursdays, want to schedule the brief?" |

Plus four shared concerns:

| Concern | Spec coverage |
|---|---|
| Loading states | All redesigned per Rule 2: ASMR-grade motion. Inline-skeleton stack with progressive entity reveal for `saveFromPaste`. View Transitions API for scope switches. Optimistic UI for chat append, sidebar collapse, file selection. |
| Bilingual chrome | Italian (default for Italian users via browser locale), English fallback. Sentence case. Italian numeric formats (comma decimals, EUR after amount, DD/MM/YYYY dates). |
| Mobile / narrow viewport | Functional below 1080px. Single-column collapse with chat-first priority. No layout breakage. Resolves Apr 20 review Finding E. |
| Density rules | When multiple cards stack in a single chat response, maximum density rules with progressive collapse. No vertical scroll explosion. |

---

## 2. References (Rule 1: research SOTA first)

Every design choice in this spec cites at least one of these dated 2025-2026 SOTA sources. Decisions that depart from a referenced pattern include a one-line rationale in the relevant section.

**Information architecture and density**
- Linear March 12 2026 redesign: dimmed sidebar, soft borders, "structure felt not seen," 8pt grid, 1.25 modular type scale, warmer gray palette. https://linear.app/now/behind-the-latest-design-refresh
- Notion March 18 2026 spacing update: adjacency-aware padding (paragraph blocks get extra gap, list items chunk), single-line vs paragraph spacing differentiation. https://www.notion.com/blog/updating-the-design-of-notion-pages
- Granola Spaces March 2026: two-tier sidebar (My / Workspace), folder hierarchy one level deep, drag-to-reorder, ⌘S sidebar toggle. https://docs.granola.ai/help-center/sharing/folders/spaces-and-folders
- Hebbia Matrix April 2026: grid-first density, every cell cited, progressive reveal of citations on click. https://www.hebbia.com/blog/whats-new-april-disclosure-2026

**Motion and loading**
- Linear Liquid Glass October 21 2025: SwiftUI material with Gaussian blur + specular highlight via SDF, edge distortion on drag, variable scroll-edge blur. https://linear.app/now/linear-liquid-glass
- Motion v12.37.0 (April 2026, formerly Framer Motion): default spring `{stiffness: 200, damping: 25, mass: 1}`, declarative `motion.div` API, React 19 `useOptimistic` integration, LazyMotion bundle reduction to ~17kb. https://motion.dev/docs/react-upgrade-guide
- View Transitions API stable in Chrome (Apr 2026), Next.js 15.x integration via `viewTransition` config option, recommended duration 300-500ms ease-in-out. https://nextjs.org/docs/app/guides/view-transitions

**Spacing and type**
- 8pt base grid + 4pt sub-grid is the production standard at Linear, Vercel, Notion. https://linear.app/now/behind-the-latest-design-refresh
- 1.25 modular type scale (12 → 15 → 18.75 → 23.4 → 29.3 → 36.6) is what Vercel and Notion converge on. https://www.notion.com/blog/updating-the-design-of-notion-pages
- **Honest note on Fibonacci:** the research showed Fibonacci spacing (4, 8, 13, 21, 34, 55) is a niche opinion, not 2026 SaaS standard. Linear, Notion, Vercel, Anthropic all use 8pt grid. We adopt 8pt grid + 1.25 modular type scale because it matches the gold-standard references Marco named (Notion, Linear) and is what production apps actually use. The 1.25 modular scale is golden-ratio-adjacent (1.618 / 1.272 ≈ 1.25 squared) without forcing irrational pixel values.

**Italian conventions**
- Designers Italia (Italian PA design system) sentence case rule, DD/MM/YYYY date format, comma as decimal separator, period as thousands separator, EUR symbol after amount. https://developers.italia.it/en/designers/

**Chat surface and tool rendering**
- AI SDK v6 (December 2025): tool-call rendering as inline chips, streaming token-by-token with cursor, approval-gated tools via `needsApproval: true`. https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- Anthropic Memory UI (March 2026 GA): sidebar transparency panel, edit/delete affordances per item, source-link on hover. https://docs.claude.com
- Claude Code Q1 2026 streaming patterns: status indicators inline, not modals. https://code.claude.com/docs/en/agent-sdk/streaming-output

**Accessibility**
- WCAG 2.2 AA (current 2026): 4.5:1 contrast minimum text/bg, 2px focus ring offset 2px, `prefers-reduced-motion` media query respected. https://www.w3.org/TR/WCAG22/

---

## 3. Design system primitives

### 3.1 Spacing scale (8pt grid, 4pt sub-grid)

```ts
export const space = {
  px: "1px",
  0.5: "2px",   // hairline
  1:   "4px",   // sub-grid, only inside compact components
  2:   "8px",   // grid base
  3:   "12px",  // half-step bridge
  4:   "16px",
  5:   "20px",  // half-step bridge
  6:   "24px",
  8:   "32px",
  10:  "40px",
  12:  "48px",
  14:  "56px",
  16:  "64px",
  20:  "80px",
  24:  "96px",
  32:  "128px",
} as const;
```

Pattern: powers of 8 are the spine; 4, 12, 20 are bridges for tight-packed components. No arbitrary values outside this scale ever land in production CSS.

**Edge cases:** dense data tables and mobile-narrow contexts may need 4px gutters. Allowed via `space[1]` only inside components flagged `density="compact"`.

### 3.2 Type scale (1.25 modular, base 15px)

```ts
export const type = {
  caption:  { size: "12px",  line: "16px", weight: 500, tracking: "0.01em" },
  body:     { size: "15px",  line: "22px", weight: 400, tracking: "0" },
  label:    { size: "13px",  line: "18px", weight: 500, tracking: "0.01em" },
  subtitle: { size: "18.75px", line: "26px", weight: 500, tracking: "-0.005em" },
  h3:       { size: "23.4px",  line: "30px", weight: 600, tracking: "-0.01em" },
  h2:       { size: "29.3px",  line: "36px", weight: 600, tracking: "-0.015em" },
  h1:       { size: "36.6px",  line: "44px", weight: 700, tracking: "-0.02em" },
  hero:     { size: "45.8px",  line: "52px", weight: 700, tracking: "-0.025em" },
} as const;
```

Tracking gets tighter as size grows. Body line-height of 1.47 (22/15) is Notion-paragraph-aware. **Sentence case for all UI labels and buttons**, Italian convention per Designers Italia.

**Craft note:** the 0.4-pixel sub-pixel sizes (18.75, 23.4, 29.3, 36.6, 45.8) are honored exactly via CSS rem. Browsers handle anti-aliasing. Not rounded to integers because the modular scale is the moat and rounding leaks into off-rhythm headings.

### 3.3 Color (warm gray, Linear-aligned)

Light theme:

```ts
export const lightColor = {
  bg: {
    canvas:   "#fefefe",         // page background
    surface:  "#f7f7f6",         // cards, panels
    sunken:   "#efeeec",         // inset wells, code blocks
    overlay:  "rgba(255, 255, 255, 0.85)",
  },
  border: {
    subtle:   "rgba(0, 0, 0, 0.05)",   // divider, very soft
    default:  "rgba(0, 0, 0, 0.08)",   // card border
    strong:   "rgba(0, 0, 0, 0.12)",   // input border
    focus:    "#3a6df0",                // focus ring
  },
  text: {
    primary:   "#1a1a1a",
    secondary: "#5b5b58",
    tertiary:  "#8a8a85",        // dimmed, e.g., sidebar nav
    onAccent:  "#ffffff",
    placeholder: "#a8a8a3",
  },
  accent: {
    primary:   "#1a1a1a",         // black-as-accent (Linear-style restraint)
    secondary: "#3a6df0",         // indigo for links and focus
    success:   "#3a8a4d",
    warning:   "#a06a1a",
    danger:    "#b53e3e",
  },
} as const;
```

Dark theme mirrors with warmer grays (per Linear March 2026 shift away from cool blue):

```ts
export const darkColor = {
  bg: {
    canvas:   "#0e0e0d",
    surface:  "#1a1a18",
    sunken:   "#252522",
    overlay:  "rgba(0, 0, 0, 0.85)",
  },
  border: {
    subtle:   "rgba(255, 255, 255, 0.04)",
    default:  "rgba(255, 255, 255, 0.07)",
    strong:   "rgba(255, 255, 255, 0.11)",
    focus:    "#5a85f5",
  },
  text: {
    primary:   "#f5f5f4",
    secondary: "#b5b5b1",
    tertiary:  "#7a7a76",
    onAccent:  "#f5f5f4",
    placeholder: "#5a5a55",
  },
  accent: {
    primary:   "#f5f5f4",         // white-as-accent inverse
    secondary: "#5a85f5",
    success:   "#5aa56d",
    warning:   "#c08a3a",
    danger:    "#d56565",
  },
} as const;
```

**Craft note:** no skeuomorphic shadows. Borders are the separator language, never drop shadows. Where elevation is needed (modal, popover), use a 1px border + 1px solid bg shift, not a blur shadow. This is the Linear-Notion-Anthropic convention as of 2026.

### 3.4 Border radius

```ts
export const radius = {
  none:  "0",
  xs:    "4px",   // inputs, chips
  sm:    "6px",   // buttons, cards (default)
  md:    "8px",   // panels, modals
  lg:    "12px",  // hero cards, drawer
  full:  "9999px", // pills, avatars
} as const;
```

Linear's March 2026 refresh softened radii. Default is `sm` (6px). Avoid `lg` and `full` except for distinct visual roles (badges, avatars).

### 3.5 Motion primitives

```ts
export const motion = {
  ease: {
    out:     "cubic-bezier(0.2, 0, 0.38, 0.9)",   // default
    inOut:   "cubic-bezier(0.4, 0, 0.2, 1)",      // page transitions
    spring:  "cubic-bezier(0.34, 1.56, 0.64, 1)",  // playful, reserve for confirmations
  },
  duration: {
    instant: "80ms",   // hover, focus, button press
    fast:    "180ms",  // tooltip, small reveals
    medium:  "260ms",  // sidebar collapse, panel slide
    slow:    "400ms",  // modal open, view transition
    deliberate: "640ms", // entrance animation, hero reveal
  },
  spring: {
    soft:    { type: "spring", stiffness: 180, damping: 28, mass: 1 },
    standard: { type: "spring", stiffness: 220, damping: 24, mass: 1 },
    snappy:  { type: "spring", stiffness: 320, damping: 30, mass: 0.9 },
  },
} as const;
```

**Craft note (Rule 2):** spring is reserved for moments of human delight (extraction approval, deck-ready notification). Daily interactions use `ease.out` at `duration.fast` or `duration.medium` because spring on every click reads as juvenile. Linear's iOS Liquid Glass uses spring sparingly, mostly for tap feedback and drag-edge distortion; we follow that restraint.

**Banned animations:**
- Wobbly springs (`stiffness < 120`)
- Bouncy easing on functional UI (only on celebration moments)
- Continuous loop animations (spinners) outside the `Spinner` component
- Skeleton shimmer with high-contrast diagonal sweep (cheap-stack vibe). Use a quiet 800ms opacity pulse from 0.3 to 0.6 instead.
- Any animation that crosses 800ms unless it's a deliberate hero reveal

### 3.6 Latency budget defaults (Rule 5)

| Interaction | Target | Technique |
|---|---|---|
| Button press feedback | < 16ms | CSS transition on transform/opacity |
| Sidebar collapse | < 50ms perceived | `useOptimistic` for state, View Transitions API for layout |
| Scope switch | < 50ms perceived | Prefetch on hover, View Transitions API, optimistic skeleton |
| Modal/drawer open | < 80ms perceived | `useOptimistic` for state flag, motion.div enter at 180ms |
| Search keystroke | < 32ms | Local debounced filter, server search at 200ms with progressive results |
| File drag-drop visual | < 16ms | Pure CSS, no React state |
| Chat composer focus | < 16ms | Native focus + CSS |
| Chat message append | < 50ms perceived | Optimistic append before server confirms |
| Tool chip render (input phase) | < 50ms | Skeleton-first, fill on stream |
| Page navigation | < 80ms perceived | View Transitions API + prefetch |
| **LLM responses** | exempt | But surrounding UI stays sub-50ms |
| **Firecrawl scrape** | exempt | Telemetry chip updates sub-50ms |

The "trick the mind" pattern (Rule 5 fallback): when backend exceeds 50ms, the UI commits the visual state at click time via optimistic update or skeleton, motion bridges the gap, and the real result quietly slides in when ready. The user perceives instant.

---

## 4. Workspace shell architecture

### 4.1 Three-tier layout

The workspace shell is a fixed three-zone layout. Replaces today's flat `wbeta-workspace-layout` (Apr 20 review Finding E flagged it broken below 1080px).

```
┌──────────┬─────────────────────────────────────┬──────────────┐
│          │                                     │              │
│  Sidebar │            Main Surface             │   Aside      │
│  280px   │            min 720px                │   320px      │
│          │            (chat + context)         │   (memory,   │
│          │                                     │    suggested │
│          │                                     │    actions)  │
│          │                                     │              │
└──────────┴─────────────────────────────────────┴──────────────┘
```

**Desktop (>= 1280px):** all three zones visible.
**Laptop (1024-1279px):** sidebar visible (240px), main + aside collapse aside into a tab.
**Tablet (640-1023px):** sidebar collapses to icon-only rail (56px), main full width, aside is drawer-only.
**Mobile (< 640px):** sidebar hidden behind hamburger, main full width, aside is bottom sheet.

**Craft notes:**
- Zones never overlap. If main needs more space, aside becomes a tab on the right edge of main, not an overlay.
- Sidebar width is `space[35]` = 280px (deliberate non-default). Not 240, not 320. 280 fits exactly Linear's nav width and the 8pt grid.
- Aside width is `space[40]` = 320px. Nav rail collapses to `space[7]` = 56px (icon-only).

**Edge cases:**
- Window resizes mid-interaction: zones re-flow without losing scroll position (use `position: sticky` for column headers).
- Two monitors: workspace can open in a second window; each window persists its own zone state in localStorage.
- Chat messages mid-stream during resize: the message stack does not reflow until streaming completes; resize takes effect on next message.

**Latency budget:** zone resize re-render < 16ms (CSS grid + container queries). Sidebar collapse animation 260ms ease-out.

### 4.2 Sidebar (left, 280px)

Three sections, top to bottom:

```
┌──────────────────────────────┐
│  ◉ basquio                   │  ← workspace switcher (avatar + name)
│                              │
├──────────────────────────────┤
│  My work                     │  ← personal scope, always pinned
│  ─────                       │
│  Recent chats                │  ← last 5, scoped to current scope
│  · Q1 Snack Salati read      │
│  · Amadori brief draft       │
│  · ...                       │
│                              │
├──────────────────────────────┤
│  Scopes                      │  ← collapsible group header
│  ▾ Clients                   │
│    ◯ Kellanova               │
│    ◯ Mulino Bianco           │
│    ◯ Amadori                 │
│  ▾ Categories                │
│    ◯ Snack salati            │
│    ◯ Pasta                   │
│  ▾ Functions                 │
│    ◯ Trade marketing         │
│                              │
├──────────────────────────────┤
│  ⌘K  Search                  │  ← command palette trigger
│  ⚙   Settings                │
└──────────────────────────────┘
```

**Granola/Linear-aligned pattern:** scopes are folder-style groups, collapsible, drag-to-reorder. One nesting level deep only (Granola convention). Active scope has a 4px-wide accent left border.

**Craft notes:**
- Scope name uses `text.tertiary` (dimmed gray); active scope name uses `text.primary` and bold weight 500. Linear's "structure felt not seen" pattern.
- Hover state on scope row: background `bg.surface`, animate over 80ms.
- Drag handle appears only on hover, never persistent (Linear pattern).
- Collapsed scope group remembers state per workspace in localStorage.

**Edge cases:**
- 100+ scopes (large workspace): virtualized list with `react-virtual`. Pagination is anti-pattern in a sidebar; users want full scroll.
- Scope name longer than width: truncate with ellipsis, tooltip on hover after 600ms delay.
- Workspace switcher: opens a popover with all workspaces user has access to; max 8 visible, then "see all" footer.
- Right-click on scope: context menu with rename, archive, change icon, share. Not in v1; render menu disabled with "coming soon" copy.
- Keyboard navigation: ⌘1, ⌘2, ⌘3 jump to scope groups. ↑/↓ navigates within group. Enter activates.
- Zero scopes (brand new workspace): show single "+ Create your first scope" prompt in scope group, with onboarding hint.

**Latency budget:** sidebar item click navigates in < 50ms (View Transitions API). Hover feedback < 16ms.

### 4.3 Main surface (center, min 720px)

Two layouts depending on what scope is active:

**4.3.1 Scope landing page (default when entering a scope)**

This is the redesign that fixes Rossella's chat-wrapper critique. Today's V1 puts a chat input at the top. Tomorrow's design surrounds the chat with workspace context.

```
┌────────────────────────────────────────────────┐
│  Kellanova                                      │  ← scope name (h1, 36.6px)
│  Client · 8 stakeholders · 24 deliverables     │  ← caption row, dimmed
│                                                 │
├────────────────────────────────────────────────┤
│                                                 │
│  Stakeholders ────────────────  See all (8) →  │  ← section header, label style
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Maria R. │ │ Giuseppe │ │ Anna F.  │        │  ← compact stakeholder cards
│  │ Insights │ │ Category │ │ Trade    │        │
│  │ "52-week │ │ "Source  │ │ "Italian │        │  ← single preference quote
│  │ rolling" │ │ callout  │ │ format"  │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                 │
├────────────────────────────────────────────────┤
│  Workspace knows ────────────────              │
│                                                 │
│  · 4 rules apply to this scope                 │  ← clickable, opens drawer
│  · 12 facts about Kellanova brands             │
│  · 18 articles in the knowledge graph          │
│  · Last research: 2 days ago, 6 sources        │
│                                                 │
├────────────────────────────────────────────────┤
│  Recent deliverables ─────────  See all (24) → │
│  · Q1 2026 Snack Salati read     2 days ago    │
│  · JBP Esselunga prep            5 days ago    │
│  · Promo pressure analysis       1 week ago    │
│                                                 │
├────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐  │
│  │  Ask anything about Kellanova...         │  │  ← chat composer at the bottom
│  │                                           │  │     not at the top
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Strategic choice:** the chat is **at the bottom of the scope landing**, not the top. Reading top-to-bottom, the analyst sees workspace state first, then the chat as one of several actions. This is the visible signal that the workspace is more than a chat interface. Inspired by Hebbia's Matrix-first layout where chat is one tool among many, and Linear's "Your work" dashboard where the input is part of a larger context.

When the user actually starts typing or hits ⌘L (focus chat), the layout transitions: the chat slides up to fill the main surface, the workspace context strip collapses into a compact header band at the top, and the conversation thread appears. View Transitions API at 300ms ease-in-out.

**Craft notes:**
- Section headers use `type.label` weight 500 with a 1px hairline divider that runs to the column right edge. Borders are `border.subtle`. No icons in section headers (cleaner).
- Stakeholder cards are 224px wide (8pt grid), 96px tall, 3 visible by default with horizontal scroll for the rest. Each card shows name, role, and one quoted preference (the most recent or most-applied per scope).
- "Workspace knows" rows are clickable, opening the appropriate drawer (rules drawer, facts drawer, knowledge-graph drawer). The drawer is a right-side panel, 480px wide, opens in 260ms ease-out.
- "Recent deliverables" rows are clickable to open the deliverable in a new tab.
- Chat composer at the bottom is sticky to viewport bottom, not page bottom. Always within thumb reach on tablet.

**Edge cases:**
- Scope has zero stakeholders: section is hidden entirely (do not show empty stakeholder row). Onboarding hint appears in "Workspace knows" instead: "Add your first stakeholder to get personalized briefs."
- Scope has zero recent deliverables: section is hidden entirely.
- "Workspace knows" is always visible (it's the trust signal); zero counts read as "0 rules · 0 facts · 0 articles" with a "Drop a file or paste an email to start" CTA.
- Long scope name (>60 chars): truncate with ellipsis, full name appears as tooltip after 600ms delay.
- User clicks "See all (8)" stakeholders: opens stakeholders drawer with full list, search, edit, archive.
- User clicks chat composer: layout transitions per above. ESC reverts to landing layout.
- Chat composer pre-populated by suggested action click: layout transitions immediately, message draft visible.

**Latency budget:**
- Initial scope landing render: < 80ms perceived. Server-side render with cached scope context. Streaming entity counts after if needed.
- Click "See all": drawer opens in < 50ms perceived (motion.div enter, content streams in).
- Click chat composer: layout transition completes in 300ms (View Transitions API), composer focused at frame 1.

**4.3.2 Active chat layout (when chat is open)**

```
┌────────────────────────────────────────────────┐
│ ← Kellanova · 4 rules · 12 facts                │  ← compact context header (sticky, 48px tall)
├────────────────────────────────────────────────┤
│                                                 │
│  [Chat thread, scrollable]                      │
│                                                 │
│  User: Maria asked for a Q1 read...             │
│                                                 │
│  [Tool chip: retrieveContext, 8 sources]        │
│  [Tool chip: showStakeholderCard, Maria R.]     │
│                                                 │
│  Basquio: Based on Q1 NIQ data and the         │
│  conversation we had last week...               │
│  [graph:abc123][firecrawl:xyz789]              │
│                                                 │
│  [Save as memo] [Generate deck]                 │
│                                                 │
├────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐  │
│  │  Continue the conversation...             │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Craft notes:**
- Compact context header (48px) replaces the full landing context strip when in chat mode. Click ← to return to landing.
- Tool chips per the sibling spec; no rebuilding here. Density rules in §11 apply.
- Save as memo / Generate deck buttons render at the end of every assistant turn (already shipped per commit `eff4e21`).

### 4.4 Aside (right, 320px)

Two collapsible sections:

**4.4.1 Workspace memory panel** (Anthropic Memory Tool pattern)

```
┌────────────────────────────────┐
│  Workspace memory              │
│                                 │
│  ⊕ 3 saved this week           │  ← clickable, opens activity log
│                                 │
│  Recent saves                   │
│  · Maria R. role updated        │
│    From email · 2 days ago      │
│    [edit] [delete] [view source]│  ← affordances appear on hover
│                                 │
│  · "Use 52-week rolling"        │
│    Rule · 3 days ago            │
│                                 │
│  · 12 articles from research    │
│    Scrape · 5 days ago          │
│                                 │
│  See all → /workspace/memory    │
└────────────────────────────────┘
```

**Craft notes:**
- Saves render with the source explicit: where it came from (email paste, file upload, manual rule, research scrape). This is the Anthropic Memory transparency pattern.
- Edit/delete affordances appear only on hover (Linear pattern), never persistent.
- Click "view source" on a paste/email save → drawer opens with the original text + the extracted entities.
- Click "view source" on a research save → drawer opens with the scraped article markdown.

**Edge cases:**
- Zero saves this week: panel collapses to a single "Memory will grow as you use Basquio" row.
- 100+ saves this week: panel shows top 5 by recency, with "+ 95 more" link.
- Delete confirmation: inline approval card, not modal. "Delete this memory? This cannot be undone." with [Confirm] [Cancel] buttons.
- Edit memory entry: opens an inline edit field, not a modal. ⌘Enter to save, ESC to cancel.
- Source link broken (e.g., uploaded file deleted): show "Source no longer available" badge, edit/delete still work.

**Latency budget:** panel renders < 50ms (server-side, cached for 60s). Edit save < 80ms perceived (optimistic update).

**4.4.2 Suggested actions panel** (covered fully in §7)

### 4.5 Workspace home (cross-scope dashboard)

Default route when user opens Basquio with no scope selected. Replaces today's empty workspace home.

```
┌────────────────────────────────────────────────┐
│  Good afternoon, Marco                          │  ← time-based greeting (Italian: "Buon pomeriggio, Marco")
│  This week, Basquio learned 47 new things       │  ← workspace-wide weekly digest
│  about your clients.                            │
│                                                 │
├────────────────────────────────────────────────┤
│  Suggested for today                            │
│  ┌──────────────┬──────────────┬──────────────┐│
│  │ Continue     │ Maria asked  │ Q1 read for  ││
│  │ Snack Salati │ for a brief  │ Mulino       ││
│  │ Q1 brief     │ on Esselunga │ Bianco draft ││
│  └──────────────┴──────────────┴──────────────┘│
│                                                 │
├────────────────────────────────────────────────┤
│  Active scopes                  See all (12) → │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Kellanova│ │ Mulino   │ │ Amadori  │        │
│  │ 8 stake- │ │ Bianco   │ │ 4 stake- │        │
│  │ holders  │ │ 3 stake- │ │ holders  │        │
│  │ 24 docs  │ │ holders  │ │ 9 docs   │        │
│  │          │ │ 12 docs  │ │          │        │
│  │ Updated  │ │ Updated  │ │ Updated  │        │
│  │ 2d ago   │ │ 5d ago   │ │ 1w ago   │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                 │
├────────────────────────────────────────────────┤
│  This week                                      │
│  · 4 deliverables shipped                      │
│  · 18 stakeholder facts updated                 │
│  · 47 articles added to knowledge graph         │
│  · 12 hours saved (estimated)                   │
│                                                 │
└────────────────────────────────────────────────┘
```

**Strategic choice:** the workspace home is the **memory's value made visible**. "This week, Basquio learned 47 new things" is the line that delivers handoff §1 aha #2 ("Basquio remembers"). It's the proactive surface that says "your investment in this workspace is compounding." Without this, the home page feels like ChatGPT's sidebar of conversations.

**Craft notes:**
- Greeting is time-of-day localized in user's language. "Good afternoon" / "Buon pomeriggio" / "Bonjour".
- "Suggested for today" cards are generated by the suggested-actions surface (§7). Max 3 cards.
- Scope cards show updated-time relative; on hover, exact timestamp tooltip.
- "This week" stats are weekly digest; click any row to see details.

**Edge cases:**
- New workspace, zero scopes: replace entire layout with onboarding (§6).
- New user, populated workspace: greeting + suggested for today + scope cards. "This week" stats may be empty for first 7 days; show "Stats appear after a week of activity."
- 50+ scopes: show top 6 by recent-activity in "Active scopes" with "see all" link.

**Latency budget:** workspace home renders < 80ms perceived. Server-side render with 60s cache on stats. Suggested-for-today server-side rendered with 5min cache (per-user).

---

## 5. Empty states

Three grades of empty state, each delivering the locked sub-hero ("Basquio knows your clients, stakeholders, and style") through visible UI rather than just copy.

### 5.1 Brand-new workspace (zero data)

When a brand-new workspace is created (first user, no scopes, no documents, no rules):

```
┌────────────────────────────────────────────────┐
│                                                 │
│         ┌─────────────────────────┐             │
│         │  Welcome to Basquio     │             │
│         │                         │             │
│         │  Your workspace will    │             │
│         │  remember your clients, │             │
│         │  your stakeholders, and │             │
│         │  your style. Every      │             │
│         │  answer cites where it  │             │
│         │  came from.             │             │
│         │                         │             │
│         │  ┌───────────────────┐  │             │
│         │  │  Set up workspace │  │             │
│         │  └───────────────────┘  │             │
│         └─────────────────────────┘             │
│                                                 │
└────────────────────────────────────────────────┘
```

Click "Set up workspace" → onboarding flow (§6).

**Craft notes:**
- The card is centered horizontally and at 35% from top vertically (golden ratio approximation: 1/1.618 ≈ 0.618 from bottom = 0.382 from top, rounded to 35%). The one place a near-Fibonacci ratio earns its keep is hero composition.
- No illustration. Linear-style restraint. Type carries the weight.
- Sub-hero copy is the locked positioning from `docs/2026-04-20-workspace-v2-research.md`.

### 5.2 Sparse workspace (some data, missing key context)

When the workspace has a scope but no stakeholders, or stakeholders but no rules, the relevant section in the scope landing shows a soft prompt instead of being hidden:

```
┌────────────────────────────────────────────────┐
│  Stakeholders ────                              │
│                                                 │
│  Add your first stakeholder so Basquio can     │
│  tailor briefs to who reads them.              │
│                                                 │
│  Quick add: paste a contact, drop a vCard, or  │
│  tell the chat: "Maria Rossi heads Insights at │
│  Kellanova, prefers 52-week reads."            │
│                                                 │
│  [Add stakeholder]                              │
└────────────────────────────────────────────────┘
```

**Craft notes:**
- Each empty section has its own copy, never a generic "nothing here." Specific to what's missing and why filling it helps.
- The chat-driven option ("tell the chat...") is always one of the offered paths. Reinforces that chat is the primary interaction.

### 5.3 Populated workspace (default state)

This is the layout in §4.3.1 above. No empty state; the data fills the slots. Empty state is for absence-of-data, not absence-of-design.

**Edge cases shared across all empty states:**
- Italian language: copy is fully localized, including the example ("Maria Rossi a capo dell'Insights di Kellanova, preferisce letture 52 settimane.").
- Loading: empty states render at the same time as data fetches; if data arrives, replace the empty state without animation flash (don't reveal-then-hide).
- Error fetching scope context: empty state copy adjusts to "Couldn't load this scope. [Retry]" without exposing technical detail.

**Latency budget:** empty state renders < 50ms (no data fetch needed, server-side rendered).

---

## 6. Onboarding flow

Three steps, takes about 4 minutes for a new user.

### 6.1 Step 1: Name your scopes (90 seconds)

```
┌────────────────────────────────────────────────┐
│  Step 1 of 3                                    │
│                                                 │
│  What do you analyze?                           │
│                                                 │
│  Pick the kinds of work you'll do in Basquio.  │
│  We'll create scopes for each. You can add     │
│  more later.                                    │
│                                                 │
│  ┌────────────────────────────────────────┐    │
│  │ ▢  A specific client                   │    │
│  │    Like "Kellanova" or "Mulino Bianco" │    │
│  │                                         │    │
│  │ ▢  A category I cover                  │    │
│  │    Like "Snack salati" or "Pasta"      │    │
│  │                                         │    │
│  │ ▢  A function I support                │    │
│  │    Like "Trade marketing" or "JBP"     │    │
│  │                                         │    │
│  │ ▢  Something else                      │    │
│  │    Tell us in your own words           │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  [Continue →]                                   │
└────────────────────────────────────────────────┘
```

For each chosen, ask for one or two specific names (text input, max 5 entries per type). Creates `workspace_scopes` rows.

### 6.2 Step 2: Drop one document (90 seconds)

```
┌────────────────────────────────────────────────┐
│  Step 2 of 3                                    │
│                                                 │
│  Drop one thing that represents your work.      │
│                                                 │
│  An old deck. A category brief. A NIQ export.  │
│  Anything you've made in the last quarter.     │
│                                                 │
│  Basquio will read it, learn your style,       │
│  remember the people in it, and start          │
│  building your workspace memory.               │
│                                                 │
│  ┌────────────────────────────────────────┐    │
│  │                                         │    │
│  │     Drop a file here                   │    │
│  │     or click to browse                 │    │
│  │                                         │    │
│  │     PDF, DOCX, PPTX, XLSX, MD          │    │
│  │                                         │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  [Skip for now]                  [Continue →]  │
└────────────────────────────────────────────────┘
```

On drop, run `processWorkspaceDocument()` (existing pipeline). Show extraction result inline as it streams in (people found, brands found, facts extracted). The user sees Basquio learning in real time, which is the demo of memory.

### 6.3 Step 3: Add one stakeholder (60 seconds)

```
┌────────────────────────────────────────────────┐
│  Step 3 of 3                                    │
│                                                 │
│  Who do you write for?                          │
│                                                 │
│  Pick one stakeholder. Maybe your boss, your   │
│  most demanding client, the person who'll read │
│  your next deck.                               │
│                                                 │
│  Basquio will tailor every brief to them.      │
│                                                 │
│  ┌────────────────────────────────────────┐    │
│  │  Name      [______________________]    │    │
│  │  Role      [______________________]    │    │
│  │  Company   [______________________]    │    │
│  │  They prefer    (one or two things)    │    │
│  │            [______________________]    │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  [Skip for now]                   [Finish →]   │
└────────────────────────────────────────────────┘
```

If Step 2 extracted any people, Step 3 pre-suggests them: "Found Maria Rossi in your document. Add her?"

After Step 3, user lands on the scope landing page for the first scope they named. Now populated with one document, one stakeholder, and any extracted entities. The first chat turn is then guided: chat fires `explainBasquio(topic: "what_you_know_about_me")` automatically and tells the user what it now knows.

### 6.4 Edge cases

- User skips Step 2: no document, but workspace is set up with scopes. Step 3 has no extracted people to suggest.
- User skips Step 3: workspace is set up; chat is the user's path to add stakeholders later via `createStakeholder` tool.
- User abandons mid-flow: state is saved per step, resume on next login. Show "Resume setup" banner.
- User refreshes page mid-extraction in Step 2: extraction continues background; refresh shows the in-progress state with the same skeleton and reveals when extraction completes.
- Document upload fails (file too large, format not supported): inline error with retry, never modal. Allowed formats explicit. Max 50MB per file in onboarding.
- Network drops mid-Step-2 upload: optimistic UI shows "Uploading…" and retries up to 3 times with backoff (1s, 3s, 9s). After 3 failures, prompt user to retry or skip.

### 6.5 Latency budget

- Each onboarding step renders < 80ms perceived (server-side rendered).
- Document upload: optimistic UI shows file appearing instantly; background upload completes; extraction starts. User can proceed before extraction finishes (it's a background job).
- Continue button is enabled as soon as the page renders; required-field validation happens client-side instantly.

---

## 7. Suggested actions surface

Proactive nudges that demonstrate memory's value. Three placements:

### 7.1 Scope landing "Suggested next"

Renders as a horizontal strip just below the scope context (between "Workspace knows" and "Recent deliverables"):

```
Suggested next ────
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ Continue         │ │ Maria asked you  │ │ Q1 NIQ read for  │
│ Snack Salati     │ │ for a brief on   │ │ Mulino Bianco    │
│ Q1 brief draft   │ │ Esselunga next   │ │ is ready to draft│
│                  │ │ week             │ │                  │
│ [Open]           │ │ [Draft brief]    │ │ [Start]          │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

Maximum 3 cards. Each card:
- Title: a specific, contextual sentence (not "you might like" boilerplate).
- One-line subtitle when needed.
- One primary CTA button.
- No illustration.

Cards generated by a server-side suggester that queries:
- Recent unfinished drafts (status='draft' deliverables in this scope, last 14 days)
- Recent stakeholder mentions in chat (entity_mentions where entity is a person, last 7 days, with intent='request' from extraction)
- Calendar events for this scope's stakeholders (when calendar connector ships in v2)
- Recurring patterns: if the user did a Q1 read in this scope last year, suggest the Q2 read at the right time

V1 ships with the first two only. Calendar and recurrence patterns are v2.

### 7.2 Workspace home "Suggested for today"

Same card pattern as §7.1 but cross-scope. Top 3 highest-scored suggestions across all scopes the user has access to.

### 7.3 Inline post-message suggestions

After every assistant turn that completes (not during streaming), render up to 3 chip-style follow-ups inline at the end of the message:

```
You might also want to:
[Pull last quarter's deck]  [Compare to Mulino Bianco]  [Schedule with Maria]
```

Chips dismiss on click (the click action becomes the next chat turn) or on next user message.

### 7.4 Edge cases

- Zero suggestions: section hidden entirely (do not render "no suggestions"). The presence of the section is itself a value claim; absence should not negate it.
- User dismisses a suggestion: do not show it again for 7 days. Track dismissals per-user.
- Suggestion becomes stale (e.g., Maria's request was answered yesterday but suggestion still says "Maria asked..."): suggester runs every 5 minutes server-side and prunes stale items.
- Click "Open" on a suggestion: deep-link to the relevant deliverable / chat / brief draft. View Transitions API for the navigation.
- Italian: every suggestion title is generated in the user's preferred language by the suggester (passes through a templated translation, not a runtime LLM call for cost reasons).

### 7.5 Latency budget

- Suggestions render < 80ms perceived (server-side rendered with 5min per-user cache).
- Click suggestion: navigation completes < 80ms perceived (View Transitions + prefetch).
- Dismiss: optimistic remove < 16ms (CSS transition out).

---

## 8. Loading states and transitions (Rule 2 + Rule 5)

The most important section for craft. Production-grade everywhere.

### 8.1 Skeleton system

One skeleton component, three densities. Use opacity pulse, NEVER shimmer.

```tsx
<Skeleton density="line" width="60%" />
<Skeleton density="line" width="40%" />
// renders two horizontal bars at type.body height with 8px gap

<Skeleton density="card" width="full" height="96px" />
// renders a single rounded rect at radius.sm

<Skeleton density="grid" rows={3} cols={3} cellHeight="56px" />
// renders a grid of skeleton cells
```

Animation: opacity pulse from 0.3 to 0.55 over 800ms, ease-in-out, infinite. Never shimmer. Never gradient sweep.

**Edge cases:**
- Maximum 3 skeletons in a vertical stack at once (Notion convention). Beyond 3, render "Loading more…" text in `text.tertiary`.
- Skeleton matches the actual content's dimensions exactly. No layout shift when real content arrives.
- Skeleton respects `prefers-reduced-motion`: no pulse, just static `opacity: 0.4`.

### 8.2 Inline tool-chip states (sibling spec compatibility)

Tool chips per the chat spec render in three states: `input-streaming` (chip is being constructed), `input-available` (waiting on tool execution), `output-available` (complete). Each state uses a different icon weight:

- `input-streaming`: Phosphor icon at `weight="thin"`, 16px, opacity pulse on the icon
- `input-available`: Phosphor icon at `weight="regular"`, 16px, no animation
- `output-available`: Phosphor icon at `weight="fill"`, 16px, no animation
- `output-error`: Phosphor icon at `weight="regular"`, danger color, no animation

The icon weight transition from regular to fill at output-available signals completion. Better than spinners or success ticks.

### 8.3 Streaming text indicator

Token-by-token streaming with a 1px-wide blinking cursor (already shipped per audit `ChatMessage.tsx`). The cursor blinks at 530ms interval (Apple HIG default), opacity 0 to 1 to 0, ease-in-out.

### 8.4 Approval card loading state for `saveFromPaste`

Per the sibling spec, `saveFromPaste` runs entity extraction which takes 5-15 seconds. The approval card needs a progressive reveal:

```
[0-300ms]    Card placeholder appears with "Reading..." in `text.tertiary`, spinner-free
[300ms-2s]   Card title fills: "Saved from email." Skeleton lines appear for entities and facts.
[2s-5s]      Entities reveal one row at a time with a 80ms stagger and a soft fade-in motion (opacity 0 to 1, transform translateY(4px) to 0, ease-out 180ms).
[5s+]        Facts and dimensions complete. Approval buttons enable.
```

The progressive reveal is the entertainment. No spinner. No "AI is thinking." Just craft-quality reveal of the work being done.

**Edge cases:**
- Extraction takes >30 seconds (slow LLM): after 30s, show subtle text "Still working — 5,000 tokens in" in `text.tertiary`. After 60s, show "[Cancel] this extraction" affordance.
- Extraction errors: card transitions to error state with the specific error message and a [Retry] button. Approval buttons hidden.
- User clicks [Cancel] mid-stream: extraction request aborts, card collapses with 180ms ease-out.

**Latency budget (Rule 5 trick-the-mind):** card placeholder appears < 50ms after paste. The 5-15s extraction is the LLM portion (exempt). Surrounding UI stays sub-50ms.

### 8.5 Scope navigation with View Transitions

When the user clicks a scope in the sidebar:

```ts
function handleScopeClick(scopeId: string) {
  document.startViewTransition(() => {
    router.push(`/workspace/scopes/${scopeId}`);
  });
}
```

The View Transitions API morphs the layout: scope name slides into the h1 position, sidebar item gets the active accent border, "Workspace knows" stats fade in. 300ms ease-in-out total. Feels like one continuous motion, not a page reload.

**Edge cases:**
- Browser without View Transitions support (older Safari): fall back to instant navigation with no animation. Functionality unchanged.
- User clicks rapidly on multiple scopes: cancel the in-flight transition, start the new one (Linear pattern).
- Network slow (scope data not cached): View Transition completes with skeleton in main, real content streams in 100-300ms later.

**Latency budget:** transition completes < 300ms (View Transitions + prefetch). Perceived navigation < 50ms (transition starts at click).

### 8.6 Sidebar collapse with optimistic state

```tsx
function SidebarToggle() {
  const [collapsed, setCollapsed] = useOptimistic(serverCollapsed);
  return (
    <button onClick={() => {
      setCollapsed(!collapsed);              // optimistic
      saveSidebarState(!collapsed);          // background
    }}>
  );
}
```

State flips immediately. Server save is async. If save fails, revert with subtle toast.

**Latency budget:** state flip < 16ms. Animation 260ms ease-out (`motion.duration.medium`).

### 8.7 Modal/drawer open

Always use `motion.div` with the `motion.spring.standard` config or the `motion.duration.fast` ease-out. Never CSS-only for modal opens because they need spring physics for the human-feel quality (Rule 3).

```tsx
<motion.div
  initial={{ opacity: 0, x: 20 }}
  animate={{ opacity: 1, x: 0 }}
  exit={{ opacity: 0, x: 20 }}
  transition={motion.spring.standard}
>
```

Drawer slides in from right edge with spring damping. Modal fades + scales subtly (scale 0.96 to 1).

**Edge cases:**
- User clicks outside while opening: opening completes, then closes immediately (don't cancel mid-animation, looks broken).
- ESC key closes; tab order traps focus inside while open.
- Mobile: drawer becomes bottom sheet, slides up from bottom with same spring config.

### 8.8 Banned loading patterns

Per Rule 2, the following are banned in any Basquio surface:

- Spinning circles outside the dedicated `Spinner` component (which is reserved for sub-second waits in modal action buttons)
- "AI is thinking..." or "Loading..." text outside critical error contexts
- Skeleton shimmer (the high-contrast diagonal sweep that screams cheap-stack)
- Bouncy springs on functional UI (springs reserved for celebration moments)
- Loading bars / progress bars (per `feedback_no_progress_bars.md` for non-deterministic ops)
- Emoji loading indicators (per `feedback_no_emojis.md`)
- Sparkle effects, gradients on buttons, rainbow underlines, glow effects
- Auto-playing animations on page load (single-use only on intentional reveals)

If a wait is unavoidable, use the progressive-reveal pattern from §8.4, which entertains by showing real work happening rather than fake animation.

---

## 9. Bilingual chrome (Italian default for Italian users)

### 9.1 Locale detection

On first login, detect the user's locale from browser `Accept-Language`. If Italian (`it`, `it-IT`, `it-CH`), default workspace language to Italian. Save to `users.preferred_language`. User can switch in settings; switch is instant via i18n bundle swap.

### 9.2 Italian conventions per Designers Italia

| Convention | Example |
|---|---|
| Sentence case for labels | "Importa file" not "Importa File" |
| Sentence case for buttons | "Aggiungi stakeholder" not "Aggiungi Stakeholder" |
| Date format | DD/MM/YYYY: "22/04/2026" |
| Time format | 24-hour: "14:30" |
| Decimal separator | Comma: "1.234,56" |
| Thousands separator | Period |
| Currency | EUR after amount: "1.234,56 €" |
| Quotes | Caporali primary: «...» (or curly "..." in informal) |
| Ellipsis | Single character: … not three periods |

### 9.3 Translation strategy

Static UI strings (button labels, section headers, empty-state copy): translated by hand, stored in `apps/web/src/i18n/{en,it}.ts`. Never auto-translated.

Dynamic content (chat assistant responses, deck output, brief synthesis): generated in the workspace's preferred language directly by the LLM. The system prompt for the chat agent (`apps/web/src/lib/workspace/agent.ts`) includes a `<language>` block populated from the workspace's preferred language.

Stakeholder preferences honor the analyst-language vs stakeholder-language distinction: Maria might be Italian (stakeholder default) but the analyst writing the brief might be English. The brief language follows the stakeholder's preference (per `stakeholder.preferences.structured.language`).

### 9.4 Edge cases

- Mixed-language workspaces (some scopes Italian, some English): scope-level language override exists. Falls back to workspace default.
- Italian text 20% longer than English: column widths and button labels accommodate. All Italian copy reviewed at narrow viewport.
- Numeric localization across surfaces: a deck rendered in Italian uses Italian conventions; the same deck exported as XLSX uses Italian locale numerics.
- User changes language mid-session: existing chat messages stay in their original language; new messages and UI chrome switch.

### 9.5 Latency budget

- Locale detection: < 16ms (browser API).
- Language switch: < 80ms perceived (i18n bundle is preloaded; just swap).
- All UI strings render in chosen language at first paint (no flash of English).

---

## 10. Mobile and narrow viewport

### 10.1 Breakpoints

```ts
export const breakpoint = {
  mobile:   "0px to 639px",
  tablet:   "640px to 1023px",
  laptop:   "1024px to 1279px",
  desktop:  "1280px to 1535px",
  wide:     "1536px+",
} as const;
```

Container queries (CSS) where possible, breakpoints where component depends on viewport.

### 10.2 Layout per breakpoint

| Zone | Mobile | Tablet | Laptop | Desktop+ |
|---|---|---|---|---|
| Sidebar | Hidden, hamburger | Icon rail (56px) | Full (240px) | Full (280px) |
| Main | Full width | Full width | Full width | Center column |
| Aside | Bottom sheet on demand | Drawer on demand | Tab on right edge | Always visible (320px) |

### 10.3 Chat surface on mobile

The chat composer pins to viewport bottom (`position: fixed`) within the safe-area inset. Mobile keyboards push it up; messages scroll behind. Same pattern as iMessage / WhatsApp / Granola mobile.

Tool chips collapse to single-line summaries with click-to-expand. Approval cards stack vertically with full-width buttons (44px tall minimum for thumb reach).

### 10.4 Onboarding on mobile

Onboarding works on mobile at parity with desktop. Each step is full-screen card with one focal action. Drop-file step accepts file picker (no drag-drop on mobile).

### 10.5 Edge cases

- Landscape orientation on phone: aside becomes a side tab again (small enough to fit). Sidebar stays hidden.
- iOS safe-area insets: respected via `env(safe-area-inset-*)` for the chat composer.
- Soft keyboard on mobile: chat composer stays above keyboard; message thread scrolls.
- Tablet split-screen (iPad): the workspace becomes a tablet-sized view in its half.
- Browser zoom 200%: layout reflows; no horizontal scroll on main surface.

### 10.6 Latency budget

- Mobile chrome (iOS Safari, Android Chrome): same sub-50ms targets as desktop. Mobile networks often add 100-200ms; mitigate via prefetch, optimistic UI, View Transitions.

---

## 11. Density rules for chat (multiple cards stacked)

When a single assistant response renders multiple cards (e.g., `draftBrief` produces a BriefDraftCard + 3 StakeholderCards + several MemoryReadChips referenced inline), apply these density rules:

### 11.1 Vertical density

- Maximum 3 full cards in a row before switching to compact rendering.
- 4th and beyond: render as compact list rows (40px tall, single line of content).
- "Show all (N) →" link expands to full cards in an inline drawer (not a modal).

### 11.2 Horizontal density

- Cards default to full message-column width (typically 640-720px).
- Stakeholder cards specifically: 3 across at 224px each in a horizontal scroll if more than 3 are referenced.
- Tool chips inline with text: max 5 chips in a row before wrapping.

### 11.3 Collapse-by-default for nested content

- Cited sources in retrieveContext output: collapsed by default, click to expand.
- Memory entries from readMemory: top 5 visible, "+ 7 more" footer.
- Research telemetry detail: collapsed; click expands the scrape list.

### 11.4 Vertical rhythm

- Between cards in a stack: 12px gap (`space[3]`).
- Between message turns (user → assistant): 24px gap (`space[6]`).
- Between sections within a turn (text → chips → cards → buttons): 8px gap (`space[2]`).

This rhythm matches Notion's adjacency-aware spacing pattern (March 18 2026): same-type adjacent elements get tight gaps, different-type elements get larger gaps to signal hierarchy.

### 11.5 Edge cases

- Single card response: render at full width, no compression.
- Response with no cards (just text): use the message-text vertical rhythm (8px line gap, 24px paragraph gap).
- Mid-stream card insertion: cards animate in with 180ms ease-out, no layout jump.

---

## 12. Acceptance criteria

### 12.1 Scope landing redesign

- [ ] Walking into a scope shows: scope name + caption row + Stakeholders strip + "Workspace knows" rows + Recent deliverables + Suggested next + chat composer at bottom (in this order, top to bottom).
- [ ] Empty stakeholder section is hidden, not shown empty. Same for Recent deliverables.
- [ ] "Workspace knows" is always visible with at-glance counts.
- [ ] Clicking the chat composer triggers View Transitions API morph to active chat layout in 300ms.
- [ ] Pressing ESC from active chat layout returns to landing in 300ms.
- [ ] Compact context header in active chat layout shows scope name + key counts + ← back button.

### 12.2 Workspace home

- [ ] Default route when no scope selected.
- [ ] Time-of-day greeting in the user's preferred language.
- [ ] "This week, Basquio learned X new things" line is accurate to the last 7 days of memory_entries + facts created.
- [ ] "Suggested for today" max 3 cards, server-side generated.
- [ ] "Active scopes" cards show updated-time relative.
- [ ] "This week" stats render only after 7 days of activity; before then, show onboarding hint.

### 12.3 Empty states

- [ ] Brand-new workspace shows the welcome card with locked sub-hero copy and "Set up workspace" button.
- [ ] Sparse workspace shows section-specific prompts (e.g., "Add your first stakeholder") with chat-driven option called out.
- [ ] Italian copy is fully localized including examples.
- [ ] No section uses generic "nothing here" copy.

### 12.4 Onboarding

- [ ] 3-step flow: Name your scopes / Drop one document / Add one stakeholder.
- [ ] Each step is its own URL (`/onboarding/1`, `/onboarding/2`, `/onboarding/3`); refreshing resumes.
- [ ] Step 2 extraction streams entity reveals progressively in the UI.
- [ ] Step 3 pre-suggests people extracted in Step 2 if any.
- [ ] After Step 3, user lands on the first scope's landing page; chat fires `explainBasquio(topic: "what_you_know_about_me")` automatically.
- [ ] Each step skippable; resumable from any point.

### 12.5 Suggested actions

- [ ] Scope landing "Suggested next" max 3 cards, contextual to scope state.
- [ ] Workspace home "Suggested for today" max 3 cards, cross-scope.
- [ ] Inline post-message chips max 3, dismiss on click or next user message.
- [ ] Dismissed suggestions don't repeat for 7 days.
- [ ] Italian suggestions generated in Italian by templated translation, not runtime LLM call.

### 12.6 Loading and transitions

- [ ] All skeletons use opacity pulse 0.3-0.55, never shimmer.
- [ ] All scope navigation uses View Transitions API.
- [ ] All modals/drawers use Motion v12 spring config.
- [ ] Sidebar collapse uses `useOptimistic` for instant state flip.
- [ ] No spinner appears outside dedicated `Spinner` component contexts.
- [ ] No banned loading pattern (per §8.8) appears anywhere.
- [ ] `prefers-reduced-motion` respected: skeletons static, View Transitions disabled, motion replaced with opacity-only.

### 12.7 Bilingual

- [ ] Locale detected from browser, defaulting Italian users to Italian UI.
- [ ] All static UI strings localized in `apps/web/src/i18n/it.ts`.
- [ ] Italian numeric and date formats applied per Designers Italia.
- [ ] Language switch in settings is instant.
- [ ] Stakeholder preference language overrides workspace default for that stakeholder's deliverables.

### 12.8 Mobile

- [ ] Layout works at 375px viewport width without horizontal scroll.
- [ ] Sidebar collapses to hamburger on mobile.
- [ ] Aside becomes bottom sheet on mobile.
- [ ] Chat composer respects iOS safe-area-inset-bottom.
- [ ] Onboarding works on mobile at parity with desktop.
- [ ] Tablet split-screen (768px) functional.

### 12.9 Density

- [ ] Maximum 3 full cards in a vertical stack before switching to compact rows.
- [ ] Stakeholder card horizontal strip scrolls horizontally for >3 entries.
- [ ] Cited sources collapse by default, click to expand.
- [ ] Vertical rhythm: 12px between cards, 24px between turns, 8px between sections within a turn.

### 12.10 Latency

- [ ] Sidebar item click navigates in < 50ms perceived (View Transitions + prefetch).
- [ ] Modal/drawer open in < 80ms perceived.
- [ ] Sidebar collapse in < 50ms perceived (optimistic).
- [ ] Workspace home renders in < 80ms perceived (server-side rendered, 60s stat cache).
- [ ] Scope landing renders in < 80ms perceived.
- [ ] Chat composer focus in < 16ms (native).
- [ ] Suggested-actions cards render in < 80ms perceived (5min cache).
- [ ] Empty states render in < 50ms (no fetch needed).
- [ ] Tool chip render (input phase) in < 50ms.
- [ ] No interactive UI element exceeds its budget without a "trick the mind" transition that completes the visual state at click time.

---

## 13. Build sequence

### Week 1 (foundation)

**Day 1 — design system primitives**
- Create `apps/web/src/lib/design-tokens/` with `space.ts`, `type.ts`, `color.ts`, `radius.ts`, `motion.ts`, `breakpoint.ts` per §3.
- Update existing `docs/design-tokens.md` to reference these as canonical.
- Visual regression test setup (Chromatic or Playwright): snapshot every primitive.

**Day 2 — three-tier layout**
- Replace `wbeta-workspace-layout` with the `WorkspaceShell` component implementing §4.1.
- Container queries for breakpoint-driven zone behavior.
- Sidebar component per §4.2 with optimistic collapse.

**Day 3 — scope landing redesign**
- New `ScopeLandingPage` component per §4.3.1.
- Active chat layout per §4.3.2 with View Transitions API for the morph.
- Aside panel per §4.4.1 (workspace memory transparency).

**Day 4 — workspace home**
- New `WorkspaceHomePage` component per §4.5.
- Time-of-day greeting (i18n).
- "This week" stats aggregation (server-side, 60s cache).
- Suggested-for-today server-side suggester (per §7.2).

**Day 5 — empty states + onboarding**
- Three empty-state grades per §5.
- 3-step onboarding flow per §6 with state-per-URL.

### Week 2 (polish)

**Day 6 — loading states**
- Skeleton component per §8.1 with three densities.
- Tool chip state transitions per §8.2.
- Approval card progressive reveal per §8.4.

**Day 7 — transitions and motion**
- View Transitions API integration per §8.5.
- Motion v12 setup, spring presets, modal/drawer per §8.7.
- Optimistic sidebar collapse per §8.6.

**Day 8 — suggested actions**
- Server-side suggester service per §7.
- Three placement surfaces (scope landing, workspace home, inline post-message).
- Dismissal tracking and 7-day suppression.

**Day 9 — bilingual chrome**
- i18n bundles for `en` and `it` per §9.
- Italian numeric/date formatting helpers.
- Locale detection on first login.
- Language switch in settings.

**Day 10 — mobile + density + QA pass**
- Mobile layout per §10.
- Density rules in chat per §11.
- Manual test all acceptance criteria in §12.
- Visual regression suite passes.
- Ship behind feature flag `workspace_shell_v2_enabled`.

### Week 3 (stretch)

**Days 11-15:**
- Fine-tune motion curves with Marco's review.
- Italian copy review with Rossella, Veronica, Giulia.
- Visual review with a designer (external if needed).
- Mobile testing on real devices (iOS Safari, Android Chrome).
- Accessibility audit (axe-core CI integration, keyboard nav full traversal, screen reader).
- Performance audit: Lighthouse 95+ on every workspace route.

---

## 14. Risks and open questions

**R1: Designer-quality craft is hard to ship as code.** This spec describes the system; the implementation will only feel right if the implementation agent treats craft as the primary deliverable, not a secondary one. Mitigation: Day 11-12 visual review with Marco before shipping. If the result feels generic, iterate before unflagging.

**R2: View Transitions API has limited Safari support.** Older Safari versions fall back to instant navigation without animation. Functionality unchanged, polish reduced for Safari users. Acceptable trade-off for v1.

**R3: Italian copy quality requires a native speaker review.** The design agent can write Italian copy from the locked English source, but Rossella, Veronica, or Giulia must review before ship. Not a blocker; flag the strings for review and ship behind flag.

**R4: 3-step onboarding still feels like a tutorial.** Some users skip everything. The fallback path (chat is the universal entry point) exists, but if too many users skip, onboarding completion needs measurement and iteration. Acceptable to ship and measure.

**R5: Suggested actions can feel pushy if too frequent.** v1 ships with the 3-card-max constraint and 7-day dismissal suppression. If user feedback says it's too much, easy to lower thresholds. Not a blocker for ship.

**R6: Mobile is a real surface but not the primary one.** Most CPG analysts work on laptops with 13-16" screens. Mobile is "I need to check something quick on my phone" use case. v1 functional but not optimized. v2 polishes.

**R7: The chat-spec sibling needs the new approval card components.** This spec defines the design system; the chat spec wires the approval cards. Build order matters: Day 1-2 of this spec ships before Week 2 of the chat spec.

**R8: V2 IA decisions in `docs/spec-v1-workspace-v2-research-and-rebuild.md` (8 locked decisions) overlap with this spec.** Mostly aligned, but if any decision conflicts, this spec is more recent and should win. Implementation agent flags conflicts to Marco before resolving.

**Q1: Light mode or dark mode default for Basquio?** Spec defines both; question is which is the default. Linear defaults dark. Anthropic defaults light. CPG analyst preference unknown. Recommendation: dark mode default for the workspace surface, light mode default for marketing/landing. Ship with system-preference detection.

**Q2: Does the workspace home replace today's `/workspace` route entirely, or live at a new route?** Recommendation: replace, with a redirect from `/workspace/team` (the current home) to `/workspace`. Keep deep links to specific scopes working.

**Q3: How does the existing `workspace-generation-drawer.tsx` integrate with the new chat layout?** It's a right-side drawer today. In the new three-tier layout, it overlays the aside zone temporarily. Keep current behavior; no rebuild needed.

**Q4: What's the Italian translation source-of-truth?** Spec recommends `apps/web/src/i18n/it.ts`. Implementation agent may propose a translation tool (e.g., Locize, Phrase). Either works.

**Q5: Designer review process?** This spec doesn't propose a designer in the loop. Marco's review is the design review for v1. If the team grows or visual issues persist, hire a designer or contract one for Days 11-12.

---

## 15. Summary for the implementation agent

You are building the workspace shell that surrounds the chat. Do not rebuild the chat itself (sibling spec covers that). Build:

- 7 new design tokens (space, type, color, radius, motion, breakpoint, animation primitives)
- 1 three-tier layout shell (sidebar / main / aside)
- 1 scope landing redesign (context-strip first, chat at the bottom)
- 1 workspace home dashboard
- 3 empty-state grades
- 1 onboarding flow (3 steps)
- 1 suggested-actions surface (3 placements)
- 1 loading-state system (Skeleton + tool-chip-states + progressive reveals)
- 1 bilingual chrome (Italian default for Italian users)
- Mobile layout for all of the above
- Density rules for chat with stacked cards

Existing contracts you must honor:

- AI SDK v6 chat component at `apps/web/src/components/workspace-chat/Chat.tsx` (do not replace; wrap in new shell)
- `agent-tools.ts` chat tools (do not modify; sibling spec extends)
- `WorkspaceContextPack` schema (do not modify)
- 5 design golden rules in `memory/feedback_design_golden_rules.md` (apply to every component)
- Working rules in `docs/working-rules.md` (no em dashes, no emojis, sentence case)

Estimated effort: 10 working days for v1 + 5 stretch days for visual review and polish.

When in doubt, read the SOTA references in §2 and the existing components in `apps/web/src/components/workspace-chat/` and `apps/web/src/app/(workspace)/`. This spec is the design contract; the implementation makes it real.

The single most important sentence in this spec is from Rule 3: every spacing value must be deliberate, every motion curve picked not defaulted, every empty state crafted. The product's design is itself product evidence. If a future Basquio user opens the workspace and immediately reads "this is what a serious tool looks like," you've shipped what this spec asked for.
