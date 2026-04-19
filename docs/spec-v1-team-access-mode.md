# V1 Team Access Mode — spec

**Status:** ready to build
**Scope:** feature flag that exposes the V1 Workspace (Motion 2 Tier 2a) to `@basquio.com` users only, on the live basquio.com domain. No Vercel preview URL. No separate Supabase project. No dev-environment ceremony.
**Reason:** co-founders need to dogfood the Workspace on real data as it gets built, without blocking production or introducing a separate auth surface. Everything else stays hidden to external users.

---

## The decision

Do not create a separate Vercel URL. Do not fork the repo. Do not spin up a parallel Supabase.

Instead: gate the V1 Workspace routes behind a simple email domain check and a feature flag stored in user metadata. Development happens on `main`, deploys continuously to `basquio.com`, and is invisible to every user whose email does not end in `@basquio.com`.

---

## Scope

### Visible to @basquio.com users only

- New route group `(workspace)` alongside existing `(app)` and `(auth)` in `apps/web/src/app/`
- Navigation entry point "Workspace (beta)" visible only on the account dropdown for `@basquio.com` users
- All `(workspace)/*` routes return 404 for non-team users (even if they manually type the URL)
- All Supabase writes from `(workspace)` routes include `is_team_beta = true` so production analytics and reports can filter them out
- All Stripe activity from the Workspace surface is bypassed (team users are unlimited per existing `feedback_basquio_unlimited` memory rule)

### Not in scope

- Separate auth provider
- Separate Supabase instance
- Feature flag service (LaunchDarkly, Statsig, Flipt)
- Preview deployments
- Environment variables for gating
- Any UI affordance for non-team users (no "coming soon" teaser, no waitlist form, nothing)

---

## User flow

### Co-founder login flow

1. Co-founder (Marco, Alessandro, Rossella, Francesco, Giulia, Veronica, or any other `@basquio.com` user) logs in at basquio.com via existing Supabase auth
2. They see the existing `(app)` shell (dashboard, jobs, templates, etc.)
3. Account dropdown shows an extra item: "Workspace (beta)" with a small `beta` pill
4. Click navigates to `/workspace` which renders the V1 Workspace
5. Exit via the same dropdown to return to the main app

### External user flow

1. External user logs in at basquio.com
2. They see the existing `(app)` shell with no trace of Workspace
3. If they manually type `/workspace` or any `/workspace/*` URL, they get a standard 404 (same as any unknown route)
4. Zero cookies, flags, or UI hints leak the existence of the Workspace

---

## Technical approach

### Gate logic

Single source of truth for "is this user team beta eligible" in a server-side helper:

```ts
// apps/web/src/lib/team-beta.ts
import { createServerClient } from "@/lib/supabase/server";

export async function isTeamBetaEligible(): Promise<boolean> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return false;
  return user.email.toLowerCase().endsWith("@basquio.com");
}
```

No extra table, no feature flag system. One function. Returns boolean.

### Route protection

Next.js middleware or `layout.tsx` in `(workspace)` route group:

```ts
// apps/web/src/app/(workspace)/layout.tsx
import { notFound } from "next/navigation";
import { isTeamBetaEligible } from "@/lib/team-beta";

export default async function WorkspaceLayout({ children }) {
  if (!(await isTeamBetaEligible())) notFound();
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
```

Returning `notFound()` gives a clean 404 response identical to any unknown URL. No leak.

### Navigation surface

In the existing account dropdown (`apps/web/src/app/(app)/layout.tsx` or wherever the dropdown lives), add a team-gated menu item:

```tsx
{isTeamBeta && (
  <Link href="/workspace" className="...">
    Workspace <span className="beta-pill">beta</span>
  </Link>
)}
```

Fetch `isTeamBeta` via the helper, pass down as a prop. Never a client-side env var.

### Data isolation

All `(workspace)` routes write to Supabase tables with `is_team_beta = true` (new nullable column added to relevant tables: `knowledge_documents`, `knowledge_chunks`, `transcript_chunks`, `entities`, `entity_mentions`, `facts`, `memory_entries` when those ship). Production analytics (weekly digest, customer reports) filter by `is_team_beta IS NULL OR FALSE` to exclude team dogfood traffic.

This avoids accidental pollution of real customer metrics.

### Deploy

Standard deploys from `main` to `basquio.com`. No preview branches. No feature flag rollout. If the Workspace breaks for team users, it does not affect any external user because the route is 404 for them.

---

## Acceptance criteria

- Marco logs into basquio.com, sees "Workspace (beta)" in account dropdown, clicks it, lands on the V1 Workspace
- Andy Howard (external user) logs into basquio.com, sees no trace of Workspace in any menu, direct URL `/workspace` returns 404
- Weekly digest does not include team-beta traffic in customer metrics
- Team can merge, deploy, iterate on `(workspace)` daily without touching the production `(app)` surface
- A new `@basquio.com` user that joins gets access automatically on first login (no manual allowlisting)

---

## Out of scope (do not build)

- "Waitlist" or "coming soon" pages for external users
- A/B test framework
- Gradual rollout percentages
- Admin UI to manually grant workspace access to non-team users (if we ever need it, add it then)
- Separate Git branch strategy

---

## Files touched

- `apps/web/src/lib/team-beta.ts` (new, single helper function)
- `apps/web/src/app/(workspace)/layout.tsx` (new, route group + gate)
- `apps/web/src/app/(app)/layout.tsx` (edit: add dropdown item gated by helper)
- Supabase migration: add `is_team_beta BOOLEAN` to whichever tables the workspace writes (do this as part of V1 Workspace build, not this spec)

---

## Timeline

For Marco's shipping pace: 1 session, 2 to 3 hours including deploy and smoke test on his own login. Ship this first, then every V1 Workspace iteration after it ships directly into the gated route.
