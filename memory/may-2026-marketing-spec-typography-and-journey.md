# Marketing baseline V2 spec — typography consistency + end-to-end journey

> Written for the next agent picking up baseline (`codex/marketing-variant-j-claude-rebuild`)
> from Path V (May 2 evening) onward. Marco called out two structural gaps that
> Path V did not solve: typography is inconsistent across home + compare + about,
> and the user journey from CTA click to outcome (estimate / signup / Discord
> notify) is not wired end to end. Both need an audit pass and an implementation
> plan before more visual polish is shipped.

## Context

Path V (May 2) shipped:
- Pricing card copy cut ~50%, € currency switch, "output" → "analysis" rename
- Image figcaptions removed from the four SVG mockups
- Workspace section copy already in Legora style

What Path V did NOT touch:
- Typography consistency across `/` (home), `/compare`, `/about`
- Hero / nav / footer CTA hrefs are still placeholder routes (`/jobs/new`, `/get-started`, `/about`) with no end-to-end wiring
- No mechanism for "team interested" → Discord `#customers` channel notification

## Workstream 1 — typography consistency audit

### What's wrong (Marco's quote)

> "typography design across home page + compare + about is pure trash slop
> inconsistent. sometimes there's bold type, sometimes are heading, sometimes
> not, sometimes left centered sometimes right, sometimes in 3 lines sometimes
> in 2. pure ai slop inconsistent garbage. BE CONSISTENT AND MAKE THIS WORK
> AGENCY DESIGN GRADE."

### Diagnostic to run first

Before touching any code, run a typography map across the three pages. For each
page, screenshot and catalog every text token with:

- font-family (Manrope vs JetBrains Mono vs body default)
- font-size (resolved, not the clamp source)
- font-weight (400 / 500 / 600 / 700 / 800)
- text-align (left / center / right)
- max-width / line count target
- color token (--text / --text-soft / --text-muted / --blue / inherit)
- usage role (eyebrow / page title / section title / body / link / pill / cta)

Pages to audit in this order:
1. `apps/web/src/app/page.tsx` — home (hero + workflow + workspace + pricing + workbook + security + footer CTA)
2. `apps/web/src/app/compare/page.tsx` — compare page
3. `apps/web/src/app/about/page.tsx` — about page

Also audit the shared components used across all three:
- `marketing-hero-j.tsx` (home only)
- `workflow-big-blocks.tsx` (home only)
- `motion-workspace-mockup.tsx` (home + about?)
- `marketing-pricing-j.tsx` (home + /pricing)
- `public-site-nav.tsx` (all pages)
- `public-site-footer.tsx` (all pages)
- `public-site-footer-cta.tsx` (home + about + others)

### Target type scale (proposal — verify against existing tokens before locking)

Single canonical scale. No `clamp` per-element overrides. Set tokens once in
`global.css`, re-use everywhere.

```
--font-display: "Manrope", system-ui, sans-serif      [headlines, page titles, CTAs]
--font-mono:    "JetBrains Mono", ui-monospace        [eyebrows, monospace metadata, file pills]
--font-body:    "Manrope", system-ui, sans-serif      [body, links]

--type-hero:        clamp(2.6rem, 4.4vw, 3.8rem)  weight 800  line-height 1.04  letter-spacing -0.018em
--type-page-title:  clamp(2.0rem, 3.0vw, 2.6rem)  weight 700  line-height 1.10  letter-spacing -0.020em
--type-section:     clamp(1.5rem, 2.0vw, 2.0rem)  weight 700  line-height 1.16  letter-spacing -0.020em
--type-card-label:  1.18rem                       weight 700  line-height 1.20  letter-spacing -0.018em
--type-body-lg:     1.05rem                       weight 500  line-height 1.55
--type-body:        0.96rem                       weight 500  line-height 1.55
--type-body-sm:     0.86rem                       weight 500  line-height 1.50
--type-eyebrow:     0.74rem                       weight 700  line-height 1.20  letter-spacing 0.18em uppercase
--type-mono-sm:     0.78rem                       weight 600  line-height 1.40  letter-spacing 0.04em
--type-mono-xs:     0.66rem                       weight 600  line-height 1.40  letter-spacing 0.06em
```

