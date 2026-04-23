# 2026-04-23 Template Canvas And Native Workbook Presentation Spec

## Incident

Rossella's fresh rerun exposed two presentation regressions that were not analytical-model failures:

1. the generated PPTX inherited a mid-grey deck canvas on every slide
2. the generated `data_tables.xlsx` looked like a raw technical companion file rather than a consulting-grade workbook, with native charts placed crudely beside hidden helper ranges

These were runtime/rendering defects. They were not caused by the brief, the evidence package, or the model.

## External Docs Used

- Microsoft Learn: Working with slide masters
  - https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-slide-masters
- openpyxl docs: Positioning Charts with Anchors
  - https://openpyxl.readthedocs.io/en/latest/charts/anchors.html
- openpyxl docs: Working with styles
  - https://openpyxl.pages.heptapod.net/openpyxl/styles.html
- XlsxWriter docs: Working with Object Positioning
  - https://xlsxwriter.readthedocs.io/working_with_object_positioning.html
- XlsxWriter docs: Working with Worksheet Tables
  - https://xlsxwriter.readthedocs.io/working_with_tables.html

## Forensic Findings

### 1. Grey deck canvas

- The fresh PPTX had `ppt/slideMasters/slideMaster1.xml` with a solid master background fill of `B2B2B2`.
- The saved template profile for the same template id already contained `brandTokens.injection.masterBackground = "B2B2B2"`.
- The renderer blindly injected `masterBackground` into every generated slide master.
- The old salvaged deck did not inherit that same injected master background, which is why it did not appear grey.

Root cause:

- Basquio treated an extracted master background token as an authoritative brand canvas token.
- In practice, imported PPTX masters can contain neutral placeholder or template-editor background fills that should not automatically become the entire deck canvas.

### 2. Messy workbook

- The current workbook-native chart path was analytically linked but presentation-light.
- Charts were inserted with a fixed top-left anchor pattern near appended hidden helper columns.
- Sheets had almost no presentation shell beyond number formats.
- There was no README/index sheet, no freeze-pane policy, no styled Excel tables, no consistent column-width strategy, and no reserved chart zone.

Root cause:

- Basquio shipped native Excel charts as a chart-injection feature, not as a workbook presentation system.

## Production Architecture Decision

### A. Template canvas policy

`brandTokens.injection.masterBackground` is advisory, not authoritative.

It may be injected only if one of the following is true:

- it matches known palette hints
- it is close to a known palette color
- it is clearly a branded non-neutral surface

It must be ignored when it looks like a neutral placeholder background that is not brand-aligned.

This rule must exist in both places:

- template extraction, so future saved profiles do not persist obvious junk
- render-time injection, so existing saved profiles cannot poison new runs

### B. Native workbook presentation contract

`data_tables.xlsx` is a user-facing consulting artifact, not only a QA companion.

The workbook-native chart pipeline must therefore apply a deterministic presentation shell:

- README/index sheet listing evidence tabs
- freeze panes on evidence sheets
- styled header rows
- styled Excel tables over visible evidence ranges
- explicit column widths
- hidden helper data kept outside the visible chart panel
- chart placement via reserved right-side panel using two-cell anchors
- reduced label clutter for chart families where labels create overlaps

## Implementation

### Landed

- Added a workbook presentation contract under `ExhibitPresentationSpec.workbookPresentation`.
- Added palette hints to template injection payloads.
- Added master-background validation in template extraction and render-time branding.
- Expanded workbook sheet presentation metadata to include freeze panes, table styles, header styling, column widths, and gridline policy.
- Reworked the native workbook post-processor to:
  - create a README sheet
  - style evidence sheets
  - create Excel tables
  - use reserved right-panel chart placement with `TwoCellAnchor`
  - move helper columns beyond the chart panel
  - reduce chart label clutter on chart families where data labels overlap

## Acceptance Criteria

- A neutral imported master background no longer turns all slides grey unless it is brand-aligned.
- Existing bad saved template profiles are harmless because render-time validation still blocks placeholder backgrounds.
- Every evidence sheet in `data_tables.xlsx` is readable without manual cleanup.
- Native charts do not sit on top of the visible evidence table area.
- Workbook-native charts remain analytically linked to the exact sheet data.
- Regression coverage exists for both:
  - template canvas validation
  - workbook native chart placement and sheet formatting
