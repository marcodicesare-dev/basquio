# Workspace Upload + Excel Fidelity Spec

## Scope

This spec covers two production gaps found on April 21, 2026:

1. **Workspace chat uploads fail for medium files** even when the file is well under the product-level limit.
2. **`data_tables.xlsx` is useful but not yet production-grade for NIQ workflows** because:
   - decimal formatting is not deterministic
   - workbook-native charts are not guaranteed to visually match the chart screenshot embedded in the PPTX
   - the workbook and deck are generated from the same analysis, but not from the same **presentation contract**

This spec is implementation-oriented and tied to the current Basquio codebase.

---

## Verdict

### A. Workspace upload failure

The failure is real and root-caused.

The production workspace uploader on `main` sends the file body directly to a Vercel function via `multipart/form-data`:
- `apps/web/src/components/workspace-chat/Chat.tsx`
- `apps/web/src/app/api/workspace/uploads/route.ts`

The user-provided HAR proves the request fails **before the route can process it**:
- `POST https://basquio.com/api/workspace/uploads`
- `413 Request Entity Too Large`
- body: `FUNCTION_PAYLOAD_TOO_LARGE`

This is a platform architecture problem, not a CSV parsing problem.

### B. Excel decimals and chart fidelity

Rossella's feedback is also valid.

Basquio currently publishes `data_tables.xlsx`, and now injects native Excel companion charts for supported families, but:
- decimal display is not governed by a deterministic semantic contract
- workbook-native charts are injected from a **minimal manifest binding**, not a **style-complete exhibit spec**
- the current injector uses `openpyxl` default chart styling (`style = 10`) and basic labels, so it cannot guarantee Nielsen/NIQ styling parity with the PPT screenshot

The workbook is therefore directionally correct, but not yet “manual-work-eliminating”.

---

## Forensic findings

## 1. Workspace uploads are architecturally wrong on production

### What is live on `main`

Producer code:
- `apps/web/src/components/workspace-chat/Chat.tsx`
- `apps/web/src/app/api/workspace/uploads/route.ts`

The current workspace chat flow does this:
1. browser creates `FormData`
2. browser posts the whole file to `/api/workspace/uploads`
3. the route reads `await request.formData()`
4. the route reads `await file.arrayBuffer()`
5. the route uploads to Supabase storage from the server
6. the route creates a `knowledge_documents` row

That is incompatible with medium files on Vercel.

### Why it fails

Primary-source evidence:
- Vercel Functions limit the request body to **4.5 MB** and return `413 FUNCTION_PAYLOAD_TOO_LARGE` when exceeded.
- Supabase recommends **standard uploads only for small files** and recommends **resumable uploads for files above 6 MB**.

Your CSV is **6.3 MB**, so it falls into the exact zone where:
- Vercel serverless body upload is already invalid for this architecture
- Supabase recommends resumable upload anyway

### Why `/jobs/new` works better

Basquio already has the correct architecture in the file-first run flow:
- `apps/web/src/app/api/uploads/prepare/route.ts`
- `apps/web/src/components/generation-form.tsx`

That path already does:
- prepare upload targets on the server
- direct signed upload to storage
- resumable upload for files `>= 6 MB`
- no raw file passthrough via the app server

So the workspace uploader is not missing a theory. It is missing reuse of the existing proven pattern.

---

## 2. Decimal rules are currently absent from the durable workbook contract

Rossella provided a valid NIQ formatting rule file:
- `/tmp/attachments/Decimali (1).xlsx`

Extracted rules from that file:
- **Vendite (valore, volume, confezione):** `0` decimals, unless presented in thousands / millions / billions
- **Distribuzione ponderata / numerica / promozione:** `0`
- **TDP:** `0`
- **Intensity index:** `1`
- **Quote:** `1`
- **Prezzi:** `2`
- **Numero medio di referenze:** `1`
- **Indici (prezzo, efficacia promo):** `0`
- **Rotazioni:** `1`
- **Variation values:** same decimal count as the base metric

There is currently no deterministic export layer that takes these rules and applies them to:
- workbook cells
- chart axes
- chart data labels
- narrative markdown tables
- PPT metric chips / chart labels

So formatting quality is still partly incidental.

---

## 3. Workbook-native charts do not carry a full style contract

### Current deterministic chart injection path