### Alignment rules

- **All section heads centered on home and about**. Compare can stay centered for
  hero, but tabular comparison content must be left-aligned consistently.
- **Body copy max-width 56ch under centered heads, 64ch under left-aligned
  heads**. No exceptions.
- **CTAs are flex items**, not floated. Primary first, secondary second, trust
  link below in a separate row.
- **Eyebrows always above the title with 8-10 px gap**, never inline with title.

### Section head pattern (reusable)

Every section on home + about + compare uses this pattern, no exceptions:

```jsx
<header className="section-j-stack-head">
  <p className="section-j-eyebrow">{eyebrow}</p>
  <h2 className="section-j-title">{title}</h2>
  <p className="section-j-body">{body}</p>
  {link && <Link className="section-j-link" href={link.href}>{link.label} →</Link>}
</header>
```

Bake the eyebrow / title / body / link spacing into a single CSS rule on
`.section-j-stack-head` and stop overriding it per section.

### Bold / weight rules

- Eyebrows: 700, all caps, mono.
- Section titles: 700, sans, mixed case.
- Body: 500.
- Inline emphasis inside body: 700 only on numbers and proper nouns. No bold
  for "we" or generic copy phrases.
- Links inside body: blue + medium underline, not bold.

### Implementation order

1. **Audit** (no code changes). Produce `docs/2026-05-may-typography-audit.md`
   listing every offender with file:line and the violated rule.
2. **Tokens**. Add the type scale variables to `global.css` near the top of
   the variant-J section.
3. **Replace per-element CSS** for:
   - `.hero-j-headline` → `--type-hero`
   - `.section-j-title` → `--type-section`
   - `.section-j-page-title` → `--type-page-title`
   - `.section-j-body` → `--type-body`
   - `.section-j-eyebrow` → `--type-eyebrow`
   - `.buying-iface-card-label` → `--type-card-label`
   - `.workflow-big-step-title` → `--type-card-label`
4. **Remove element-specific font-size + weight + letter-spacing overrides** that
   conflict with the tokens. Specifically the "Calmer type scale" override block
   at line ~23120 of `global.css` should be deleted now that tokens exist.
5. **Verify the three pages** at desktop (1440px) and mobile (390px) widths.
   Take screenshots, attach to the PR.

### Done when

- A reviewer can open home, about, compare in three browser tabs and the three
  page-title / section-title / body / eyebrow tokens render at exactly the same
  size and weight on equivalent elements.
- No element on those pages has a `font-size` override that is not the token
  variable.
- Bolding only appears on titles, eyebrows, and intentional inline emphasis.

## Workstream 2 — end-to-end journey wiring

### What's wrong (Marco's quote)

> "You need to think about how to connect everything now with real end to end
> journey: user clicks, get to a place where things gets estimated, or to
> signup checkout for the workspace, or to a form that sends a message to
> discord #customers as when user signs up if user with team wants to setup
> etc..."

### Three journeys to wire

#### Journey A — One analysis CTA → estimate page

**Trigger**: clicks on `/jobs/new` link from any of: hero "Start one analysis"
button, footer CTA, pricing One-tier "Estimate one analysis" button.

**Current state**: `/jobs/new` route exists in the workspace app but is
authenticated. Anonymous click currently bounces to login. That's wrong for
the marketing CTA — anonymous visitors need a way to estimate before signing up.

**Required end state**:
- `/jobs/new` accessible anonymously
- Anonymous user uploads brief + data files into a quick-estimate form
- Backend computes a price estimate and shows it inline, before signup
- "Pay €X to run this analysis" CTA on the estimate result triggers either:
  - Stripe Checkout (one-time, no account required), OR
  - Account creation + checkout if user prefers
- Post-payment, user gets a magic-link login email tied to the run

**Files to touch** (audit first, then plan):
- `apps/web/src/app/(app)/jobs/new/page.tsx` (or wherever the route is)
- New: `apps/web/src/app/jobs/new/page.tsx` — anonymous-allowed variant
- `apps/web/src/app/api/estimate/route.ts` — public estimate endpoint
- Stripe client + webhook setup if not yet wired for one-time

