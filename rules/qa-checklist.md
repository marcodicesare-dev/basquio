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

- standard chart families remain editable in PPTX where intended
- advanced charts render deterministically through export-safe paths
- no preview-only dependency blocks export

## Release Gate

Before shipping a meaningful architectural change:

```bash
pnpm qa:basquio
pnpm typecheck
pnpm build
```
