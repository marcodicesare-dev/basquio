# First Generation Test

Basquio does not yet have the full upload UI, but the current scaffold can already generate a first PPTX and PDF locally.

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
- `demo-deck.pptx`
- `demo-deck.pdf`
- `demo-summary.json`

## What The Demo Covers

- workbook creation
- SheetJS parsing
- dataset profiling
- deterministic analysis
- evidence-backed insight generation
- story planning
- slide planning
- PPTX render
- PDF render

## Notes

- if `BROWSERLESS_TOKEN` is missing, the PDF renderer falls back to a placeholder PDF so the pipeline still completes
- the PPTX output is a real file, but chart blocks are still placeholder shapes until native chart binding is implemented
- this is the fastest way to validate the Basquio foundation before the next agent builds the upload/auth workflow
