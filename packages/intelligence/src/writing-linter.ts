// ─── WRITING LINTER ───────────────────────────────────────────────
// Real module with input/output contract for text quality validation.
// Pure, deterministic, zero LLM cost. Runs on every slide before persist.

// ─── TYPES ────────────────────────────────────────────────────────

export type SlideTextInput = {
  position: number;
  role: string;
  layoutId: string;
  title: string;
  expectedLanguage?: "it" | "en" | "unknown";
  body?: string;
  bullets?: string[];
  callout?: { text: string; tone?: string };
  metrics?: Array<{ label: string; value: string; delta?: string }>;
  speakerNotes?: string;
};

export type LintViolation = {
  rule: string;
  severity: "critical" | "major" | "minor";
  field: string;
  message: string;
  value?: string;
};

export type LintResult = {
  passed: boolean;
  violations: LintViolation[];
};

export type DeckLintResult = {
  passed: boolean;
  slideResults: Array<{ position: number; result: LintResult }>;
  deckViolations: LintViolation[];
};

// ─── CONSTANTS ────────────────────────────────────────────────────

const TOPIC_LABELS = /^(executive\s+summary|market\s+overview|category\s+overview|key\s+findings|revenue\s+analysis|competitive\s+landscape|recommendations|appendix|conclusion|introduction|summary|distribution\s+(trends|analysis)|price\s+(trends|analysis)|market\s+analysis|brand\s+performance|channel\s+analysis|promo(tion)?\s+analysis|portfolio\s+review|share\s+analysis|growth\s+analysis|trend\s+analysis)/i;

const AI_SLOP_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /\blet'?s\s+(dive|explore|delve|unpack)\b/i, rule: "ai_slop_lets_dive" },
  { pattern: /\bit'?s\s+worth\s+noting\b/i, rule: "ai_slop_worth_noting" },
  { pattern: /\bmoving\s+forward\b/i, rule: "ai_slop_moving_forward" },
  { pattern: /\bin\s+today'?s\s+landscape\b/i, rule: "ai_slop_todays_landscape" },
  { pattern: /\bat\s+the\s+end\s+of\s+the\s+day\b/i, rule: "ai_slop_end_of_day" },
  { pattern: /\bparadigm\s+shift\b/i, rule: "ai_slop_paradigm_shift" },
  { pattern: /\bleverag(e|ing|ed)\b/i, rule: "ai_slop_leverage" },
  { pattern: /\bsynerg(y|ies|istic)\b/i, rule: "ai_slop_synergy" },
  { pattern: /\bholistic(ally)?\b/i, rule: "ai_slop_holistic" },
  { pattern: /\b(robust|innovative|scalable|disruptive|transformative|impactful)\b/i, rule: "ai_slop_buzzword" },
  { pattern: /\b(streamlin|unlock|empower|elevat)(e|ing|ed|s|ment)?\b/i, rule: "ai_slop_verb" },
  { pattern: /\bgame[- ]?chang(er|ing)\b/i, rule: "ai_slop_gamechanger" },
  { pattern: /\bcutting[- ]?edge\b/i, rule: "ai_slop_cutting_edge" },
  { pattern: /\b(utilize|demonstrate|remediate|facilitate)\b/i, rule: "ai_slop_long_word" },
  { pattern: /\bactionable\s+insights?\b/i, rule: "ai_slop_actionable_insights" },
  { pattern: /\bgo-to-market\s+optimization\b/i, rule: "ai_slop_gtm" },
  { pattern: /\bthis\s+isn'?t\s+\w+,\s*(this\s+)?i(t'?s|s)\b/i, rule: "ai_staccato_pattern" },
];

const HEDGING_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /\bmay\s+potentially\b/i, rule: "hedging_may_potentially" },
  { pattern: /\bcould\s+possibly\b/i, rule: "hedging_could_possibly" },
  { pattern: /\bit\s+(appears|seems)\s+that\b/i, rule: "hedging_appears_that" },
  { pattern: /\bit\s+(is\s+important|should\s+be\s+noted)\s+to?\s*(note\s+)?that\b/i, rule: "hedging_noted" },
  { pattern: /\b(clearly|obviously|undoubtedly|without\s+a\s+doubt)\b/i, rule: "overconfidence" },
];

