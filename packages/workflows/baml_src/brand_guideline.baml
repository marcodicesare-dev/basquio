// Brand-guideline extraction (Memory v1 Brief 3).
//
// Spec: docs/research/2026-04-25-sota-implementation-specs.md §4
// Persisted into public.brand_guideline (Brief 1 schema) via SECURITY DEFINER
// RPC public.persist_brand_guideline (Brief 3, see migration 20260428140000).
//
// Two-phase pipeline:
//   1. ExtractBrandGuideline (Sonnet 4.6): typed extraction with source_page
//      on every rule.
//   2. ValidateBrandGuideline (Haiku 4.5): cheap reviewer pass that gates
//      persistence. Confidence below 0.7 means reject (do not persist).
//
// BAML prompt strings use Jinja templating. Literal curly braces and complex
// quotation that could collide with Jinja are described in plain text rather
// than embedded as JSON examples.

enum SurfaceKind {
  HEADLINE
  SUBHEAD
  BODY
  CAPTION
  LABEL
}

class TypographyRule {
  surface SurfaceKind
  font_family string
  weight int
  size_px int?
  tracking string?
  source_page int
}

class ColourEntry {
  name string
  hex string
  rgb string?
  source_page int
}

class TonalRule {
  voice_attribute string
  do_examples string[]
  dont_examples string[]
  sample_sentences string[]
  source_page int
}

class ImageryRule {
  rule string
  approved_examples_url string[]
  forbidden_examples_url string[]
  source_page int
}

class LanguagePreference {
  source_form string
  preferred_form string
}

class BrandGuidelineExtraction {
  brand string
  version string
  typography TypographyRule[]
  colour ColourEntry[]
  tone TonalRule[]
  imagery ImageryRule[]
  forbidden string[]
  language_preferences LanguagePreference[]
  layout_constraints string[]
  logo_rules string[]
  extraction_confidence float
}

class BrandGuidelineValidation {
  confidence float
  reason string
  issues string[]
}

function ExtractBrandGuideline(pdf_text: string, page_count: int) -> BrandGuidelineExtraction {
  client ClaudeSonnet46
  prompt #"
    Extract structured brand-guideline rules from a PDF brand book.

    Rules:
    1. Cite the source page for every typed rule. source_page must be a positive integer pointing to the page where the rule appears.
    2. extraction_confidence ranges 0 to 1. Below 0.7 means we are guessing. Score honestly.
    3. Tone rules MUST include at least one do_example AND one dont_example. If the document does not show clear contrasts, omit the tone rule rather than inventing examples.
    4. Forbidden words: only include strings the document explicitly forbids.
    5. language_preferences is a list of preferred-form swaps the document specifies. For each entry, source_form is the variant being replaced and preferred_form is the variant the document prefers. Empty list if the document is silent on language preferences.
    6. layout_constraints: short imperative strings about grid, margins, safe areas, padding. One constraint per element. Empty if not specified.
    7. logo_rules: short imperative strings about clear-space, minimum size, lockup, on-image use, monochrome use. One rule per element.
    8. typography weight is the numeric font weight 100..900. Convert names: regular is 400, bold is 700, light is 300, medium is 500, semi-bold is 600, black is 900.
    9. colour hex must be 6 uppercase hex characters with a leading hash, like the Spotify green hex 1ED760 written with a leading hash. If only RGB is given, compute the hex.
    10. Brand version: use the document version if present, otherwise the publication date or year (e.g. 2024 or v3.2).

    {{ ctx.output_format }}

    {{ _.role("user") }}
    PDF length: {{ page_count }} pages.

    {{ pdf_text }}
  "#
}

function ValidateBrandGuideline(extraction: BrandGuidelineExtraction) -> BrandGuidelineValidation {
  client ClaudeHaiku45
  prompt #"
    You are a strict reviewer of an extracted brand-guideline payload. Decide whether the extraction is trustworthy enough to persist to durable workspace memory. Be strict; downstream chat agents will obey these rules verbatim.

    Hard-fail checks:
    1. Every typography, colour, tone, and imagery rule has source_page as a positive integer >= 1. If any rule has source_page <= 0 or missing, the extraction is broken.
    2. Every tone rule has at least one do_example AND at least one dont_example. Empty arrays on either side fail.
    3. Colour hex strings are 6-character uppercase starting with a hash. Malformed hex fails.
    4. Typography font_family is non-empty; weight is in 100..900. Out-of-range weights fail.
    5. brand and version are non-empty strings.

    Soft-flag checks:
    6. No obvious contradictions (two typography rules for the same surface with different fonts and no conditional).
    7. extraction_confidence is plausible given the volume of rules. High rule count with low self-confidence is suspicious; low rule count with high self-confidence is also suspicious.
    8. Forbidden words list is plausible (real explicit forbids, not generic professional-language inferences).

    Return:
    - confidence: 0..1 overall trust score. Hard-fail check failures push below 0.7. Soft-flag failures shave 0.05 to 0.15 each.
    - reason: one short sentence explaining the score.
    - issues: every concrete problem found. Empty array if clean.

    A confidence below 0.7 means the caller will reject and not persist. Be honest.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ extraction }}
  "#
}
