# First Generation Test

Basquio now has a real evidence-package generation path in the web app, plus the deterministic local demo flow.

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

## Command

```bash
pnpm demo:generate
```

## Output

The script writes a deterministic demo run under:

```bash
Basquio/output/demo-local/
```

Files produced:

- `demo-input.xlsx`
- `basquio-deck.pptx`
- `basquio-deck.pdf`
- `job-summary.json`
- `demo-summary.json`

## What The Demo Covers

- workbook creation
- evidence-package parsing and manifest inference
- dataset profiling
- deterministic analysis
- evidence-backed insight generation
- story planning
- report outline planning
- slide planning
- PPTX render
- PDF render

## Notes

- if `BROWSERLESS_TOKEN` is missing, the PDF renderer falls back to a placeholder PDF so the pipeline still completes
- the app path is now the main internal test flow for multi-file evidence-package upload; the demo command remains the fastest deterministic regression check