const SYCOPHANTIC_OPENERS = /^(Interestingly|Notably|Importantly|Remarkably|Significantly|Crucially|Furthermore|Moreover|Additionally),?\s/i;

const GERUND_STARTERS = /^(Driving|Optimizing|Leveraging|Enabling|Fostering|Spearheading|Pioneering|Championing|Transforming|Delivering|Accelerating|Unlocking)\s/i;

const EM_DASH = /[—–]/;

const RHETORICAL_QUESTION = /\b(so\s+)?what\s+does\s+this\s+(mean|tell|imply|suggest)\b/i;

// Italian AI-generated patterns (translated-from-English constructions)
const AI_ITALIAN_PATTERNS = [
  /\bquesto\s+rappresenta\b/i,
  /\bevidenzia\s+un\s+trend\b/i,
  /\bnell'ambito\s+di\b/i,
  /\bin\s+termini\s+di\b/i,
  /\brappresenta\s+un'opportunit[aà]\b/i,
  /\bil\s+segmento\s+dei\s+prodotti\b.*\bevidenzia\b/i,
];

const ITALIAN_FALSE_FRIENDS: Array<{ pattern: RegExp; rule: string; message: string }> = [
  { pattern: /\blidera\b/i, rule: "italian_false_friend_lidera", message: "Non-native Italian false friend detected: use 'guida' or 'e leader', not 'lidera'" },
  { pattern: /\bperforma\b/i, rule: "italian_false_friend_performa", message: "Non-native Italian verb detected: replace 'performa' with a natural Italian construction" },
  { pattern: /\boutperforma\b/i, rule: "italian_false_friend_outperforma", message: "Non-native Italian verb detected: replace 'outperforma' with 'supera' or a natural Italian alternative" },
  { pattern: /\boverindexa\b|\bunderindexa\b/i, rule: "italian_false_friend_indexa", message: "Non-native Italian verb detected: replace pseudo-English index verbs with natural Italian" },
];

const ENGLISH_CORP_SPEAK: Array<{ pattern: RegExp; rule: string; message: string }> = [
  { pattern: /\bin order to\b/i, rule: "english_padding_in_order_to", message: "Replace padded English with a direct verb" },
  { pattern: /\bwith respect to\b/i, rule: "english_padding_with_respect_to", message: "Replace padded English with a direct phrase" },
  { pattern: /\bgoing forward\b/i, rule: "english_padding_going_forward", message: "Avoid empty forward-looking filler" },
];

const ANALYTICAL_LAYOUTS = new Set([
  "exec-summary",
  "chart-split",
  "title-chart",
  "evidence-grid",
  "comparison",
  "metrics",
  "summary",
]);

const ANALYTICAL_DRIVER_WORDS = /\b(driven?\s+by|led\s+by|because|due\s+to|reflects?|signals?|caused?\s+by|mix|pricing|price|distribution|assortment|promo|promotional|velocity|availability|guidat[oaie]|spint[oaie]|trainat[oaie]|perch[eé]|grazie\s+a|a\s+causa\s+di|riflette|segnala|mix|pricing|distribuzion|assortimento|promo|velocit[aà]|disponibilit[aà])\b/i;

// Italian stop words for language detection
const ITALIAN_STOPS = /\b(di|il|la|per|che|con|del|nel|alla|sono|una|dei|dal|delle|gli|fra|tra|nel|nella)\b/gi;
const ENGLISH_STOPS = /\b(the|and|for|with|that|this|from|have|been|will|they|their|about|which|would|these|other|into)\b/gi;

// ─── BODY WORD LIMITS PER LAYOUT ──────────────────────────────────

const BODY_WORD_LIMITS: Record<string, number> = {
  "cover": 0,
  "exec-summary": 25,
  "chart-split": 30,
  "title-chart": 30,
  "evidence-grid": 30,
  "title-body": 50,
  "title-bullets": 50,
  "summary": 30,
  "recommendation": 30,
  "table": 0,
  "comparison": 30,
  "metrics": 25,
};

// ─── HELPERS ──────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function detectLanguage(text: string): "it" | "en" | "unknown" {
  const itCount = (text.match(ITALIAN_STOPS) ?? []).length;
  const enCount = (text.match(ENGLISH_STOPS) ?? []).length;
  if (itCount > enCount * 1.5) return "it";
  if (enCount > itCount * 1.5) return "en";
  return "unknown";
}

