# March 25 Product Polish Spec

This document captures the feedback audit behind the next quality pass after the crash/reliability fixes.

The goal is not to add random surface polish. The goal is to make Basquio feel trustworthy, private, coherent, and operationally calm across the public site and the workspace.

## What Was Wrong

### Public proof assets leaked client-style names

- The homepage showcase used visible brand names and source labels that looked too close to paid client work.
- This created avoidable trust drag on the public site.

### Trust copy overreached

- `10+ years in NielsenIQ-grade reporting` read like a certification claim instead of operator provenance.
- Privacy positioning was present in product surfaces, but not packaged clearly enough on the public site.

### Pricing language was underspecified

- The pricing snapshot headline wrapped awkwardly at some widths.
- The individual plan implied a flat simple rule, while the real credit logic depends on scope, slide count, and workflow complexity.

### Workspace nav semantics were muddy

- The logo and the primary nav both routed to the same workspace page.
- Logged-in users had no clean path back to the public site without feeling like they had to sign out.

### Long-run experience still had a product hole

- Reliability work reduced real stalls, but the in-progress screen still behaved like a page the user had to babysit.
- There was no explicit handoff pattern for leaving the page and coming back later.

## What Ships Now

### 1. Sanitized public proof

- Use sanitized showcase assets on the homepage.
- Remove visible client-style brand names from the public proof slides.
- Keep the public proof specific enough to feel real, but generic enough to avoid exposing internal-looking work.

### 2. Trust and privacy calibration

- Replace overclaimed operator copy with direct provenance language.
- Surface `private workspace by default` as a public trust signal.
- Do not claim `closed AI` until there is a verified architecture and policy position to support it.

### 3. Pricing clarity

- Shorten the homepage pricing snapshot headline so it behaves better responsively.
- Add a compact pricing note explaining that credits and report type depend on scope, slide count, and workflow complexity.
- Mirror the same clarification on the full pricing page and the get-started page.

### 4. Clearer workspace/site navigation

- Make the workspace logo route to the public Basquio site.
- Keep the workspace nav focused on dashboard/report actions.
- Make the dashboard nav item explicit instead of calling both destinations `Home`.

### 5. Better leave-and-return behavior

- The in-progress page should tell users they can leave safely.
- Add direct links back to Reports, Dashboard, and the public site.
- Treat true email notification as a separate product lane, not a fake checkbox with no delivery contract.

## 10/10 Follow-Up Lane

These should be the next polish pass after the current ship.

### A. Real notify-me-later

- Add a persisted notification preference per run.
- Send an email only on terminal states that have artifacts ready or a failure reason.
- Include the run title, status, artifacts, and direct reopen link.

### B. Public proof generation standard

- Generate showcase assets from a dedicated sanitized fixture pack instead of manually maintained sample slides.
- Keep one canonical public proof set for homepage, compare, and social assets.

### C. Privacy posture page upgrade

- Add a sharper public explanation of what is private by default.
- Explicitly distinguish public marketing pages from workspace content.
- Only add stronger AI/data-processing claims after infra and policy review.

### D. Pricing language consistency

- Ensure all surfaces describe the same credit logic.
- Avoid mixing `standard`, `pro`, and `per report` language without the complexity note nearby.

### E. Workspace wayfinding

- Add a symmetric `Return to your workspace` action on public pages when the user is already signed in.
- Keep site navigation and workspace navigation visibly distinct.

## Quality Bar

The product should feel:

- safe to trust with real work
- honest about what is private and what is public
- calm during long-running workflows
- explicit about pricing mechanics
- precise about where the user is: public site vs workspace

If a change does not improve one of those five things, it is probably not part of this polish lane.