#### Journey B — Workspace 7-day trial → signup checkout

**Trigger**: clicks on `/get-started` link from pricing Workspace tier "Start
a 7-day trial".

**Current state**: `/get-started` exists but the trial flow needs to:
1. Capture email + name + company on a clean signup form
2. Take card upfront (Stripe trial)
3. Charge €199 on day 7 unless cancelled
4. Provision the workspace immediately on signup

**Required end state**: this is mostly already there. Audit the existing
`/get-started` route and confirm:
- Email + card collection works
- Stripe trial subscription is configured with day-7 charge
- Cancellation before day 7 stops the charge cleanly
- New workspace is provisioned immediately at signup, not at day 7

**Files to touch**: `apps/web/src/app/get-started/page.tsx`, Stripe products,
billing actions component.

#### Journey C — Team pilot CTA → Discord #customers notification

**Trigger**: clicks on `/about` link from pricing Team tier "Talk to us"
button. (The CTA currently goes to /about which is wrong — it needs a
contact form, not the about page.)

**Current state**: nothing wired. /about is the team page.

**Required end state**:
- New page `/team-pilot` or `/contact` with a short form: name + work email + company + team size + message
- Form submission posts to a Discord webhook for the `#customers` channel
- Submission also creates a CRM lead row (Supabase `crm_leads` table or similar)
- User sees a "We will be in touch within 24 hours" confirmation
- Discord message format includes: name, company, team size, message, email, timestamp

**Discord webhook setup**:
- Generate a webhook URL on the Basquio Discord, `#customers` channel
- Store as `BASQUIO_DISCORD_CUSTOMERS_WEBHOOK` in env
- Server-side POST from the form action, never expose webhook URL client-side

**Files to touch**:
- New: `apps/web/src/app/team-pilot/page.tsx` (form page)
- New: `apps/web/src/app/api/team-pilot/route.ts` (form handler + Discord webhook)
- Pricing card href change: Team tier `ctaHref: "/about"` → `ctaHref: "/team-pilot"`
- Env: add `BASQUIO_DISCORD_CUSTOMERS_WEBHOOK`

### Cross-journey requirements

- **No client-side secrets**. Discord webhook + Stripe price IDs server-side only.
- **Form submissions are idempotent**. If the user double-submits, only one
  Discord message + one CRM row.
- **Magic-link login** is the post-purchase auth mechanism for Journey A
  (anonymous estimate buy), not password.
- **All three journeys log to PostHog** (or whatever analytics is wired): event
  names `estimate_clicked`, `estimate_paid`, `trial_started`, `team_pilot_submitted`.

### Audit deliverables

The next agent should produce:
1. `docs/2026-05-may-journey-audit.md` listing the current state of each route
   referenced by a marketing CTA. For each: status, what works, what doesn't,
   what needs to change.
2. `docs/2026-05-may-journey-implementation-plan.md` listing the sequence of
   PRs to ship Journey A, B, C end to end. Each PR sized to ~1-2 days of work.
3. Implementation in the order: C (Discord webhook, lowest blast radius) → B
   (trial flow audit, mostly existing) → A (anonymous estimate, biggest lift).

## Out of scope for this spec (future work)

- Compare page redesign (Marco hasn't reviewed it yet at the May 2 cutoff)
- Pricing page (`/pricing`) standalone version, currently mirrors home buying
  interface
- Localization beyond Italian variant
- Cross-variant cherry-pick mechanics (already documented in May 1 handoff)

## Sequencing recommendation

Don't do typography and journey wiring in the same PR. Land typography first
(visible win, low risk), then journey wiring (bigger ICE, more backend
coupling, more rollback risk).

If you must pick one to land first under time pressure: do **Journey C** (Discord
webhook for team pilot). It's the lowest-effort change with the highest
business impact — every team-pilot lead is a potential €5-30k/year contract
per the May 2 GTM transcripts, and right now they go nowhere.