function hasNumber(text: string): boolean {
  return /\d/.test(text);
}

function isPassiveVoice(title: string): boolean {
  return /\b(was|were|been|being|is|are)\s+(lost|gained|driven|observed|noted|seen|found|affected|impacted|influenced|caused)\b/i.test(title);
}

function textLanguageViolations(slide: SlideTextInput, text: string, field: string): LintViolation[] {
  const violations: LintViolation[] = [];
  if (!text.trim()) {
    return violations;
  }

  const detected = detectLanguage(text);
  if (
    slide.expectedLanguage &&
    slide.expectedLanguage !== "unknown" &&
    detected !== "unknown" &&
    detected !== slide.expectedLanguage
  ) {
    violations.push({
      rule: "language_mismatch",
      severity: "major",
      field,
      message: `Text appears to be ${detected} but the deck language is ${slide.expectedLanguage}`,
      value: text.slice(0, 100),
    });
  }

  if (slide.expectedLanguage === "it") {
    for (const entry of ITALIAN_FALSE_FRIENDS) {
      if (entry.pattern.test(text)) {
        violations.push({
          rule: entry.rule,
          severity: "critical",
          field,
          message: entry.message,
          value: text.match(entry.pattern)?.[0],
        });
      }
    }
  }

  if (slide.expectedLanguage === "en") {
    for (const entry of ENGLISH_CORP_SPEAK) {
      if (entry.pattern.test(text)) {
        violations.push({
          rule: entry.rule,
          severity: "minor",
          field,
          message: entry.message,
          value: text.match(entry.pattern)?.[0],
        });
      }
    }
  }

  return violations;
}

// ─── SLIDE LINTER ─────────────────────────────────────────────────

