# First Generation Test

Basquio now has a real evidence-package generation path in the web app plus two code-execution-era verification commands:

- `pnpm test:code-exec` for a direct Claude smoke test that must return both PPTX and PDF
- `pnpm test:run --run-id <uuid>` for inspecting a persisted production-style run from Supabase

## App Path

Run the app:

```bash
pnpm dev
```

Then open:

```bash
/jobs/new
```

Current intended test path:

- upload a multi-file evidence package with at least one `.csv` / `.xlsx` / `.xls`
- provide business context plus client, audience, objective, thesis, and stakes
- optionally attach a JSON/CSS brand token file, PPTX template, or PDF style reference
- verify the outline is planned before the slide plan
- generate both `.pptx` and `.pdf`
- download them from `/artifacts`

## Code Execution Smoke

```bash
pnpm test:code-exec
```

This requires `ANTHROPIC_API_KEY` and writes:

```bash
Basquio/test-output/code-exec-smoke/test-deck.pptx
Basquio/test-output/code-exec-smoke/test-deck.pdf
```

## Persisted Run Inspection

```bash
pnpm test:run --run-id <uuid>
```

This requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and writes:

```bash
Basquio/test-output/run-<run-id-prefix>/
```

Files produced when available:

- `deck.pptx`
- `deck.pdf`
- `manifest.json`
- `plan.json`
- `analysis.json`
- `charts/*.png`

## Notes

- the app path is the primary end-to-end product path
- `pnpm test:code-exec` proves the Anthropic Files API + code execution + skills round-trip
- `pnpm test:run --run-id` inspects persisted run truth and should be preferred over legacy local fixture harnesses
