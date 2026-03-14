# Research Synthesis

Revalidated against current official stack documentation and the clarified product target on March 14, 2026.

## Inputs Merged

This synthesis merges:

- Loamly repo inspection
- source-backed architecture research in `docs/presentation-generator-architecture.md`
- the other agent's useful findings that were provided in summary form during the conversation

## Best Parts Kept From Repo-Grounded Research

- Browserless is already a strong PDF generation pattern in Loamly.
- Supabase already matches the artifact delivery shape of the product.
- ECharts and Vega-class tools are better export engines than React dashboard libraries.
- `.pptx` is viable as an editable template source, `.pdf` is not in v1.
- the real product moat is intelligence, not document rendering.

## Best Parts Kept From The Other Agent Track

- Loamly already has a proven checkpoint-resume job pattern with QStash self-chaining.
- Basquio should explicitly optimize for FMCG and market-insight storytelling first.
- PptxGenJS native charts are valuable because editable charts are a real B2B advantage.
- template theme extraction from `.pptx` should inspect the underlying package structure rather than relying on visual inference only.

## Corrections Applied During Merge

### PDF

The other agent suggested `@react-pdf/renderer` as a primary PDF tool.

Merged outcome:

- reject it as primary
- keep Browserless HTML-to-PDF as the default

### Charts

The other agent first suggested `chartjs-node-canvas`, then correctly backed away from it.

Merged outcome:

- do not make `chartjs-node-canvas` the default backend
- standard charts: prefer editable native PPT charts
- advanced charts and PDF visuals: prefer ECharts SSR SVG

### Workflow

The repo proves QStash self-chaining.
The team has prior experience with Inngest.

Merged outcome:

- Basquio greenfield default: Inngest
- Basquio inherited fallback: QStash checkpoint-resume if incubated inside Loamly infrastructure

## Final Merged Position

Basquio should be built as:

- an intelligence engine that produces structured plans from multi-file evidence packages
- a report-generation system that takes a report brief seriously, not as optional decoration
- a template and brand system that understands PPTX honestly, accepts structured brand token files, and treats PDF conservatively
- a rendering layer that uses the right tool for each artifact instead of one universal library

That is the cleanest synthesis of both research tracks.

## Product Calibration

The March 14, 2026 product calibration is explicit:

- Basquio should be able to take a delivery-style evidence pack similar to the SGS AI visibility report package
- Basquio should synthesize a narrative with executive stakes, not just summarize rows
- Basquio should ingest brand guidance from a file, not only from a manually hardcoded web theme