export function lintSlideText(slide: SlideTextInput): LintResult {
  const violations: LintViolation[] = [];

  // ── TITLE CHECKS ──

  if (slide.title) {
    // Em dashes in title
    if (EM_DASH.test(slide.title)) {
      violations.push({ rule: "em_dash", severity: "critical", field: "title", message: "Em dash in title", value: slide.title.slice(0, 60) });
    }

    // Topic label detection (non-cover only)
    if (slide.role !== "cover") {
      const titleWords = wordCount(slide.title);
      const isTopicLabel = TOPIC_LABELS.test(slide.title.trim());
      const isShortGeneric = titleWords < 6 && !hasNumber(slide.title);
      if (isTopicLabel || isShortGeneric) {
        violations.push({ rule: "topic_label_title", severity: "critical", field: "title", message: `Title is a topic label, not an insight: "${slide.title.slice(0, 50)}"`, value: slide.title });
      }

      // Title must contain a number
      if (!hasNumber(slide.title)) {
        violations.push({ rule: "title_no_number", severity: "major", field: "title", message: "Non-cover title has no number", value: slide.title.slice(0, 50) });
      }
    }

    // Title too long (Italian titles are structurally longer — allow 22 words)
    const maxTitleWords = 22;
    if (wordCount(slide.title) > maxTitleWords) {
      violations.push({ rule: "title_too_long", severity: "minor", field: "title", message: `Title has ${wordCount(slide.title)} words (max ${maxTitleWords})` });
    }

    // Passive voice in title
    if (isPassiveVoice(slide.title)) {
      violations.push({ rule: "passive_title", severity: "minor", field: "title", message: "Title uses passive voice", value: slide.title.slice(0, 50) });
    }

    violations.push(...textLanguageViolations(slide, slide.title, "title"));
  }

  // ── BODY CHECKS ──

  if (slide.body) {
    if (EM_DASH.test(slide.body)) {
      violations.push({ rule: "em_dash", severity: "critical", field: "body", message: "Em dash in body text" });
    }

    const maxWords = BODY_WORD_LIMITS[slide.layoutId] ?? 50;
    if (maxWords > 0 && wordCount(slide.body) > maxWords) {
      violations.push({ rule: "body_too_long", severity: "major", field: "body", message: `Body has ${wordCount(slide.body)} words (max ${maxWords} for ${slide.layoutId})` });
    }

    // AI slop in body
    for (const { pattern, rule } of AI_SLOP_PATTERNS) {
      if (pattern.test(slide.body)) {
        violations.push({ rule, severity: "major", field: "body", message: `AI slop detected: ${rule}`, value: slide.body.match(pattern)?.[0] });
      }
    }

    // Hedging
    for (const { pattern, rule } of HEDGING_PATTERNS) {
      if (pattern.test(slide.body)) {
        violations.push({ rule, severity: "minor", field: "body", message: `Hedging detected: ${rule}` });
      }
    }

    // Sycophantic opener
    if (SYCOPHANTIC_OPENERS.test(slide.body)) {
      violations.push({ rule: "sycophantic_opener", severity: "minor", field: "body", message: "Body starts with sycophantic opener" });
    }

    // Rhetorical question
    if (RHETORICAL_QUESTION.test(slide.body)) {
      violations.push({ rule: "rhetorical_question", severity: "major", field: "body", message: "Rhetorical question used as transition" });
    }

    // Italian AI patterns
    const lang = detectLanguage(slide.body);
    if (lang === "it") {
      for (const pat of AI_ITALIAN_PATTERNS) {
        if (pat.test(slide.body)) {
          violations.push({ rule: "ai_italian", severity: "major", field: "body", message: "Translated-from-English AI Italian detected", value: slide.body.match(pat)?.[0] });
        }
      }
    }

    if (
      ANALYTICAL_LAYOUTS.has(slide.layoutId) &&
      !hasNumber(slide.body) &&
      !ANALYTICAL_DRIVER_WORDS.test(slide.body)
    ) {
      violations.push({
        rule: "body_generic_analysis",
        severity: "major",
        field: "body",
        message: "Analytical body text is too generic — add a number or a clear commercial driver/implication",
      });
    }

    violations.push(...textLanguageViolations(slide, slide.body, "body"));
  }

  // ── BULLET CHECKS ──

  if (slide.bullets && slide.bullets.length > 0) {
    if (slide.bullets.length > 4) {
      violations.push({ rule: "too_many_bullets", severity: "major", field: "bullets", message: `${slide.bullets.length} bullets (max 4)` });
    }

    for (let i = 0; i < slide.bullets.length; i++) {
      const b = slide.bullets[i];
      if (EM_DASH.test(b)) {
        violations.push({ rule: "em_dash", severity: "critical", field: `bullets[${i}]`, message: "Em dash in bullet" });
      }
      if (wordCount(b) > 15) {
        violations.push({ rule: "bullet_too_long", severity: "major", field: `bullets[${i}]`, message: `Bullet ${i + 1} has ${wordCount(b)} words (max 15)` });
      }
      if (GERUND_STARTERS.test(b)) {
        violations.push({ rule: "gerund_bullet", severity: "minor", field: `bullets[${i}]`, message: "Bullet starts with gerund" });
      }
      for (const { pattern, rule } of AI_SLOP_PATTERNS) {
        if (pattern.test(b)) {
          violations.push({ rule, severity: "major", field: `bullets[${i}]`, message: `AI slop in bullet: ${rule}` });
        }
      }
      violations.push(...textLanguageViolations(slide, b, `bullets[${i}]`));
    }
  }

  // ── CALLOUT CHECKS ──

  if (slide.callout?.text) {
    const ct = slide.callout.text;
    if (EM_DASH.test(ct)) {
      violations.push({ rule: "em_dash", severity: "critical", field: "callout", message: "Em dash in callout" });
    }
    if (wordCount(ct) > 25) {
      violations.push({ rule: "callout_too_long", severity: "major", field: "callout", message: `Callout has ${wordCount(ct)} words (max 25)` });
    }

    // Callout should be an action, not observation
    const ACTION_VERBS = /^(expand|list|shift|grow|launch|increase|reduce|focus|protect|rebalance|renovate|delist|target|invest|build|capture|recover|sustain|optimize|test|pilot|accelerate|renegotiate|prioritize|espand|aument|riduc|focalizz|protegg|ribilanc|rinnov|delist|targett|invest|costru|cattur|recuper|sostien|ottimizz|test|pilota|acceler|rinegoz|prioritizz)/i;
    if (!ACTION_VERBS.test(ct.trim()) && !hasNumber(ct) && slide.role !== "cover" && slide.role !== "exec-summary") {
      violations.push({ rule: "callout_not_action", severity: "major", field: "callout", message: "Callout is an observation, not an action (no verb, no number)", value: ct.slice(0, 50) });
    }
    violations.push(...textLanguageViolations(slide, ct, "callout"));
  }

  // ── METRIC CHECKS ──

  if (slide.metrics) {
    for (let i = 0; i < slide.metrics.length; i++) {
      const m = slide.metrics[i];
      // Placeholder values
      if (/[XN?_]{1,3}\s*(mln|bln|%|pp|pts|k|m|b)/i.test(m.value) || m.value.trim() === "X") {
        violations.push({ rule: "placeholder_metric", severity: "critical", field: `metrics[${i}].value`, message: "Placeholder metric value", value: m.value });
      }
      // Share without denominator
      if (/^\d+[.,]?\d*\s*%$/.test(m.value.trim()) && !/of\s|del\s|su\s/i.test(m.label)) {
        violations.push({ rule: "share_no_denominator", severity: "major", field: `metrics[${i}]`, message: `Percentage "${m.value}" without denominator in label "${m.label}"` });
      }
      // Non-numeric delta (supports Italian comma decimals and trailing context like "YoY", "vs mercato")
      if (m.delta && !/^([+-]?\d+[.,]?\d*\s*(%|pts|pp|p\.p\.|M|K|€|£|\$|mln|mld|bln|bn|pz)(\s+\S+(\s+\S+)?)?|flat|stable|—|n\/a|)$/i.test(m.delta.trim())) {
        violations.push({ rule: "non_numeric_delta", severity: "major", field: `metrics[${i}].delta`, message: `Delta is not numeric: "${m.delta}"`, value: m.delta });
      }
    }
  }

  // ── SPEAKER NOTES CHECKS ──

  if (slide.speakerNotes) {
    if (EM_DASH.test(slide.speakerNotes)) {
      violations.push({ rule: "em_dash", severity: "minor", field: "speakerNotes", message: "Em dash in speaker notes" });
    }
    violations.push(...textLanguageViolations(slide, slide.speakerNotes, "speakerNotes"));
  }

  const hasCritical = violations.some(v => v.severity === "critical");
  return { passed: !hasCritical, violations };
}

