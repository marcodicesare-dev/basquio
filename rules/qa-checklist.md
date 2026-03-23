# QA Checklist

## Context QA

- `pnpm qa:basquio` passes
- architecture, memory, and decision log agree
- required files exist
- contracts compile and export expected schemas
- Supabase REST selects in runtime code match the migrated table columns
- production-facing orchestration changes have an explicit stale-run recovery path

## Product QA

- deterministic analytics run before LLM planning
- every generated insight carries evidence
- story is traceable back to data
- PDF and PPTX outputs map to the same slide plan
- output artifacts open successfully

## Template QA

- uploaded `.pptx` templates expose usable layouts and placeholders
- `.pdf` inputs are marked as style references
- unsupported template fidelity claims are not exposed in UI

## Chart QA

- charts in the direct deck path are embedded as raster screenshots, not native Office chart XML
- PPTX packages with charts must not contain `ppt/charts/*.xml`
- PPTX packages with charts must contain raster media assets under `ppt/media/`
- the same chart image asset should drive PPTX and PDF output
- no preview-only dependency blocks export

## Layout QA

- recommendation and action cards must not depend on stacked decorative numerals or floating footer metrics that can drift across viewers
- dense card text should use cross-viewer-safe fonts unless a customer template explicitly overrides them
- card layouts must reserve separate non-overlapping bands for title, body, and footer content

## Release Gate

Before shipping a meaningful architectural change:

```bash
pnpm qa:basquio
pnpm typecheck
pnpm build
```