Relevant runtime files:
- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/deck-manifest.ts`
- `scripts/native-workbook-charts.py`

Current contract carries:
- chart id
- chart type
- title
- axis labels
- sheet name
- cell anchor
- data signature

What is **not** carried as first-class chart style metadata:
- series colors
- plot/background fills
- gridline color/weight
- axis font / tick label format
- legend placement/styling
- marker shape/size/border
- decimal display / number format
- template-derived palette slot mapping
- screenshot-vs-native fidelity requirements

### Current injector limitations

`scripts/native-workbook-charts.py` does this today:
- picks a basic chart class
- sets `chart.style = 10`
- sets generic width/height/title
- sets simple data labels for some families
- injects the chart

It does **not** deterministically apply the client template or NIQ palette.

This explains Rossella's feedback exactly:
- the chart is “the same” analytically
- but the Excel-native chart is **not visually identical** to the screenshot in the PPT
- colors and formatting drift because the chart screenshot and the workbook chart are rendered by different styling systems

---

## State-of-the-art guidance

### Upload architecture

Primary-source guidance:
- Vercel: request bodies over 4.5 MB must not go through a Function
- Supabase: standard upload is fine for small files; resumable uploads are recommended above 6 MB
- Supabase: signed upload URLs / resumable uploads are the intended browser-to-storage pattern

**State-of-the-art pattern:**
- server prepares upload targets + authorization
- browser uploads directly to object storage
- browser confirms upload to the app server after storage success
- app server creates DB rows and downstream processing jobs from storage metadata, not raw request bodies

That is the correct architecture for Basquio workspace uploads too.

### Excel fidelity architecture

Primary-source guidance:
- `openpyxl` supports workbook styling and scatter charts, but it is not the strongest chart-formatting authoring surface
- `XlsxWriter` exposes significantly richer chart formatting controls for fills, lines, markers, legend, labels, and number formatting

**State-of-the-art pattern:**
- one canonical exhibit contract drives both deliverables
- deck screenshot chart and workbook-native chart are two render targets of the **same exhibit spec**
- decimal rules live in a deterministic semantic formatter, not in freeform model output
- workbook formatting is applied by code, not left to model style drift

---

## Target architecture

## A. Replace workspace raw uploads with prepared direct uploads

### Goal

Make workspace uploads production-grade up to **50 MB** without going through the Vercel request body.

### Target flow

1. user selects file in workspace chat
2. browser computes file metadata and optionally content hash
3. browser calls `POST /api/workspace/uploads/prepare`
4. server validates auth, file type, file size, and workspace ownership
5. server returns:
   - storage path
   - signed upload URL
   - resumable endpoint + token for files `>= 6 MB`
   - upload mode (`standard` / `resumable`)
   - provisional document key / correlation id
6. browser uploads directly to Supabase Storage (`knowledge-base` bucket)
7. browser calls `POST /api/workspace/uploads/confirm`
8. server:
   - verifies uploaded object exists
   - creates or dedupes `knowledge_documents`
   - schedules indexing / processing
   - returns the workspace document id

### Why two-step confirm is required

The current route combines:
- upload
- dedupe
- row creation
- processing kickoff

That only works when the server receives the file body. Once upload goes direct-to-storage, Basquio still needs a confirm step to create durable DB state.

### Required behavior

- app-level workspace upload cap becomes **50 MB**
- upload mode rules:
  - `< 6 MB`: standard signed upload acceptable
  - `>= 6 MB`: resumable upload required by default
- UI shows real error states, not only `Upload failed.`
- content-hash dedupe remains supported
- no workspace upload should ever depend on Vercel request body size

### Reuse, don’t fork

Reuse the existing `/jobs/new` upload architecture:
- `apps/web/src/app/api/uploads/prepare/route.ts`
- `apps/web/src/components/generation-form.tsx`
- `apps/web/src/lib/supabase/admin.ts`

Do **not** build a third upload stack.

---

## B. Add a deterministic numeric presentation contract

### Goal

Make decimals, unit scaling, and variation display deterministic across:
- deck
- workbook
- markdown report
- chart labels

### New contract

Add a shared quantitative presentation contract, e.g.:
- `MetricPresentationSpec`

Minimum fields:
- `semanticFamily`
  - `sales_value`
  - `sales_volume`
  - `distribution`
  - `tdp`
  - `share`
  - `price`
  - `rotation`
  - `index`
  - `avg_assortment`
- `displayUnit`
  - raw
  - percent
  - currency
  - index
  - thousands
  - millions
  - billions
- `decimalPlaces`
- `variationDisplay`
  - absolute
  - percentage
  - auto
- `locale`
- `excelNumberFormat`
- `pptLabelFormat`
- `markdownFormat`

### Initial NIQ defaults

Seed the rule table from Rossella's file:
- prices → 2 decimals
- shares / intensity / rotations / average assortment → 1 decimal
- distribution / TDP / indices / base sales totals → 0 decimals
- deltas inherit base precision unless explicitly overridden

### Critical rule

The model should not invent decimals.

The model can choose the **message**, but code must choose the **display precision**.

---

## C. Replace “best-effort workbook chart” with a canonical exhibit styling contract

### Goal

Make the workbook-native chart and PPT screenshot chart look materially the same.

### New contract

Extend the manifest / exhibit layer with a deterministic style spec, e.g.:
- `ExhibitPresentationSpec`

Minimum fields:
- chart family
- series bindings
- series labels
- series colors
- marker style / line weight
- axis labels
- axis number formats
- data-label format
- legend position
- plot background / chart background
- gridline style
- brand palette source
- template profile source
- workbook anchor
- screenshot chart id / linkage

### Critical point

Right now `deck_manifest.json` carries only binding metadata, not enough style metadata.

Without extending the contract, exact fidelity is impossible by construction.

### Rendering ownership

Use the same `ExhibitPresentationSpec` to drive:
- PPT screenshot render
- workbook-native chart render
- worksheet table formatting

That is the only robust way to keep both artifacts coherent.

---

## D. Move workbook-native chart rendering to a deterministic formatting layer

### Short-term

Keep `openpyxl` injection, but add deterministic style mapping for supported families:
- NIQ / template palette colors
- marker sizes and borders for scatter
- axis titles and legend position
- plot area / chart area fills
- data-label number formats
- gridline colors

This should materially improve parity.

### Long-term

Rebuild workbook-native chart authoring around a renderer with richer chart formatting control.

Recommended direction:
- write workbook data tables deterministically from canonical DataFrames
- render workbook-native charts deterministically from `ExhibitPresentationSpec`
- prefer a chart-authoring path with stronger formatting control (likely `XlsxWriter`) for newly generated workbook artifacts

If Basquio continues mutating a model-authored workbook post hoc with `openpyxl`, style parity will remain harder than it needs to be.

---

## Implementation plan

## Wave 1 — stop the workspace upload failure

### W1.1 Add prepared upload route for workspace

Add:
- `apps/web/src/app/api/workspace/uploads/prepare/route.ts`
- `apps/web/src/app/api/workspace/uploads/confirm/route.ts`

Behavior:
- mirror `/api/uploads/prepare`
- bucket = `knowledge-base`
- cap = `50 MB`
- resumable required by default above `6 MB`

### W1.2 Replace raw upload in workspace chat

Update:
- `apps/web/src/components/workspace-chat/Chat.tsx`

Behavior:
- stop posting raw `FormData(file)` to `/api/workspace/uploads`
- use prepare → direct upload → confirm
- surface real server/storage errors in UI
- show per-file state and progress

### W1.3 Keep backward compatibility briefly

Existing route:
- `apps/web/src/app/api/workspace/uploads/route.ts`

Transition plan:
- keep temporarily for tiny files only, or retire immediately if the new chat uploader lands in one deployment
- if kept, make the response explicit when the request exceeds the supported direct-body size

### W1 acceptance

- 6.3 MB CSV uploads from workspace chat succeed on production
- 20–50 MB files go through direct/resumable upload, not Vercel body passthrough
- UI no longer shows generic `Upload failed.` for platform 413s

---

## Wave 2 — deterministic decimals

### W2.1 Add metric formatting rule module

Add a shared module, e.g.:
- `packages/workflows/src/metric-presentation.ts`

Responsibilities:
- map semantic metric families to decimal rules
- map variation display mode
- emit Excel, markdown, and PPT-safe formats

### W2.2 Apply to workbook tables

At workbook finalize time:
- set worksheet cell number formats deterministically
- ensure locale-consistent decimal display for NIQ-style outputs

### W2.3 Apply to chart labels and markdown

Use the same spec to format:
- chart data labels
- axis tick formats where supported
- markdown tables / narrative tables

### W2 acceptance

Using Rossella’s decimal workbook as the reference:
- prices render with 2 decimals
- share / intensity / rotations render with 1 decimal
- distribution / TDP / indices render with 0 decimals
- variation precision matches base metric precision

---

## Wave 3 — workbook/native chart fidelity

### W3.1 Extend the manifest contract

Update:
- `packages/workflows/src/deck-manifest.ts`
- any corresponding schema contract surfaces

Add fields for:
- series color metadata
- label number format
- legend position
- marker/line styling
- plot/chart background style
- template palette slot mapping

### W3.2 Carry style metadata from template/profile to workbook renderer

Source data should come from:
- `TemplateProfile`
- deterministic chart palette selection
- the rendered chart/screenshot styling layer

### W3.3 Deterministic workbook styling pass

Update:
- `scripts/native-workbook-charts.py`
  or replace with a richer deterministic renderer

Requirements:
- no more `chart.style = 10` as the entire styling system
- apply client palette / Nielsen palette deterministically
- apply decimal-aware data labels
- make scatter marker styling deterministic
- align legend and axis treatment with the screenshot chart

### W3.4 Add a fidelity regression

New test fixture should assert:
- native scatter chart exists
- workbook chart series colors match expected palette
- workbook data label number format matches expected decimals
- workbook axis/title/legend formatting matches the exhibit style contract

### W3 acceptance

For a chart-bearing run:
- the PPT screenshot and workbook-native chart encode the same data
- workbook-native chart uses the same intended palette family and label precision
- Rossella should no longer describe the workbook chart as “the same chart but with different formatting”

---

## Repo files most likely touched

### Upload fix
- `apps/web/src/components/workspace-chat/Chat.tsx`
- `apps/web/src/app/api/workspace/uploads/prepare/route.ts`
- `apps/web/src/app/api/workspace/uploads/confirm/route.ts`
- `apps/web/src/app/api/workspace/uploads/route.ts`
- `apps/web/src/lib/workspace/constants.ts`
- `apps/web/src/lib/workspace/db.ts`
- maybe shared upload helpers from:
  - `apps/web/src/app/api/uploads/prepare/route.ts`
  - `apps/web/src/lib/supabase/admin.ts`

### Decimal contract
- `packages/workflows/src/metric-presentation.ts` (new)
- `packages/workflows/src/generate-deck.ts`
- markdown/table render helpers if present

### Chart fidelity
- `packages/workflows/src/deck-manifest.ts`
- `packages/workflows/src/generate-deck.ts`
- `scripts/native-workbook-charts.py`
- `scripts/test-native-workbook-charts.ts`

---

## Non-goals

- Do not redesign the entire workspace UX in this spec.
- Do not change the deck screenshot renderer first and hope Excel follows.
- Do not fix this by raising limits on Vercel requests. That does not solve the architecture.
- Do not let the model decide decimal precision in free text.
- Do not keep two separate upload stacks for `/jobs/new` and workspace if one shared prepared-upload architecture can serve both.

---

## Sources

Official docs used:
- Vercel Functions limits: https://vercel.com/docs/functions/limitations/
- Vercel `FUNCTION_PAYLOAD_TOO_LARGE`: https://vercel.com/docs/errors/function_payload_too_large
- Supabase standard uploads: https://supabase.com/docs/guides/storage/uploads/standard-uploads
- Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Supabase file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- openpyxl styles / number formats: https://openpyxl.readthedocs.io/en/stable/styles.html
- XlsxWriter chart formatting: https://xlsxwriter.readthedocs.io/working_with_charts.html

Repo evidence used:
- `apps/web/src/app/api/workspace/uploads/route.ts` on `main`
- `apps/web/src/components/workspace-chat/Chat.tsx` on `main`
- `apps/web/src/app/api/uploads/prepare/route.ts`
- `apps/web/src/components/generation-form.tsx`
- `packages/workflows/src/deck-manifest.ts`
- `packages/workflows/src/generate-deck.ts`
- `scripts/native-workbook-charts.py`
- `/tmp/attachments/Decimali (1).xlsx`
- HAR proving `413 FUNCTION_PAYLOAD_TOO_LARGE`