// ─── DECK LINTER ──────────────────────────────────────────────────

export function lintDeckText(slides: SlideTextInput[]): DeckLintResult {
  const slideResults = slides.map(s => ({
    position: s.position,
    result: lintSlideText(s),
  }));

  const deckViolations: LintViolation[] = [];

  // Layout variety
  const layoutCounts: Record<string, number> = {};
  for (const s of slides) {
    layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
  }
  const maxLayoutCount = Math.max(...Object.values(layoutCounts), 0);
  if (slides.length > 4 && maxLayoutCount > slides.length * 0.5) {
    const dominantLayout = Object.entries(layoutCounts).find(([, c]) => c === maxLayoutCount)?.[0];
    deckViolations.push({ rule: "low_layout_variety", severity: "major", field: "deck", message: `>50% of slides use "${dominantLayout}" layout (${maxLayoutCount}/${slides.length})` });
  }

  // Cover check
  if (slides.length > 0 && slides[0].role !== "cover" && slides[0].layoutId !== "cover") {
    deckViolations.push({ rule: "no_cover", severity: "critical", field: "deck", message: "First slide is not a cover" });
  }

  // Text-only analytical slides
  const textOnlyAnalytical = slides.filter(s =>
    !["cover", "section-divider", "exec-summary", "summary", "recommendation"].includes(s.role) &&
    ["title-body", "title-bullets"].includes(s.layoutId)
  );
  if (textOnlyAnalytical.length > 1) {
    deckViolations.push({ rule: "too_many_text_slides", severity: "major", field: "deck", message: `${textOnlyAnalytical.length} text-only analytical slides (max 1)` });
  }

  // Repetitive narrative (consecutive titles share >3 content words)
  for (let i = 1; i < slides.length; i++) {
    const prevWords = new Set(slides[i - 1].title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const currWords = slides[i].title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const shared = currWords.filter(w => prevWords.has(w));
    if (shared.length > 3) {
      deckViolations.push({ rule: "repetitive_narrative", severity: "minor", field: "deck", message: `Slides ${i} and ${i + 1} share ${shared.length} content words in titles` });
    }
  }

  const hasCritical = slideResults.some(r => !r.result.passed) || deckViolations.some(v => v.severity === "critical");
  return { passed: !hasCritical, slideResults, deckViolations };
}
