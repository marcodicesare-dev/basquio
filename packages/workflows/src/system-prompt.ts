import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describeAllArchetypesForPrompt } from "@basquio/scene-graph/slot-archetypes";
import type { TemplateProfile } from "@basquio/types";

import { BASQUIO_CHART_PALETTE } from "../../../code/design-tokens";

const KNOWLEDGE_PACK_FILES = [
  "docs/domain-knowledge/niq-analyst-playbook.md",
  "docs/domain-knowledge/basquio-copywriting-skill.md",
  "docs/domain-knowledge/basquio-deck-depth-architecture.md",
  "docs/domain-knowledge/basquio-recommendation-framework.md",
  "docs/direct-deck-design-spec.md",
  "docs/domain-knowledge/fmcg-rgm-consulting-finance-layer.md",
  "docs/domain-knowledge/kantar-knowledge-graph.md",
  "docs/domain-knowledge/circana-knowledge-graph.md",
] as const;

let knowledgePackPromises: Map<string, Promise<string>> | null = null;
const BASQUIO_LOGO_PLACEHOLDER = "__BASQUIO_LOGO_LIGHT_BG_BASE64__";
const BASQUIO_MASTER_ARGS_PLACEHOLDER = "__BASQUIO_MASTER_ARGS__";
const BASQUIO_COVER_ARGS_PLACEHOLDER = "__BASQUIO_COVER_ARGS__";
const basquioLogoBase64Promise = readFile(
  path.join(process.cwd(), "apps/web/public/brand/png/logo/2x/basquio-logo-light-bg-blue@2x.png"),
)
  .then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`)
  .catch(() => null);

const BASQUIO_BRANDING_EXAMPLE = `
<example name="perfect_slide_master_setup">
// FIRST THING before any addSlide(): define masters
const BASQUIO_LOGO = "${BASQUIO_LOGO_PLACEHOLDER}";
const coverMasterObjects = [];
const contentMasterObjects = [];

if (BASQUIO_LOGO) {
  coverMasterObjects.push(
    {
      text: {
        text: "Made with",
        options: {
          x: 9.25, y: 0.22, w: 1.45, h: 0.2,
          fontSize: 9, fontFace: "Arial", color: "5D656B", align: "right",
        },
      },
    },
    {
      image: { data: BASQUIO_LOGO, x: 10.8, y: 0.12, w: 2.05, h: 0.517 },
    },
  );
  contentMasterObjects.push({
    image: { data: BASQUIO_LOGO, x: 11.45, y: 0.14, w: 1.1, h: 0.278 },
  });
}

pptx.defineSlideMaster({
  title: "BASQUIO_COVER",
  background: { fill: "F5F1E8" },
  objects: coverMasterObjects,
});

pptx.defineSlideMaster({
  title: "BASQUIO_MASTER",
  background: { fill: "F5F1E8" },
  objects: contentMasterObjects,
  slideNumber: {
    x: 12.0, y: 7.15, w: 0.533, h: 0.22,
    fontSize: 8, fontFace: "Arial", color: "6B7280", align: "right",
  },
});

const coverSlide = pptx.addSlide({ masterName: "BASQUIO_COVER" });
const slide2 = pptx.addSlide({ masterName: "BASQUIO_MASTER" });
</example>
`.trim();

/**
 * Lighter client master example — provides color constants and master naming convention.
 * Logo and solid-fill decorative shapes are handled by PGTI post-processor.
 * Claude is still responsible for: cover background and slide number styling.
 */
function buildClientPaletteExample(
  templateProfile: TemplateProfile,
  promptPalette: PromptPalette,
) {
  const typography = templateProfile.brandTokens?.typography;
  const contentFont = typography?.bodyFont ?? typography?.headingFont ?? "Arial";
  const contentFontLiteral = JSON.stringify(contentFont);
  const coverBg = templateProfile.brandTokens?.palette?.coverBg
    ? stripHexPrefix(normalizeHex(templateProfile.brandTokens.palette.coverBg))
    : promptPalette.backgroundNoHash;

  return `
<example name="client_template_palette_and_masters">
// Color constants from the client template — use these throughout.
// The client logo and decorative accent bars are added to the slide master automatically.
// You do NOT need to add the logo via addImage().

const BG = "${promptPalette.backgroundNoHash}";
const SURFACE = "${promptPalette.surfaceNoHash}";
const TEXT = "${promptPalette.textNoHash}";
const MUTED = "${promptPalette.mutedNoHash}";
const BORDER = "${promptPalette.borderNoHash}";
const ACCENT = "${promptPalette.primaryNoHash}";
const HIGHLIGHT = "${promptPalette.highlightNoHash}";

pptx.defineSlideMaster({
  title: "CLIENT_COVER",
  background: { fill: "${coverBg}" },
  objects: [],
});

pptx.defineSlideMaster({
  title: "CLIENT_MASTER",
  background: { fill: SURFACE },
  objects: [],
  slideNumber: {
    x: 12.0, y: 7.12, w: 0.55, h: 0.22,
    fontSize: 8, fontFace: ${contentFontLiteral}, color: MUTED, align: "right",
  },
});

const coverSlide = pptx.addSlide({ masterName: "CLIENT_COVER" });
const slide2 = pptx.addSlide({ masterName: "CLIENT_MASTER" });
</example>
`.trim();
}

const DECK_EXAMPLES = `
<examples>
<example name="perfect_exec_summary_slide">
// Executive summary slide using exec-summary archetype
// Note: 4 KPI cards with label + value + delta, plus SCQA body with real sentences

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});

slide.addText("EXECUTIVE SUMMARY", {
  x: 0.45, y: 0.22, w: 9.1, h: 0.18,
  fontSize: 9, fontFace: "Arial", color: "1A6AFF", letterSpacing: 1.5, bold: true
});

slide.addText("Petfood category grew +8.2% but brand lost 1.4pp share to private label", {
  x: 0.45, y: 0.32, w: 9.1, h: 0.56,
  fontSize: 22, fontFace: "Arial", color: "0B0C0C", bold: true
});

const metrics = [
  { label: "Category Value", value: "EUR781M", delta: "+8.2% vs PY" },
  { label: "Brand Share", value: "18.3%", delta: "-1.4pp vs PY" },
  { label: "Distribution", value: "72% ACV", delta: "+3.2pp vs PY" },
  { label: "Price Index", value: "112", delta: "+4pts vs PY" },
];
// Render each KPI card in a clean row with visible label, value, and delta.

slide.addText([
  "SITUATION: Italian petfood market reached EUR781M (+8.2%), driven by premium wet segment.",
  "COMPLICATION: Brand lost 1.4pp share despite +3.2pp distribution gain - a velocity problem, not availability.",
  "QUESTION: How to convert distribution gains into share recovery before private label locks in switching?",
  "ANSWER: Shift promo from deep TPR to event-led in top-5 retailers and launch a 150g premium wet SKU."
].join("\\n\\n"), {
  x: 0.45, y: 2.35, w: 9.1, h: 1.65,
  fontSize: 11, fontFace: "Arial", color: "5D656B", breakLine: false
});

slide.addText("Action: list top-3 SKUs at Coop and Esselunga to capture EUR2.1M incremental", {
  x: 0.45, y: 4.15, w: 9.1, h: 0.42,
  fontSize: 10, fontFace: "Arial", color: "0B0C0C",
  fill: { color: "1A6AFF", transparency: 76 }
});
</example>

<example name="perfect_chart_slide">
// Chart slide using title-chart archetype
// Note: chart rendered as PNG at slot dimensions with safe label padding

slide.background = { color: "F5F1E8" };

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

fig, ax = plt.subplots(figsize=(9.25, 3.5))
categories = ["Premium Wet", "Standard Wet", "Premium Dry", "Standard Dry", "Treats"]
values = [23.4, 18.7, 15.2, 31.1, 11.6]
colors = ["#F0CC27" if v == max(values) else "#8A93A0" for v in values]
bars = ax.barh(categories, values, color=colors)
ax.bar_label(bars, fmt='%.1f%%', padding=5, fontsize=9, color="#5D656B")
ax.set_xlim(0, max(values) * 1.15)
ax.invert_yaxis()
ax.tick_params(colors="#5D656B", labelsize=10)
ax.spines[['top', 'right', 'bottom']].set_visible(False)
ax.spines['left'].set_color('#D6D1C4')
ax.set_facecolor('#F5F1E8')
fig.patch.set_facecolor('#F5F1E8')
# The slide footer band carries the single canonical source line.
plt.subplots_adjust(bottom=0.15)
plt.tight_layout()
plt.savefig("chart_1.png", dpi=300, bbox_inches='tight', facecolor='#F5F1E8')

slide.addText("Standard Dry dominates at 31.1% mix but Premium Wet is fastest growing at +12.4% YoY", {
  x: 0.45, y: 0.32, w: 9.1, h: 0.52,
  fontSize: 20, fontFace: "Arial", color: "0B0C0C", bold: true
});
slide.addImage({ path: "chart_1.png", x: 0.35, y: 0.92, w: 9.25, h: 3.5 });
slide.addText("Mix shift toward premium creates pricing headroom - brand should accelerate the 150g launch", {
  x: 0.45, y: 4.55, w: 9.1, h: 0.42,
  fontSize: 10, fontFace: "Arial", color: "5D656B"
});
</example>

<example name="evidence_grid_with_colocated_table">
// Evidence-grid slide with chart LEFT and compact supporting table RIGHT.
// Use this when the chart makes the point and the table proves the numbers.

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});
slide.addText("San Carlo cresce +1.7% diversificando su 10 brand, Kellanova cala -5.0% concentrata sul tubo", {
  x: 0.45, y: 0.32, w: 11.7, h: 0.62,
  fontSize: 20, fontFace: "Arial", color: "0B0C0C", bold: true
});

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(5.6, 3.2), dpi=300)
players = ["San Carlo", "Mondelez", "Kellanova", "PepsiCo"]
share_delta = [0.6, 0.1, -0.4, -0.2]
colors = ["#1A6AFF", "#8A93A0", "#E8636F", "#8A93A0"]
bars = ax.barh(players, share_delta, color=colors)
ax.bar_label(bars, fmt='%+.1fpp', padding=4, fontsize=9, color="#5D656B")
ax.axvline(x=0, color="#D6D1C4", linewidth=0.8)
ax.invert_yaxis()
ax.spines[['top', 'right']].set_visible(False)
ax.spines['left'].set_color('#D6D1C4')
ax.spines['bottom'].set_color('#D6D1C4')
ax.tick_params(colors="#5D656B", labelsize=9)
ax.set_facecolor('#F5F1E8')
fig.patch.set_facecolor('#F5F1E8')
# The slide footer band carries the single canonical source line.
plt.subplots_adjust(bottom=0.16)
plt.tight_layout()
plt.savefig("competitor_share_chart.png", dpi=300, bbox_inches='tight', facecolor='#F5F1E8')

slide.addImage({ path: "competitor_share_chart.png", x: 0.45, y: 1.2, w: 5.55, h: 3.2 });
slide.addTable(
  [
    [
      { text: "Produttore", options: { bold: true, fontSize: 9 } },
      { text: "Val EURM", options: { bold: true, fontSize: 9, align: "right" } },
      { text: "Quota %", options: { bold: true, fontSize: 9, align: "right" } },
      { text: "Delta pp", options: { bold: true, fontSize: 9, align: "right" } },
    ],
    ["San Carlo", "245.2", "24.0%", "+0.6"],
    ["Mondelez", "97.8", "9.6%", "+0.1"],
    ["Kellanova", "93.7", "9.2%", "-0.4"],
    ["PepsiCo", "38.4", "3.8%", "-0.2"],
  ],
  {
    x: 6.2, y: 1.2, w: 3.55, h: 2.85,
    fontSize: 9, fontFace: "Arial",
    border: { type: "solid", pt: 0.5, color: "D6D1C4" },
    color: "0B0C0C",
    rowH: [0.3, 0.27, 0.27, 0.27, 0.27],
    colW: [1.35, 0.8, 0.7, 0.7],
    fill: "FBF8F1",
    autoPage: false,
  }
);
slide.addText("La crescita dei player diversificati e visibile nel delta quota e confermata dalla tabella a destra, quindi la raccomandazione puo ancorarsi direttamente a questo exhibit.", {
  x: 0.45, y: 4.55, w: 9.3, h: 0.4,
  fontSize: 10, fontFace: "Arial", color: "5D656B"
});
</example>

<example name="client_pleasing_recommendation_card">
// Recommendation card with opportunity-first framing and explicit evidence anchor.
// Do NOT attack the client or the hero format. Lead with the growth pool.

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});
slide.addText("Catturare EUR4.8M nel Multipack, il formato in maggiore crescita (+5.0%)", {
  x: 0.45, y: 0.32, w: 11.7, h: 0.62,
  fontSize: 20, fontFace: "Arial", color: "0B0C0C", bold: true
});

slide.addText([
  { text: "1", options: { fontSize: 28, bold: true, color: "1A6AFF" } },
  { text: "\\n\\nMultipack Pringles (3-5 pz)\\n", options: { fontSize: 12, bold: true, color: "0B0C0C" } },
  { text: "Sviluppare per Super e Hyper 2500-4999. Il Multipack e il secondo formato per dimensione (EUR159.9M) e il primo per crescita. Quota immediata del 3% = EUR4.8M (cfr. slide 9).", options: { fontSize: 10, color: "5D656B" } },
  { text: "\\n\\nLeva: Pack Architecture | Timeline: Q3 2026 | Impatto: EUR4.8M base", options: { fontSize: 9, color: "6B7280" } },
], {
  x: 0.45, y: 1.55, w: 4.35, h: 3.15,
  valign: "top",
  margin: 0.14,
  fill: { color: "FBF8F1" },
  line: { color: "D6D1C4", pt: 1 },
  breakLine: false,
});

slide.addText("The canister remains the revenue pillar. The recommendation adds incremental growth by entering the fastest-growing adjacency rather than attacking the core format.", {
  x: 5.2, y: 1.9, w: 5.1, h: 1.0,
  fontSize: 11, fontFace: "Arial", color: "5D656B", breakLine: false
});
</example>

<example name="multi_series_line_direct_labels">
## Multi-series line chart with direct end-of-line labels

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(9.25, 3.5), dpi=300)
years = [2020, 2021, 2022, 2023, 2024, 2025]
series = {
    "Dept Stores": [269, 311, 317, 335, 336, 337],
    "Jewellery": [159, 195, 209, 228, 234, 248],
    "Sports": [151, 172, 181, 191, 195, 201],
    "Bags": [34, 40, 45, 50, 51, 52],
}
series_colors = ['#1A1A2E', ACCENT, '#8B7355', '#4A6274']

for (name, values), color in zip(series.items(), series_colors):
    ax.plot(years, values, color=color, linewidth=2.2, marker='o', markersize=4)
    ax.annotate(
        f"{name} {values[-1]}",
        xy=(years[-1], values[-1]),
        xytext=(8, 0),
        textcoords='offset points',
        fontsize=9,
        fontweight='bold',
        color=color,
        va='center'
    )

ax.set_xlim(2019.5, 2026.2)
ax.grid(axis='y')
ax.spines[['top', 'right']].set_visible(False)
ax.spines['left'].set_color(BORDER)
ax.spines['bottom'].set_color(BORDER)
ax.tick_params(colors=MUTED, labelsize=10)
legend = ax.get_legend()
if legend:
    legend.remove()
# The slide footer band carries the single canonical source line.
plt.subplots_adjust(bottom=0.18, right=0.88)
plt.tight_layout()
plt.savefig("line_direct_labels.png", dpi=300, bbox_inches='tight', pad_inches=0.15)
</example>

<example name="perfect_cover_slide">
// Cover slide — only title + subtitle. No KPI cards, no accent bars, no extra geometry.
// Title = one-sentence finding with a number. Subtitle = client + source + period.

const slide = pptx.addSlide(${BASQUIO_COVER_ARGS_PLACEHOLDER});
const SOURCE_Y = 6.95;

slide.addText("Il Discount perde 0.5pp confezioni vs Totale Italia: servono velocità e premium mix", {
  x: 1.1, y: 2.6, w: 9.0, h: 1.8,
  fontSize: 28, fontFace: "Arial", color: "0B0C0C", bold: true
});

slide.addText("Analisi per Gruppo VeGe | NielsenIQ RMS | L52W a S22/02/26", {
  x: 1.1, y: 4.5, w: 8.0, h: 0.6,
  fontSize: 14, fontFace: "Arial", color: "5D656B"
});

slide.addText("Confidential", {
  x: 1.1, y: SOURCE_Y, w: 5.0, h: 0.3,
  fontSize: 8, fontFace: "Arial", color: "6B6A72"
});
</example>

<example name="perfect_chart_split_slide">
// Chart-split slide: horizontal bar chart LEFT + structured analysis RIGHT
// Use this for diagnostic slides where one chart proves a point and the text explains why

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});
slide.background = { color: "F5F1E8" };

slide.addText("COMPARTI CRITICI", {
  x: 0.6, y: 0.5, w: 12.1, h: 0.25,
  fontSize: 9, fontFace: "Arial", color: "1A6AFF", letterSpacing: 1.5, bold: true
});

slide.addText("8 comparti su 10 perdono velocità: Freddo e Cura Casa guidano il gap a -3.5pp", {
  x: 0.6, y: 0.8, w: 12.1, h: 0.7,
  fontSize: 20, fontFace: "Arial", color: "0F172A", bold: true
});

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

categories = ["Freddo", "Cura Casa", "Cura Persona", "Bevande", "Drogheria", "Pet Care", "Fresco", "Ortofrutta"]
gaps = [-3.8, -3.5, -2.8, -2.9, -2.8, -2.9, -1.0, +3.1]
colors = ["#E8636F" if g < -2 else "#F0CC27" if g < 0 else "#4CC9A0" for g in gaps]

fig, ax = plt.subplots(figsize=(6.2, 4.25))
bars = ax.barh(categories, gaps, color=colors)
ax.bar_label(bars, fmt='%+.1fpp', padding=5, fontsize=9, color="#5D656B")
ax.axvline(x=0, color="#6B6A72", linewidth=0.5)
ax.invert_yaxis()
ax.set_xlabel("Gap confezioni/pdv Discount vs TI (pp)", fontsize=9, color="#5D656B")
ax.spines[['top', 'right']].set_visible(False)
ax.spines['left'].set_color('#D6D1C4')
ax.spines['bottom'].set_color('#D6D1C4')
ax.set_facecolor('#F5F1E8')
fig.patch.set_facecolor('#F5F1E8')
# The slide footer band carries the single canonical source line.
plt.subplots_adjust(bottom=0.12)
plt.tight_layout()
plt.savefig("chart_gaps.png", dpi=300, bbox_inches='tight', facecolor='#F5F1E8')

slide.addImage({ path: "chart_gaps.png", x: 0.6, y: 1.75, w: 6.2, h: 4.25 });

slide.addText("Diagnosi: Velocity Problem", {
  x: 7.1, y: 1.75, w: 5.6, h: 0.4,
  fontSize: 14, fontFace: "Arial", color: "0F172A", bold: true
});

slide.addText([
  "La distribuzione ponderata ACV cresce o è stabile in 8 aree su 10. La mancanza di prodotto a scaffale non è il problema.",
  "",
  "Le confezioni vendute per punto vendita scendono su tutte le 10 aree: gli shopper visitano il Discount ma comprano meno unita per visita.",
  "",
  "Cause: (1) assortimento ridotto su varianti premium, (2) minor pressione promozionale, (3) migrazione verso altri canali."
].join("\\n"), {
  x: 7.1, y: 2.25, w: 5.6, h: 2.5,
  fontSize: 11, fontFace: "Arial", color: "374151", lineSpacing: 14, shrinkText: true
});

slide.addText("Il focus deve essere sull'intensificare la rotazione e ampliare l'offerta premium, non sull'aprire nuovi PDV.", {
  x: 7.1, y: 5.0, w: 5.6, h: 0.65,
  fontSize: 10, fontFace: "Arial", color: "0B0C0C",
  fill: { color: "1A6AFF", transparency: 85 }, shrinkText: true
});
</example>

<example name="perfect_recommendation_cards_slide">
// Recommendation cards using recommendation-cards archetype
// Note: use warm/light canvas, tonal cards, dark text, and exactly 2 action cards

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});
slide.background = { color: "F5F1E8" };

slide.addText("RACCOMANDAZIONI", {
  x: 0.6, y: 0.5, w: 12.1, h: 0.25,
  fontSize: 9, fontFace: "Arial", color: "1A6AFF", letterSpacing: 1.5, bold: true
});

slide.addText("Due azioni ad alta priorità per recuperare lo 0.5pp di gap confezioni", {
  x: 0.6, y: 0.8, w: 12.1, h: 0.7,
  fontSize: 20, fontFace: "Arial", color: "0B0C0C", bold: true
});

const cards = [
  {
    index: "1", color: "4CC9A0",
    title: "Ribilancia assortimento Birre e Yogurt",
    body: "Gap assortimento: -2 ref. vs benchmark canale (cfr. slide 5). Aggiungere 2 ref. no/low alcol + 3 SKU Yogurt Greco/Skyr per PDV. Rotazione Birre: +18% vs media.",
    lever: "Assortimento", impact: "+0.15pp conf", timeline: "3 mesi"
  },
  {
    index: "2", color: "1A6AFF",
    title: "Ripristina pressione promo su Salumi",
    body: "Intensità promo scesa da 28.5% a 25.7% (cfr. slide 7). Ripristinare soglie PY con promozioni di ingresso e multipack sui top-seller.",
    lever: "Promo", impact: "+0.05pp conf", timeline: "2 mesi"
  }
];

cards.forEach((card, i) => {
  const cx = 0.45 + i * 4.6;
  const cy = 1.5;
  slide.addShape(pptx.ShapeType.rect, {
    x: cx, y: cy, w: 4.15, h: 4.2,
    fill: { color: "FBF8F1" }, line: { color: "FBF8F1", transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: cx + 0.15, y: cy + 0.2, w: 0.45, h: 0.45,
    fill: { color: card.color }, rectRadius: 0.05
  });
  slide.addText(card.index, {
    x: cx + 0.15, y: cy + 0.2, w: 0.45, h: 0.45,
    fontSize: 16, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle"
  });
  slide.addText(card.title, {
    x: cx + 0.7, y: cy + 0.2, w: 3.2, h: 0.45,
    fontSize: 13, fontFace: "Arial", color: "0B0C0C", bold: true, valign: "middle"
  });
  slide.addText(card.body, {
    x: cx + 0.15, y: cy + 0.85, w: 3.7, h: 2.25,
    fontSize: 11, fontFace: "Arial", color: "5D656B", lineSpacing: 14, valign: "top", shrinkText: true
  });
  slide.addText("Leva: " + card.lever + " | Impatto: " + card.impact + " | Timeline: " + card.timeline, {
    x: cx + 0.15, y: cy + 3.45, w: 3.7, h: 0.45,
    fontSize: 9, fontFace: "Arial", color: "6B7280", valign: "bottom"
  });
});

slide.addText("Con interventi mirati in 90 giorni, il gap di -0.5pp è recuperabile. La distribuzione c'è già; serve velocità, non copertura.", {
  x: 0.45, y: 6.3, w: 12.1, h: 0.45,
  fontSize: 10, fontFace: "Arial", color: "0B0C0C",
  fill: { color: "1A6AFF", transparency: 76 }
});
</example>

<example name="evidence_grid_chart_plus_table">
// Evidence-grid: chart LEFT + compact data table RIGHT for evidence co-location
// Use this pattern on EVERY analytical slide so the analyst can validate numbers at a glance

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});
slide.background = { color: "F5F1E8" };

slide.addText("LANDSCAPE COMPETITIVO", {
  x: 0.45, y: 0.22, w: 12.4, h: 0.18,
  fontSize: 9, fontFace: "Arial", color: "1A6AFF", letterSpacing: 1.5, bold: true
});
slide.addText("San Carlo cresce +1,7% diversificando su 10 brand; Kellanova cala -5,0% concentrata sul tubo", {
  x: 0.45, y: 0.42, w: 12.4, h: 0.65,
  fontSize: 20, fontFace: "Arial", color: "0B0C0C", bold: true
});

// Chart rendered via matplotlib at chart-split dimensions
slide.addImage({ path: "competitor_share_chart.png", x: 0.4, y: 1.3, w: 5.8, h: 3.5 });

// Compact data table with supporting numbers — RIGHT of chart
slide.addTable(
  [
    [
      { text: "Produttore", options: { bold: true, fontSize: 9, color: "0B0C0C", fill: { color: "F5F1E8" } } },
      { text: "Val \\u20ACM", options: { bold: true, fontSize: 9, color: "0B0C0C", align: "right", fill: { color: "F5F1E8" } } },
      { text: "Quota", options: { bold: true, fontSize: 9, color: "0B0C0C", align: "right", fill: { color: "F5F1E8" } } },
      { text: "\\u0394 pp", options: { bold: true, fontSize: 9, color: "0B0C0C", align: "right", fill: { color: "F5F1E8" } } },
    ],
    ["San Carlo", { text: "245,2", options: { align: "right" } }, { text: "24,0%", options: { align: "right" } }, { text: "+0,6", options: { align: "right", color: "059669" } }],
    ["Mondelez", { text: "97,8", options: { align: "right" } }, { text: "9,6%", options: { align: "right" } }, { text: "+0,1", options: { align: "right", color: "059669" } }],
    ["Kellanova", { text: "93,7", options: { align: "right" } }, { text: "9,2%", options: { align: "right" } }, { text: "-0,4", options: { align: "right", color: "DC2626" } }],
    ["PepsiCo", { text: "38,4", options: { align: "right" } }, { text: "3,8%", options: { align: "right" } }, { text: "-0,2", options: { align: "right", color: "DC2626" } }],
  ],
  {
    x: 6.5, y: 1.3, w: 6.3, colW: [1.8, 1.2, 1.1, 1.0],
    fontSize: 9, fontFace: "Arial", color: "374151",
    border: { type: "solid", pt: 0.5, color: "D6D1C4" },
    rowH: [0.3, 0.28, 0.28, 0.28, 0.28],
    autoPage: false,
  }
);

slide.addText("I player con portafoglio diversificato crescono; chi concentra su un singolo formato arretra", {
  x: 0.45, y: 5.1, w: 12.4, h: 0.42,
  fontSize: 10, fontFace: "Arial", color: "0B0C0C",
  fill: { color: "1A6AFF", transparency: 85 }
});
slide.addText("Fonte: NielsenIQ RMS | L52W | Top 8 produttori per valore", {
  x: 0.45, y: 6.95, w: 12.4, h: 0.25,
  fontSize: 8, fontFace: "Arial", color: "6B7280"
});
</example>

<example name="client_pleasing_recommendation_card">
// Client-pleasing recommendation: OPPORTUNITY FIRST, then lever and evidence anchor
// Title states the gain pool. Body explains how. Footer has lever/impact/timeline.
// This is the correct framing for a client who is PAYING for this analysis.

const slide = pptx.addSlide(${BASQUIO_MASTER_ARGS_PLACEHOLDER});
slide.background = { color: "F5F1E8" };

slide.addText("RACCOMANDAZIONE 1 | PRIORITY 1 (MUST-WIN)", {
  x: 0.45, y: 0.22, w: 12.4, h: 0.18,
  fontSize: 9, fontFace: "Arial", color: "1A6AFF", letterSpacing: 1.5, bold: true
});

// Title states the OPPORTUNITY, not the problem
// GOOD: "Catturare \\u20AC4,8M nel Multipack"
// BAD: "Kellanova ha quota zero nel Multipack"
slide.addText("Catturare \\u20AC4,8M nel Multipack \\u2014 il formato in maggiore crescita (+5,0%)", {
  x: 0.45, y: 0.42, w: 12.4, h: 0.65,
  fontSize: 20, fontFace: "Arial", color: "0B0C0C", bold: true
});

// Two cards: action + evidence
const cx1 = 0.45, cx2 = 5.1;
const cy = 1.3;

// Card 1: ACTION
slide.addText("", { x: cx1, y: cy, w: 4.3, h: 4.0, fill: { color: "FBF8F1" } });
slide.addText("", { x: cx1, y: cy, w: 0.08, h: 4.0, fill: { color: "4CC9A0" } });
slide.addText("L\\u2019AZIONE", {
  x: cx1 + 0.2, y: cy + 0.15, w: 3.9, h: 0.3,
  fontSize: 11, fontFace: "Arial", color: "0B0C0C", bold: true
});
slide.addText(
  "Sviluppare un Multipack Pringles (3-5 pz, 40g ciascuno) per il canale Super e Hyper 2500-4999. " +
  "Posizionamento: snack quotidiano e lunchbox, non sharing serale. " +
  "Prezzo per kg superiore al tubo Large Sharing per proteggere marginalit\\u00E0.",
  { x: cx1 + 0.2, y: cy + 0.55, w: 3.9, h: 2.3,
    fontSize: 11, fontFace: "Arial", color: "5D656B", lineSpacing: 14, valign: "top", shrinkText: true }
);
slide.addText("Leva: Pack Architecture | Timeline: Q3 2026 lancio | Impatto base: \\u20AC4,8M", {
  x: cx1 + 0.2, y: cy + 3.2, w: 3.9, h: 0.5,
  fontSize: 9, fontFace: "Arial", color: "6B7280", valign: "bottom"
});

// Card 2: EVIDENCE + SCENARIOS
slide.addText("", { x: cx2, y: cy, w: 4.3, h: 4.0, fill: { color: "FBF8F1" } });
slide.addText("", { x: cx2, y: cy, w: 0.08, h: 4.0, fill: { color: "1A6AFF" } });
slide.addText("EVIDENZA & SCENARI", {
  x: cx2 + 0.2, y: cy + 0.15, w: 3.9, h: 0.3,
  fontSize: 11, fontFace: "Arial", color: "0B0C0C", bold: true
});
slide.addText(
  "Pool Multipack: \\u20AC159,9M, +5,0% YoY (cfr. slide 9). " +
  "Kellanova oggi: quota ~0%. Mondelez 43%, San Carlo 26%.\\n\\n" +
  "Scenario Base: 3% quota = \\u20AC4,8M\\n" +
  "Scenario Ambizioso: 5% quota = \\u20AC8,0M\\n" +
  "Scenario Prudente: 1,5% quota = \\u20AC2,4M\\n\\n" +
  "Rischio: cannibalizzazione tubo Large Sharing.\\n" +
  "Mitigazione: posizionamento su occasioni diverse, prezzo/kg superiore.",
  { x: cx2 + 0.2, y: cy + 0.55, w: 3.9, h: 3.1,
    fontSize: 11, fontFace: "Arial", color: "5D656B", lineSpacing: 14, valign: "top", shrinkText: true }
);
</example>

<example name="kpi_card_correct_layout">
// CORRECT KPI card layout: each element has DIFFERENT y-coordinates
// The background rect is the container. Label, value, and delta are SEPARATE addText calls
// with OFFSET y-positions INSIDE the card region.
//
// WRONG (stacking bug):
//   addText("", { x: 0.45, y: 1.5, w: 3.0, h: 1.25, fill: { color: "FFFFFF" } });  // background
//   addText("LABEL", { x: 0.45, y: 1.5, w: 3.0, h: 1.25 });  // SAME position = invisible
//
// CORRECT (offset layout):
//   addText("", { x: 0.45, y: 1.5, w: 3.0, h: 1.25, fill: { color: "FFFFFF" } });  // background card
//   addText("", { x: 0.45, y: 1.5, w: 0.08, h: 1.25, fill: { color: "1A6AFF" } }); // accent bar at left edge
//   addText("LABEL", { x: 0.65, y: 1.6, w: 2.75, h: 0.2 });   // label near TOP
//   addText("\\u20AC781M", { x: 0.65, y: 1.8, w: 2.75, h: 0.55 }); // value in MIDDLE
//   addText("+8.2%", { x: 0.65, y: 2.35, w: 2.75, h: 0.25 });  // delta at BOTTOM

// For a row of 4 KPI cards spaced horizontally:
const cardWidth = 2.9;
const cardGap = 0.25;
const startX = 0.45;
const cardY = 1.5;
const cardH = 1.15;
const accentColors = ["1A6AFF", "31D1FF", "59AD00", "EF5F17"];

const kpis = [
  { label: "VALORE CATEGORIA", value: "\\u20AC1.020M", delta: "-0,67% YoY" },
  { label: "MULTIPACK", value: "\\u20AC160M", delta: "+5,0% YoY" },
  { label: "VEGETABLE CHIPS", value: "\\u20AC27M", delta: "+34% YoY" },
  { label: "KELLANOVA", value: "\\u20AC93,7M", delta: "-5,0% YoY" },
];

kpis.forEach((kpi, i) => {
  const cx = startX + i * (cardWidth + cardGap);
  // 1. Background card
  slide.addText("", { x: cx, y: cardY, w: cardWidth, h: cardH, fill: { color: "FFFFFF" } });
  // 2. Left accent bar (same x, same y, tiny width)
  slide.addText("", { x: cx, y: cardY, w: 0.08, h: cardH, fill: { color: accentColors[i] } });
  // 3. Label — offset right and slightly down from card top
  slide.addText(kpi.label, {
    x: cx + 0.2, y: cardY + 0.1, w: cardWidth - 0.35, h: 0.2,
    fontSize: 9, fontFace: "Arial", color: "6B7280"
  });
  // 4. Value — below label
  slide.addText(kpi.value, {
    x: cx + 0.2, y: cardY + 0.3, w: cardWidth - 0.35, h: 0.45,
    fontSize: 22, fontFace: "Arial", color: "060A45", bold: true
  });
  // 5. Delta — at bottom of card
  slide.addText(kpi.delta, {
    x: cx + 0.2, y: cardY + 0.8, w: cardWidth - 0.35, h: 0.25,
    fontSize: 10, fontFace: "Arial", color: "060A45"
  });
});
</example>

<example name="perfect_pareto_chart">
// Pareto chart: bars + cumulative line on secondary axis
// Use for concentration, contribution, or any "vital few" analysis

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

categories = ["Pasta Ripiena", "Zuppe Pronte", "Primi Riso", "Insalate Pasta", "Piatti Pronti", "Sughi Freschi", "Basi Pizza", "Altre"]
values = [28.5, 18.2, 14.7, 11.3, 9.8, 7.1, 5.9, 4.5]
cumulative = np.cumsum(values)

fig, ax1 = plt.subplots(figsize=(8, 4.5))
colors = ["#2563EB" if c <= 80 else "#94A3B8" for c in cumulative]
bars = ax1.bar(categories, values, color=colors, width=0.65)
ax1.bar_label(bars, fmt='%.1f%%', padding=3, fontsize=8, color="#374151")
ax1.set_ylabel("% Vendite Valore", fontsize=9, color="#6B7280")
ax1.tick_params(axis='x', rotation=35, labelsize=8)

ax2 = ax1.twinx()
ax2.plot(categories, cumulative, color="#DC2626", marker='o', markersize=5, linewidth=1.5)
ax2.axhline(y=80, color="#DC2626", linestyle='--', alpha=0.5, linewidth=0.8)
ax2.set_ylabel("% Cumulata", fontsize=9, color="#DC2626")
for i, v in enumerate(cumulative):
    ax2.annotate(f'{v:.0f}%', (i, v), textcoords="offset points", xytext=(0, 8), fontsize=7, color="#DC2626")

ax1.spines[['top']].set_visible(False)
ax2.spines[['top']].set_visible(False)
# The slide footer band carries the single canonical source line.
plt.tight_layout()
plt.savefig("pareto_skus.png", dpi=300, bbox_inches='tight')

slide.addImage({ path: "pareto_skus.png", x: 0.6, y: 1.75, w: 7.0, h: 4.25 });
</example>

<example name="perfect_analytical_reasoning">
## How to reason about the data before building each slide

For each analytical slide, follow this reasoning chain:

1. WHAT changed: "Discount channel grew +2.1% vs prior year"
2. HOW MUCH: "vs Total Italy at +4.3%, creating a -2.2pp gap"
3. WHY: "Three compartments drive 60% of the gap: Birre (-2.2pp gap, 3.9% of sales), Yogurt (-2.8pp gap, 3.4%), Salumi (-1.0pp gap, 4.6%)"
4. SO WHAT: "Recommendation: fix premium assortment in Birre and Yogurt first, then rebuild promo pressure in Salumi. Priority: Birre > Yogurt > Salumi based on weighted gap contribution and channel relevance."

A slide that only states facts 1-2 is a data readout, not analysis. A slide worth paying for states all four, with the recommendation grounded in the specific numbers from the evidence.
A slide that quantifies the WHAT and WHY but not the HOW MUCH IN EUR is still valid analysis when the source data does not support a clean financial translation.
When the data contains explicit value or volume, compute the EUR impact and show the calculation.
When exact EUR is not computable from the evidence, use directional language such as "material gap", "priority opportunity", or "significant headroom" instead of inventing a range.
</example>

<example name="content_budget_rules">
## Content budgets per text zone

- SCQA sections: max 2-3 lines each (40-60 words per section). If longer, restructure as bullet points.
- Diagnostic bullets on chart-split slides: max 4 bullets, each max 25 words.
- Callout/action text: max 2 lines (30-40 words). Quantify the action, don't describe the context.
- Recommendation card body: max 3-4 lines (40-60 words). Lead with the lever, not the finding.
- Recommendation and key-findings cards must have at least 3 lines of body text. If the insight is too brief, expand with the exact data point, the business implication, or the concrete next action.
- Recommendation cards in a 4-column layout: title max 6 words, body max 4 lines at fontSize 9, footer metrics always visible with fixed space.
- Recommendation cards: prioritize the action verb, the EUR prize, and the timeline. Cut context and support detail before you cut those three.
- Recommendation cards: use shrinkText: true on every recommendation-card text box.

If text would exceed these budgets, you are being too descriptive. Cut context, keep the number and the action.
</example>

<example name="dense_chart_split">
## When data is too dense for one chart

BAD: 4 brands x 6 channels = 24 bars in one grouped bar chart.
This creates thin bars, unreadable labels, and weak diagnosis.

GOOD: Split the analysis into two slides:
- Slide A: Traditional channels (Hyper, Super, Superettes) -> 4 brands x 3 channels = 12 bars
- Slide B: Growth channels (Discount, SSSDrug, Pet Specialist) -> 4 brands x 3 channels = 12 bars

Each slide then has enough room for readable labels, a larger chart title, and diagnostic text.

Alternative: if the point is cross-tab comparison rather than exact rank ordering, use a heatmap table instead of a grouped bar.
</example>

<example name="confidence_calibration">
## Confidence calibration

Distinguish between data-backed findings and inferred interpretations:

- DATA-BACKED: "Milano IDX 145 vs Roma IDX 84 su Servizio Primi" -> state as fact, cite source.
- INFERRED: "Roma's cooking culture explains the under-index on ready meals" -> hedge with "I dati suggeriscono che...", "Coerente con il profilo...", or "Verosimilmente legato a...".

Never present cultural or demographic interpretations as data-proven facts.
The methodology section should explicitly flag what is measured vs inferred.
A senior analyst adds the caveat. A junior states inferences as facts.
</example>

<example name="metadata_rules">
## Metadata rules

- Cover slide date must match the data source period, not today's date or a placeholder.
- If the data header says "MAT Febbraio 2026", the cover says "Febbraio 2026".
- Every content slide needs a source citation in this format: "Fonte: {provider} | {period} | {geography}".
</example>

<example name="perfect_slide_title_examples">
## Insight-driven titles (DO) vs topic titles (DON'T)

DON'T: "Analisi del Gap per Area"
DO: "Discount perde 2.2pp vs Italia: Birre, Yogurt e Salumi spiegano il 60% del divario"

DON'T: "Performance per Comparto"
DO: "Yogurt cresce +5.1% ma resta 2.8pp sotto Italia — distribuzione limitata a 67% dei PDV"

DON'T: "Raccomandazioni"
DO: "Tre leve per recuperare 1.5pp entro H2: distribuzione Birre, facing Yogurt, profondita promo Salumi"

Every title states the finding AND its magnitude. The reader knows the insight before opening the slide.
</example>

<example name="chart_theme_and_sizing_preamble">
## Basquio chart preamble and slot sizing

# Paste this exact block at the top of every matplotlib chart script.
# The prompt already resolves these tokens to the active template palette when a client template is present.
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

BG = '#F5F1E8'
TEXT = '#0B0C0C'
MUTED = '#5D656B'
DIM = '#6B7280'
BORDER = '#D6D1C4'
ACCENT = '#1A6AFF'
POSITIVE = '#4CC9A0'
NEGATIVE = '#E8636F'
PALETTE = ['#F0CC27', '#1A6AFF', '#4CC9A0', '#9B7AE0', '#E8636F', '#5AC4D4', '#6B7280', '#7ABBE0']

plt.rcParams.update({
    'figure.facecolor': BG,
    'axes.facecolor': BG,
    'text.color': TEXT,
    'axes.labelcolor': MUTED,
    'xtick.color': DIM,
    'ytick.color': DIM,
    'axes.edgecolor': BORDER,
    'grid.color': BORDER,
    'grid.alpha': 0.15,
    'legend.facecolor': 'none',
    'legend.edgecolor': 'none',
    'legend.labelcolor': MUTED,
    'font.family': 'Arial',
    'font.size': 11,
})

# Match figure size to the slide slot.
# title-chart: figsize=(9.25, 3.5), dpi=300
# chart-split: figsize=(5.75, 3.5), dpi=300
# evidence-grid: figsize=(5.75, 2.55), dpi=300
# comparison: figsize=(4.55, 3.2), dpi=300
# scenario-cards: figsize=(5.5, 3.5), dpi=300
# Never render below figsize=(4, 2); charts smaller than that become unreadable in PPTX.

def format_it_number(value: float) -> str:
    return f"{value:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")

def apply_currency_axis_formatter(ax, max_val: float, language: str = "it"):
    if max_val > 1_000_000:
        scale, suffix = 1e6, " Mln" if language == "it" else "M"
    elif max_val > 1_000:
        scale, suffix = 1e3, "K"
    else:
        scale, suffix = 1, ""

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(
        lambda x, _: f"{chr(8364)}{format_it_number(x / scale)}{suffix}" if language == "it" else f"{chr(8364)}{x/scale:,.1f}{suffix}"
    ))

# Example usage after you create the axes:
# max_val = df["V. Valore"].max()
# apply_currency_axis_formatter(ax, max_val, language="it")
# 13_640_000 becomes €13,6 Mln — never €13,6K.
# For currency axes and tick labels, always call apply_currency_axis_formatter().
# Do not type the euro symbol directly into axis labels or tick formatter lambdas.
</example>

<example name="data_tables_xlsx_with_native_charts">
## data_tables.xlsx with native Excel chart objects

import pandas as pd

with pd.ExcelWriter('data_tables.xlsx', engine='xlsxwriter') as writer:
    workbook = writer.book

    brand_df = brand_share_top10[['Brand', 'Quota_CY_pct']].copy()
    brand_df.to_excel(writer, sheet_name='S15_BrandShare', index=False)
    worksheet = writer.sheets['S15_BrandShare']

    bar_chart = workbook.add_chart({'type': 'bar'})
    bar_chart.add_series({
        'name': ['S15_BrandShare', 0, 1],
        'categories': ['S15_BrandShare', 1, 0, len(brand_df), 0],
        'values': ['S15_BrandShare', 1, 1, len(brand_df), 1],
        'fill': {'color': ACCENT},
        'data_labels': {'value': True},
    })
    bar_chart.set_title({'name': 'S15 - Top 10 brand - Quota CY %'})
    bar_chart.set_x_axis({'name': 'Quota CY %'})
    bar_chart.set_y_axis({'name': 'Brand'})
    worksheet.insert_chart('G2', bar_chart)

    trend_df = monthly_sales_trend[['Period', 'SalesValue']].copy()
    trend_df.to_excel(writer, sheet_name='S22_SalesTrend', index=False)
    worksheet = writer.sheets['S22_SalesTrend']

    line_chart = workbook.add_chart({'type': 'line'})
    line_chart.add_series({
        'name': ['S22_SalesTrend', 0, 1],
        'categories': ['S22_SalesTrend', 1, 0, len(trend_df), 0],
        'values': ['S22_SalesTrend', 1, 1, len(trend_df), 1],
        'line': {'color': ACCENT, 'width': 2.25},
    })
    line_chart.set_title({'name': 'S22 - Sales trend'})
    line_chart.set_x_axis({'name': 'Period'})
    line_chart.set_y_axis({'name': 'Sales Value'})
    worksheet.insert_chart('G2', line_chart)

# For every supported chart-bearing slide:
# - sheet name = S<NN>_<descriptor>
# - native Excel chart anchor = G2 unless another anchor is necessary
# - deck_manifest.json chart entry includes excelSheetName and excelChartCellAnchor
# For unsupported Excel chart families (for example waterfall, heatmap, bubble):
# write the exact DataFrame sheet and set excelSheetName, but omit excelChartCellAnchor.
</example>

<example name="chart_emphasis_and_label_safety">
## Highlight the insight and separate labels cleanly

fig, ax = plt.subplots(figsize=(5.75, 3.5))
categories = ["Cat Food", "Dog Food", "Treats", "Litter"]
shares = [37.0, 29.4, 18.2, 15.4]
growths = [2.5, -1.1, 4.2, 0.6]
colors = [ACCENT, '#3A3940', '#3A3940', '#3A3940']

bars = ax.barh(categories, shares, color=colors, height=0.58)
ax.set_xlim(0, 45)
ax.grid(axis='x')
ax.invert_yaxis()
ax.spines[['top', 'right']].set_visible(False)
ax.spines['left'].set_color(BORDER)
ax.spines['bottom'].set_visible(False)

for i, (share, growth) in enumerate(zip(shares, growths)):
    ax.text(share + 0.6, i, f'{share:.1f}%', va='center', fontsize=10, color=TEXT)
    growth_color = POSITIVE if growth >= 0 else NEGATIVE
    ax.text(share + 4.2, i, f'{"+" if growth >= 0 else ""}{growth:.1f}%', va='center', fontsize=9, color=growth_color)

# GOOD: share and growth are separate labels, so they never collide.
# BAD: ax.text(share, i, f'{share:.1f}%({growth:+.1f}%)')  # never combine two metrics in one label

# The slide footer band carries the single canonical source line.
plt.subplots_adjust(bottom=0.18)
plt.tight_layout()
# After saving any chart: expand axes to fill the frame
# ax.set_position([0.08, 0.15, 0.88, 0.75])  # [left, bottom, width, height]
plt.savefig("chart_safe_labels.png", dpi=300, bbox_inches='tight', pad_inches=0.15)
</example>

<example name="layout_variety_example">
## Layout plan example for a 15-slide consulting deck

15-slide deck layout plan:
1. cover
2. exec-summary (3-5 KPIs + SCQA body)
3. title-chart (full-width channel growth)
4. chart-split (market share chart + text)
5. chart-split (brand portfolio chart + text)
6. comparison (dual-panel distribution comparison)
7. evidence-grid (metrics + chart)
8. title-chart (full-width pricing analysis)
9. chart-split (competitive landscape + text)
10. evidence-grid (promo effectiveness metrics + chart)
11. key-findings (3 key findings)
12. title-chart (full-width growth bridge waterfall)
13. recommendation-cards (3 priority actions)
14. scenario-cards (bear/base/bull scenarios)
15. summary (next steps)

Layout count:
- cover(1)
- exec-summary(1)
- title-chart(3)
- chart-split(3)
- comparison(1)
- evidence-grid(2)
- key-findings(1)
- recommendation-cards(1)
- scenario-cards(1)
- summary(1)

This yields 10 layout types and keeps no type above 3 slides.
</example>

<example name="cross_tab_heatmap">
## Cross-tab heatmap for brand x geography analysis

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

brands = ["Macy's", "Nordstrom", "Liverpool", "Coppel", "Kohl's"]
geos = ["USA", "Mexico", "India", "UK", "Japan"]
data = np.array([
    [6.8, 2.1, 15.9, -1.2, 1.2],
    [4.3, 1.8, 9.7, 3.2, 2.4],
    [1.5, 13.6, 5.1, 0.8, -0.6],
    [0.4, 10.2, 3.9, -0.4, 1.1],
    [2.9, 1.4, 7.2, 2.5, 3.4],
])

fig, ax = plt.subplots(figsize=(9.25, 3.5), dpi=300)
im = ax.imshow(data, cmap='RdYlGn', aspect='auto', vmin=-5, vmax=18)
ax.set_xticks(range(len(geos)), labels=geos)
ax.set_yticks(range(len(brands)), labels=brands)
ax.tick_params(axis='x', labelsize=10, colors=TEXT)
ax.tick_params(axis='y', labelsize=10, colors=TEXT)

for row in range(data.shape[0]):
    for col in range(data.shape[1]):
        value = data[row, col]
        ax.text(
            col,
            row,
            f"{value:+.1f}%",
            ha='center',
            va='center',
            fontsize=10,
            fontweight='bold',
            color='white' if value >= 9 else TEXT,
        )

colorbar = fig.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
colorbar.outline.set_edgecolor(BORDER)
colorbar.ax.tick_params(labelsize=8, colors=MUTED)
ax.set_title("Revenue CAGR by Brand x Geography", fontsize=12, fontweight='bold', color=TEXT, pad=10)
for spine in ax.spines.values():
    spine.set_color(BORDER)
# The slide footer band carries the single canonical source line.
plt.tight_layout()
plt.savefig("brand_geo_heatmap.png", dpi=300, bbox_inches='tight', pad_inches=0.12)
</example>

<example name="waterfall_bridge_example">
## Waterfall chart for a growth bridge

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

base_value = 1030
deltas = [89, 50, 18, 68, 69]
labels = ["2020 Base", "Jewellery", "Sports", "Bags", "Dept Stores", "Homewares", "2025 Total"]
values = [base_value, *deltas, base_value + sum(deltas)]
bottoms = [0, 1030, 1119, 1169, 1187, 1255, 0]
colors = [ACCENT, POSITIVE, POSITIVE, POSITIVE, POSITIVE, POSITIVE, ACCENT]

fig, ax = plt.subplots(figsize=(9.25, 3.5), dpi=300)
bars = ax.bar(range(len(labels)), values, bottom=bottoms, color=colors, width=0.62)

for index, (bar, value, bottom) in enumerate(zip(bars, values, bottoms)):
    label_y = bottom + value / 2
    label = f"CHF {value}bn" if index in {0, len(labels) - 1} else f"+{value}bn"
    ax.text(bar.get_x() + bar.get_width() / 2, label_y, label, ha='center', va='center', fontsize=9, fontweight='bold', color='white')

for index in range(1, len(labels) - 1):
    step_top = bottoms[index] + values[index]
    ax.plot([index - 0.31, index + 0.31], [step_top, step_top], color=BORDER, linewidth=1)

ax.set_xticks(range(len(labels)), labels=["2020\nBase", "Jewellery", "Sports", "Bags", "Dept\nStores", "Homewares", "2025\nTotal"])
ax.tick_params(axis='x', labelsize=9, colors=TEXT)
ax.tick_params(axis='y', labelsize=9, colors=MUTED)
ax.spines[['top', 'right']].set_visible(False)
ax.spines['left'].set_color(BORDER)
ax.spines['bottom'].set_color(BORDER)
ax.grid(axis='y')
ax.set_title("Where CHF 294bn of growth came from, 2020-2025", fontsize=12, fontweight='bold', color=TEXT, pad=10)
# The slide footer band carries the single canonical source line.
plt.tight_layout()
plt.savefig("waterfall_bridge.png", dpi=300, bbox_inches='tight', pad_inches=0.12)
</example>

<example name="growth_size_scatter_bcg">
## Scatter / BCG-style quadrant chart with direct labels

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

markets = ["China", "USA", "India", "Mexico", "Japan"]
size = [131, 46, 4.4, 12, 7.2]      # Revenue CHF bn
growth = [1.3, 7.6, 16.9, 12.7, 5.3] # CAGR %
colors = [ACCENT if value >= 10 else "#94A3B8" for value in growth]
areas = [max(v * 18, 120) for v in size]

fig, ax = plt.subplots(figsize=(9.25, 3.5), dpi=300)
ax.scatter(size, growth, s=areas, c=colors, alpha=0.85, edgecolors=BORDER, linewidth=0.8)
ax.axhline(y=8, color=BORDER, linestyle='--', linewidth=0.8)
ax.axvline(x=20, color=BORDER, linestyle='--', linewidth=0.8)

for label, x, y in zip(markets, size, growth):
    ax.annotate(label, (x, y), xytext=(6, 6), textcoords='offset points', fontsize=9, fontweight='bold', color=TEXT)

ax.set_xlabel("Revenue 2025 (CHF bn)", fontsize=10, color=TEXT)
ax.set_ylabel("Revenue CAGR 2020-2025 (%)", fontsize=10, color=TEXT)
ax.tick_params(axis='x', labelsize=9, colors=MUTED)
ax.tick_params(axis='y', labelsize=9, colors=MUTED)
ax.spines[['top', 'right']].set_visible(False)
ax.spines['left'].set_color(BORDER)
ax.spines['bottom'].set_color(BORDER)
ax.grid(axis='both', linestyle=':', linewidth=0.6, alpha=0.35)
ax.text(0.99, 0.97, "Scale x Growth", transform=ax.transAxes, ha='right', va='top', fontsize=8, color=MUTED)
# The slide footer band carries the single canonical source line.
plt.tight_layout()
plt.savefig("growth_size_scatter.png", dpi=300, bbox_inches='tight', pad_inches=0.12)
</example>

<example name="template_aware_chart_theme">
## Template-aware chart theme adaptation

# The structure stays the same for every template. Only the color tokens change.
# Keep the same rcParams keys, font sizes, spacing, and overlap-prevention rules.

THEME_BG = TEMPLATE_BG
THEME_TEXT = TEMPLATE_TEXT
THEME_MUTED = TEMPLATE_MUTED
THEME_BORDER = TEMPLATE_BORDER
THEME_ACCENT = TEMPLATE_ACCENT
THEME_POSITIVE = TEMPLATE_POSITIVE
THEME_NEGATIVE = TEMPLATE_NEGATIVE
THEME_PALETTE = TEMPLATE_CHART_PALETTE

plt.rcParams.update({
    'figure.facecolor': THEME_BG,
    'axes.facecolor': THEME_BG,
    'text.color': THEME_TEXT,
    'axes.labelcolor': THEME_MUTED,
    'xtick.color': THEME_MUTED,
    'ytick.color': THEME_MUTED,
    'axes.edgecolor': THEME_BORDER,
    'grid.color': THEME_BORDER,
    'legend.facecolor': 'none',
    'legend.edgecolor': 'none',
    'legend.labelcolor': THEME_MUTED,
    'font.family': 'Arial',
    'font.size': 11,
})

# Template fidelity changes palette and mood.
# It does NOT relax any readability rule:
# - charts still use dpi=300
# - charts still match slot figsize
# - labels still cannot overlap
# - legends still move outside the plot if needed
# - multi-series end labels should match the series color, not a neutral grey
# - titles, callouts, and cards still stay inside their bands
</example>

<example name="drill_down_cascade">
// GOOD long-deck pattern: each slide answers a deeper leaf question.
// Slide N
title: "Reconstituted loses 2,1pp share, with Super driving 65% of the decline"
chart: grouped_bar showing segment x channel share change

// Slide N+1
title: "Within Super, top-3 Reconstituted SKUs explain 70% of the value loss"
chart: pareto or horizontal_bar on SKU contribution

// Slide N+2
title: "Those SKUs carry a 108 price index, so the gap is pricing, not distribution"
chart: grouped_bar or waterfall on price index vs distribution

// This is real depth:
// L1 segment -> L2 channel -> L3 SKU/driver.
</example>

<example name="bad_redundant_broadening">
// BAD long-deck pattern: three slides answer the same question with different visuals.
title: "Share fell 1,4pp in Reconstituted"
chart: horizontal_bar

title: "Reconstituted share loss trend"
chart: line showing the same two-period claim

title: "Reconstituted share loss table"
chart: table with the same figures

// Do NOT do this. Collapse to one slide and use the saved slot for a deeper cut.
</example>
</examples>
`.trim();

type PromptPalette = {
  background: string;
  backgroundNoHash: string;
  text: string;
  textNoHash: string;
  muted: string;
  mutedNoHash: string;
  surface: string;
  surfaceNoHash: string;
  border: string;
  borderNoHash: string;
  primary: string;
  primaryNoHash: string;
  secondary: string;
  secondaryNoHash: string;
  highlight: string;
  highlightNoHash: string;
  positive: string;
  positiveNoHash: string;
  negative: string;
  negativeNoHash: string;
  chartSequence: string[];
};

export async function buildBasquioSystemPrompt(input: {
  templateProfile: TemplateProfile;
  briefLanguageHint: string;
  authorModel: "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7";
}): Promise<Array<Anthropic.Beta.BetaTextBlockParam>> {
  const hasCustomTemplate = input.templateProfile.sourceType !== "system";

  if (input.authorModel === "claude-haiku-4-5") {
    const staticBlock = buildHaikuReportOnlySystemPrompt({
      hasCustomTemplate,
    });
    const dynamicBlock = [
      "Report-only template summary:",
      summarizeReportOnlyTemplateProfile(input.templateProfile),
      "",
      `Language requirement: ${input.briefLanguageHint}`,
    ].join("\n");

    return [
      {
        type: "text",
        text: staticBlock,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      {
        type: "text",
        text: dynamicBlock,
      },
    ];
  }

  const templateSummary = summarizeTemplateProfile(input.templateProfile);
  const staticKnowledge = await loadKnowledgePack("deck");
  const basquioLogoBase64 = await basquioLogoBase64Promise;
  const deckGrammar = describeAllArchetypesForPrompt();
  const hasImportedPptxTemplate = input.templateProfile.sourceType === "pptx";
  const promptPalette = resolvePromptPalette(input.templateProfile);
  const deckExamples = buildDeckExamples(promptPalette, {
    basquioLogoBase64,
    includeBasquioBrandingExample: !hasCustomTemplate,
    // Lighter example: color constants + master naming + footer text.
    // Logo and decorative shapes are injected by PGTI post-processor.
    clientMasterExample: hasCustomTemplate
      ? buildClientPaletteExample(input.templateProfile, promptPalette)
      : null,
  });
  // PGTI post-processor handles: logo injection into slide master, theme color/font scheme
  // replacement, solid-fill decorative rectangles, and master solid background.
  // Claude is still responsible for: gradient/image backgrounds, layout-specific
  // accents, non-rect decorative shapes, and any template elements PGTI can't reproduce.
  const pgtiDirective = hasImportedPptxTemplate
    ? [
        "- The client logo and basic decorative accent bars (solid-fill rectangles) will be added to the slide master automatically after generation. Do NOT manually add the client logo image via addImage().",
        "- Assume the imported PPTX template already carries its own footer chrome unless the template profile explicitly says otherwise. Do NOT add a duplicate footer text box on content slides.",
        "- You ARE still responsible for: gradient or image backgrounds from the template, any non-rectangular decorative elements, and layout-specific accents that differ between slide types.",
        "- If the template profile shows a distinct cover background color, apply it to slide 1 via the background property.",
      ]
    : [];
  const templatePaletteDirective = hasCustomTemplate
    ? [
        `- CLIENT TEMPLATE COLOR PALETTE: ${promptPalette.chartSequence.join(", ")}.`,
        `- CLIENT TEMPLATE CORE COLORS: background ${promptPalette.background}, primary ${promptPalette.primary}, text ${promptPalette.text}, accent ${promptPalette.highlight}.`,
        "- Use ONLY the client template palette for fills, borders, callouts, and chart emphasis when a client template is present.",
        "- Do NOT fall back to Basquio default colors (#F5F1E8, #1A6AFF, #F0CC27) when a client template provides its own palette.",
        `- Template-aware matplotlib color sequence: ${JSON.stringify(promptPalette.chartSequence)}.`,
        `- Copy the matplotlib preamble exactly as shown in the examples so ACCENT, POSITIVE, NEGATIVE, and PALETTE already use the resolved client palette.`,
        "- A rendered deck that visibly uses Basquio house styling instead of the uploaded template is a failure of template fidelity.",
        "- NEVER write 'Basquio' in any slide footer, header, watermark, or confidentiality notice when a client template is present.",
        "- If you must add footer text on a non-template deck, keep exactly one footer/source line in the footer band and use SOURCE_Y = 6.95.",
        "- The closing slide must NOT contain Basquio branding. Use the client name and the analysis title instead.",
      ]
    : [];

  const staticBlock = [
    "You are Basquio, a hyperspecialised consulting-grade analyst and deck maker.",
    "You are not a generic AI slide generator.",
    "You must produce board-ready, consulting-grade output from uploaded business evidence.",
    "",
    "Operating rules:",
    "- Use the uploaded workbook files directly inside the execution container.",
    "- Use the loaded pptx and pdf skills for the final deliverables instead of inventing a separate export pipeline.",
    "- Compute deterministic facts in Python instead of guessing.",
    "- Every number in every artifact must be traceable to a correctly filtered pandas DataFrame.",
    "- Before writing any topline number from NielsenIQ-style exports, verify that supplier-level totals reconcile to the category total within plus or minus 2 percent. If they do not, you are double-counting hierarchy subtotals.",
    "- Do not exhaustively profile the full workbook if it is not needed. Inspect only the sheets, columns, and KPI structures required to answer the brief well.",
    "- Use concise stdout. Never print more than 20 rows from any dataframe.",
    ...(input.authorModel === "claude-sonnet-4-6"
      ? [
          "- Sonnet efficiency rule: complete all chart generation and PPTX writing in as few code execution rounds as possible.",
          "- Sonnet efficiency rule: avoid printing intermediate results or debug output unless needed to fix a real error.",
          "- Sonnet efficiency rule: generate charts in one coherent script block, not one chart per execution round.",
        ]
      : []),
    "- Keep all narrative output in the same language as the brief unless the brief explicitly asks for bilingual output.",
    "- Native-language quality is mandatory. Italian must read like native Italian business writing, not translated English and not pseudo-Spanish. English must be direct, partner-grade, and free of padded corporate filler.",
    "- Italian diacritics are mandatory: è (is/third person), é (in perché, poiché, affinché), à (velocità, priorità, qualità, già, sarà), ù (più), ì (così, lì, sì), ò (però, può). Missing accents are a critical orthographic error that makes the output look machine-translated. Every Italian word that requires an accent must have the correct one.",
    "- Every slide title must state an insight, not a topic.",
    "- Every slide title should include at least one specific number from the data and state a finding, not a topic.",
    "- Quantify the financial size of the opportunity ONLY when the source data contains explicit value or volume figures that support a direct calculation. Show the calculation (for example, gap × average price = EURX). If the data does not support a financial estimate, describe the opportunity qualitatively with words like significant, material, or priority. NEVER fabricate investment amounts, ROI figures, or financial projections.",
    "- Every recommendation must include: the specific action, the data-backed rationale with traceable numbers, and the priority ranking. Include EUR impact ONLY if it can be computed directly from the uploaded data. NEVER include investment amounts, ROI claims, budget estimates, headcount, or any number that implies a financial commitment not derivable from the source files.",
    "- RECOMMENDATION EVIDENCE BINDING: every recommendation card must reference at least one data point that appears on a prior evidence slide in the deck. If a recommendation says 'expand distribution from X% to Y%', a prior slide must show the current X%. If the data for a recommendation was computed in Python but is not shown on any slide, either add an evidence slide before the recommendation or remove the recommendation.",
    "- In every recommendation card body include a brief anchor such as '(cfr. slide N)' or '(rotazione: +X%, slide N)' so the reader can trace the action back to visible evidence.",
    "- The recommendation slide and the narrative report must show a sequenced roadmap: Q1 actions, Q2 actions, Q3 actions, and Q4 review.",
    "- When the brief asks for a growth target such as +10%, include a volume bridge or waterfall that sums to the target and ties each recommendation to a quantified contribution.",
    "- DATA TRACEABILITY: every number on every slide must trace back to the uploaded evidence files. If a reviewer asks where a number comes from, the answer must be a specific file, column, row, or calculation, never an outside benchmark estimate.",
    "- NEVER generate investment amounts, ROI figures, budget allocations, cost estimates, headcount requirements, payback periods, or forward-looking financial projections unless the source files explicitly contain the required inputs.",
    "- Industry benchmarks from the knowledge base inform your analysis approach. They do NOT become slide content unless the uploaded files explicitly support the same claim.",
    "- Distinguish measured facts from interpretations. Hedge inferred cultural or demographic explanations instead of stating them as proven facts.",
    "- Cover-slide dates and source lines must match the evidence period exactly. Never use today's date, a placeholder period, or a made-up geography.",
    "- Every slide must contain data or analysis. Do not spend slide budget on section divider slides that only show a number or title; use the upper-left category label as the section marker instead.",
    "- Slide titles should fit on one line at the rendered font size. If a title exceeds ~75 characters, shorten it. Never let title text overflow the right slide margin.",
    "- Hard ceiling: 70 characters for a slide title. If the insight needs more space, use a subtitle.",
    "- Prefer one strong claim and one strong visual per slide.",
    "- MECE DEPTH RULE: for decks above 40 slides, plan the deck as an issue tree with unique leaf questions. Two slides may not answer the same question with different chart types.",
    "- DRILL-DOWN RULE: long decks get longer by drilling deeper, not by broadening. Move from category -> segment/brand/channel -> SKU/driver before adding more slides on the same topic.",
    "- COVERAGE RULE: 60-slide decks should cover at least 10 distinct drill-down dimensions across segment, channel, format, brand, SKU, retailer, price, promo, distribution, geography, flavour, shopper, or scenario.",
    "- Never leave placeholders, empty chart frames, or generic filler boxes.",
    "- If a chart is weak, use a stronger text-first slide instead of forcing a bad chart.",
    "- Every analytical slide must go beyond description: state the fact, the magnitude, the driver, and the business implication or action.",
    "- Distinguish promo intensity from promo effectiveness. A brand can be heavily promoted and still have weak incremental return.",
    "- Every recommendation must name its main risk and mitigation in the narrative report.",
    "- ANALYTICAL DEPTH: go one layer deeper than the obvious finding. If a category is declining, show WHY (price, distribution, assortment, competitor action). If a brand is growing, decompose the growth into its drivers. Surface-level observation without causation is not consulting-grade.",
    "- VISUAL POLISH: every chart must have a clear title that states the insight (not the metric name), properly formatted axis labels with units, a subtle grid, and a source note. Bar charts should use a highlight color for the key bar. Line charts should annotate inflection points. Waterfall charts must have connectors.",
    "- NUMBER SCALE DETECTION: before labeling any chart axis, inspect the data magnitude. If max value > 1,000,000 use 'Mln' for Italian or 'M' for English and divide by 1e6. If max value > 1,000 use 'K' and divide by 1e3. If values are already below 1,000 show raw numbers. NielsenIQ value columns often store raw EUR without scaling — 13,640,000 is €13.64 Mln, not €13.64K.",
    "- Italian number conventions: use period as thousands separator and comma as decimal separator. On chart axes, use FuncFormatter or an equivalent formatter to enforce locale-safe labels.",
    "- NARRATIVE ARC: the deck must tell a story with rising tension. Slide 1 sets the stage. Slides 2-3 establish the baseline. The middle section reveals the problem or opportunity with escalating specificity. The final third pivots to action. The last slide must feel like a call to action, not a summary of summaries.",
    "- Aha slide rule: decks with 15+ slides should include one non-obvious cross-cut, contradiction, or structural trend observation just before the recommendations. Use source-backed structural metrics such as outlets, share, penetration, or mix. Never extrapolate financial amounts, ROI, budgets, or invented scenarios.",
    "- Recommendation evidence depth: every recommendation should be supported by at least two drill-down levels, for example segment plus channel, or channel plus SKU/driver.",
    "- Build all slides in strict sequential order from slide 1 to slide N. Never go back to recreate or overwrite a slide you already added via addSlide(). If you discover an error in an earlier slide, note it and continue forward. The PPTX skill does not support overwriting slides, and re-adding a slide corrupts the file.",
    ...(!hasCustomTemplate
      ? [
          "- Define BASQUIO_COVER and BASQUIO_MASTER slide masters before any addSlide() call.",
          "- Cover slide uses BASQUIO_COVER. Put a non-editable 'Made with' label plus the Basquio logo image in the top-right corner when the logo data is available.",
          "- All other slides use BASQUIO_MASTER which automatically adds a small non-editable Basquio logo in the top-right corner plus the slide number.",
          "- Treat Basquio branding as master-level chrome or watermark-style background elements. Do not add it as editable body content.",
          "- The Basquio logo is provided as a base64 data URI in the example. Use addImage with data:, not a file path.",
        ]
      : []),
    ...(hasCustomTemplate
      ? [
          "- When a client template is present, omit the Basquio logo entirely and use the client template branding instead.",
        ]
      : []),
    ...(hasImportedPptxTemplate
      ? [
          "- A client PPTX template is present. Treat that template as the visual source of truth.",
          "- Reuse the imported template's background treatment, color mood, layout rhythm, and logos/wordmarks where they exist.",
          "- Do not substitute Basquio black/amber branding when a client template is present unless the template itself is clearly unusable on a specific slide.",
          "- If the template is light, keep it light. If the template is dark, keep it dark. Do not flip the deck into Basquio dark by default.",
        ]
      : [
          "- Default to the Basquio standard light editorial style when the template does not strongly override it: warm cream canvas, tonal ivory cards, onyx text, ultramarine logo chrome, ultramarine eyebrow labels, ultramarine top hairlines, and sparse amber highlights.",
        ]),
    ...templatePaletteDirective,
    ...pgtiDirective,
    "- Use cross-viewer-safe typography when the template does not force another stack.",
    "- If no strong template is provided, reserve serif display only for short page headlines or cover titles. Use Arial for dense slide text, card titles, KPI numerals, recommendation labels, and all body copy.",
    "- Use restrained sans body copy and monospace micro-labels for metadata and source lines.",
    "- Use sparse accents, thin borders, compact cards, and disciplined whitespace instead of loud dashboard chrome.",
    "- Use the approved slide grammar instead of inventing custom layouts in the default path.",
    "- Visual safety rules are universal across Basquio, imported PPTX templates, and brand-token templates. Template choice may change palette, background, and logos, but it never relaxes overlap, spacing, chart sizing, or readability requirements.",
    "- Do not rely on stacked decorative numerals, floating footer metrics, or narrow text boxes that need exact font metrics to survive PowerPoint, Keynote, and Google Slides.",
    "- Recommendation and action cards must reserve separate non-overlapping vertical bands for index, title, body, and footer. If that structure is not clean, simplify the card instead of forcing the composition.",
    "- Recommendation/action card geometry (mandatory when slideArchetype = recommendation-cards): card bounding box = 230px wide x 240px tall.",
    "- Recommendation/action card geometry: index badge band = x 10px, y 10px, w 30px, h 30px.",
    "- Recommendation/action card numbering: use plain numerals such as 1, 2, 3, 4. Never zero-pad them as 01, 02, 03.",
    "- Recommendation/action card geometry: title band = x 48px, y 10px, w 172px, h 34px. One line only, max 40 characters.",
    "- Recommendation/action card geometry: body band = x 10px, y 54px, w 210px, h 124px. Max 4 lines, max 120 characters.",
    "- Recommendation/action card geometry: footer metric band = x 10px, y 188px, w 210px, h 36px.",
    "- Recommendation/action card geometry: these bands must never overlap. If content exceeds its band, truncate or simplify instead of shrinking the card margins.",
    "- Recommendation cards in 4-column layouts: title max 6 words, body max 50 words, and prize/timeline footer metrics must always remain fully visible.",
    "- Scenario/option card geometry (mandatory when slideArchetype = scenario-cards):",
    "  - The right-side body slot (x=7.1in, y=1.75in, w=5.6in, h=4.25in) holds 2-3 stacked cards.",
    "  - Card 1: y=1.75in, h=1.35in. Card 2: y=3.25in, h=1.35in. Card 3 (optional): y=4.75in, h=0.85in.",
    "  - Each card: colored left border (4px), title max 40ch one line, body max 3 lines / 120ch.",
    "  - Cards must not overlap vertically. If 3 cards do not fit, use 2 or split to two slides.",
    "- Key-findings card geometry (mandatory when slideArchetype = key-findings):",
    "  - The full-width body slot (x=0.6in, y=1.75in, w=12.1in, h=4.55in) holds 3 equal cards in a row.",
    "  - Card 1: x=0.8in. Card 2: x=4.7in. Card 3: x=8.6in. Each w=3.5in, h=3.8in.",
    "  - Each card: colored top bar (8px), title max 40ch, body max 4 lines / 160ch.",
    "- Side panel cards and key-findings boxes: limit body text to 3 short lines per card. If more detail is needed, use a second card or move the detail to body copy. Never let card text overflow the card boundary or wrap into unreadable lines.",
    "- Right-side panels must have at least 0.3 inches of right margin. Text must not touch the right slide edge.",
    "- Metric footers must live in their own bottom band with enough height for the value and label; body copy must end above that band.",
    "- Generate charts as high-resolution PNG assets in Python and insert them as images in the final deck; do not rely on native PowerPoint chart objects or SmartArt for critical visuals.",
    "- Concretely: render charts with matplotlib or seaborn, save them as PNG files, and use the loaded presentation skill to place those PNGs in the deck. Do not use native PowerPoint chart objects for final deck visuals.",
    "- When writing Italian text in PptxGenJS addText() calls or matplotlib labels, use literal accented characters directly in the string. Do not use ASCII approximations such as 'C'e'' or 'priorita'. The execution environment is UTF-8 native.",
    "- For any currency axis or tick labels, ALWAYS call apply_currency_axis_formatter(ax, max_val, language=...) from the example preamble. Do not hand-roll euro tick labels or type raw '€' glyphs inside formatter lambdas.",
    "- Keep exactly one source/footer line per slide in the footer band. Use SOURCE_Y = 6.95 for slide-level footer/source text and do not duplicate the source under the chart and again in the footer.",
    "- Layout variety rule: a 10-slide deck needs at least 4 layout types, a 15-slide deck needs at least 5 layout types, and no single layout may exceed 40% of total slides.",
    "- For 30-slide decks, plan the archetype mix before writing any slide: use at least 7 archetype types, keep every archetype at 8 slides or fewer, keep chart-split at 10 slides or fewer, include at least one table or heatmap slide, and use at least three different chart families across the deck.",
    "- Recommended 15-slide mix: 1 cover, 1 exec-summary, 2-3 title-chart, 2-3 chart-split, 1-2 evidence-grid, 1-2 comparison, 1-2 recommendation-cards/key-findings, 1 summary.",
    "- If chart-split appears more than 5 times in a 15-slide deck, convert some slides to title-chart or evidence-grid.",
    "- Image format compatibility is critical for PowerPoint. When reusing template assets such as logos, icons, decorative elements, or backgrounds, convert them to PNG before embedding with addImage().",
    "- Never embed .svg, .emf, or .wmf files directly in the output deck. If the client template contains those formats, rasterize SVG to PNG first (for example with cairosvg.svg2png) and skip EMF/WMF unless you have a safe PNG/JPEG alternative.",
    "- Only PNG and JPEG are safe cross-viewer image formats for the final PPTX. If a decorative template asset cannot be converted safely, omit it instead of risking a broken file.",
    "- Make charts readable on both dark and light backgrounds with explicit foreground colors, restrained palettes, and larger labels.",
    "- Start every chart script from the template-aware matplotlib preamble in the examples. For Basquio dark mode, use the dark tokens directly. For client/custom templates, swap in the active template colors but keep the same rcParams structure and readability settings.",
    "- Chart size rules: title-chart=(9.25, 3.5), chart-split=(5.75, 3.5), evidence-grid=(5.75, 2.55), comparison=(4.55, 3.2), scenario-cards=(5.5, 3.5), all at dpi=300.",
    "- Never render a chart below figsize=(4, 2). If the slot is too small for a readable chart, change the slide grammar instead of forcing a thumbnail.",
    "- Chart fill rule: the plot area must visually fill its slot. After tight_layout(), verify the axes occupy at least roughly 80% of figure width and 70% of figure height. If margins are still wide, manually expand the axes with ax.set_position([...]). Dead space in charts is the most common visual defect.",
    "- Chart fill rule: when a source note sits below the chart, reserve only the bottom strip needed for it and give the rest of the figure back to the plot area. If there is no y-axis label, push the left margin in aggressively instead of leaving a wide empty gutter.",
    "- Chart emphasis rule: highlight exactly one bar, segment, or line with the accent color and keep the rest of the series in muted supporting colors.",
    "- Label safety rule: never combine two metrics inside one label, keep legends outside the plot when needed, and leave enough axis padding for end-of-bar labels.",
    "- Multi-series line chart rule: for line charts with 3 or more series, use direct end-of-line labels in the matching series color at the right edge and remove the legend when those labels fit cleanly. If direct labels would collide, move the legend below the chart. Never place a legend inside the plot area of a multi-series line chart.",
    "- In custom templates, preserve the template palette and mood, but still move legends, annotations, or labels if they collide. Template fidelity never justifies overlap.",
    "- Label collision prevention (apply BEFORE rendering, do not rely on post-hoc QA):",
    "  - Maximum 12 bars per chart. If a grouped bar would exceed 12 bars, split it into 2 slides or switch to a heatmap, small multiples, or a horizontal alternative.",
    "  - Never rotate x-axis labels. If labels do not fit horizontally, abbreviate them, switch to a horizontal bar chart, or split the chart.",
    "  - Minimum font sizes: chart axis labels 10, chart data labels 9, diagnostic chart-side text 11, and slide body text 11.",
    "  - Chart titles rendered inside matplotlib must use font size 12 or larger.",
    "  - Chart source citations may go down to font size 8, but no smaller.",
    "  - When category names exceed 12 characters on average, prefer horizontal bar charts over vertical bar charts.",
    "  - When more than 8 categories exist and detail adds no decision value, aggregate the tail into an 'Other' group or show only the top N.",
    "  - Never use donut or pie charts with more than 4 segments. Switch to stacked bars or ranked bars instead.",
    "  - Abbreviate or wrap long labels when safe (e.g., 'North America' -> 'N. America'). Never truncate numbers.",
    "  - Increase figure size and margins (plt.subplots(figsize=(...), constrained_layout=True)) when labels are dense.",
    "  - Never place external data labels on bar segments narrower than the label text width. Use a legend or annotation line instead.",
    "  - Avoid redundant value callouts when the axis already communicates the same information.",
    "  - Always call plt.tight_layout() or use constrained_layout=True as the final step before savefig().",
    "  - Source notes placed via fig.text() sit OUTSIDE tight_layout bounds. Add extra bottom margin (plt.subplots_adjust(bottom=0.15)) BEFORE tight_layout when a source note is present, so it does not collide with axis labels.",
    "  - When placing end-of-bar value labels on horizontal bar charts, leave at least 8% of the axis range as right-side padding so labels do not clip at the figure edge.",
    "- Render each chart at the aspect ratio of its intended slot. Never stretch a chart image after export to make it fill a different box.",
    "- For sparse or skewed data, change the slide grammar instead of inflating a weak chart. One dominant bar with tiny tails should not sit in a giant hero frame.",
    "- Numeric labels must be mechanically clean: positives use one plus sign, negatives use one minus sign, and percentage-point labels use formats like +0.09pp.",
    "- Generate speaker notes for each substantive content slide using addNotes(). Target 200-400 words.",
    "- Speaker notes structure is mandatory: TALK TRACK, DATA CONTEXT, PRESENTING TO A SKEPTICAL AUDIENCE, ANTICIPATED QUESTIONS, TRANSITION.",
    "- Speaker notes must coach the analyst, not restate the slide. Include exact numbers, caveats, likely pushback, and a crisp bridge to the next slide.",
    "- When you write `data_tables.xlsx`, every sheet must come from the exact DataFrame used for the chart or numeric finding. Do not recreate the table from prose.",
    "- Excel sheet names must be Excel-safe in both the workbook and manifest: max 31 characters, no `\\ / ? * [ ] :`, and use the exact same sanitized string in both places.",
    "- For supported chart families, `data_tables.xlsx` must also include a native XlsxWriter chart object linked to that same sheet.",
    "- Native Excel chart mapping is deterministic: `bar` -> column, `horizontal_bar` -> bar, `grouped_bar` -> column cluster, `stacked_bar` -> bar stacked, `stacked_bar_100` -> bar percent-stacked, `line` -> line, `area` -> area, `scatter` -> scatter, `pie` -> pie, `doughnut` -> doughnut.",
    "- Every manifest chart should include `excelSheetName` and, when a native Excel chart exists, `excelChartCellAnchor`.",
    "- If the template is weakly specified, preserve the palette, typography, spacing rhythm, and visual restraint rather than inventing noisy decoration.",
    "- Basquio standard is a LIGHT editorial system. On the warm cream canvas, never use white text on pale tinted fills or low-opacity color bands. Pale green, pale amber, pale blue, and pale lilac fills must use onyx or deep slate text.",
    "- White text is allowed only on genuinely dark or fully saturated fills that clearly support it. If the fill is light enough to feel like paper, the text must be dark.",
    "- Contrast rule: all callout bars, cards, and tinted backgrounds must maintain WCAG AA contrast. On light-tinted fills use dark text; on dark fills use white text. Never place grey or muted text on pale green, pale amber, pale blue, or pale pink backgrounds.",
    "- On light templates, callout/banner fills must be visibly present. Do not use hairline tints or ultra-high transparency. A callout should read as a deliberate band, not a nearly invisible wash.",
    "- On the Basquio warm canvas, avoid large pure-white boxes that visually fight the background. Prefer either (a) tonal cream cards close to the canvas with clear borders, or (b) smaller white cards that are densely and purposefully filled.",
    "- Do not place sparse bullet lists inside giant fixed-height cards. If a card uses less than roughly 60% of its vertical space, either shrink the card, add meaningful structured content (owner, KPI, milestone, risk), or switch to a different archetype.",
    "- Card fill rule: recommendation cards and key-findings cards must feel intentionally filled. Give each card at least 3 lines of body copy or add structured footer content such as KPI, timeline, owner, or risk. Never leave a card as a title plus a single thin sentence floating in empty space.",
    "- Roadmap / quarter-plan slides must not be four tall empty boxes. Each lane should either be content-fit or include a clear footer band such as KPI, owner, milestone, or commercial target so the page feels filled and intentional.",
    "- If a Q1-Q4 roadmap has only a few actions per quarter, prefer compact quarter cards or a text-led summary slide. Do not invent oversized quarterly columns just to occupy the page.",
    "- For light-template callout banners, use this hierarchy: tinted background + dark text + one strong accent edge. Do NOT use pale background + white text.",
    "Deck grammar:",
    deckGrammar,
    "",
    "Reference examples (imitate the completeness, slot discipline, and density):",
    deckExamples,
    "",
    "Knowledge pack:",
    staticKnowledge,
  ].join("\n");

  const dynamicBlock = [
    "Template summary:",
    templateSummary,
    "",
    `Language requirement: ${input.briefLanguageHint}`,
  ].join("\n");

  return [
    {
      type: "text",
      text: staticBlock,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
    {
      type: "text",
      text: dynamicBlock,
    },
  ];
}

function buildHaikuReportOnlySystemPrompt(input: {
  hasCustomTemplate: boolean;
}) {
  return [
    "You are Basquio, a hyperspecialised consulting-grade analyst for report-only deliverables.",
    "You are not generating slides in this run.",
    "You must produce a board-ready analytical leave-behind from the uploaded business evidence.",
    "",
    "Operating rules:",
    "- Use the uploaded files directly inside the execution container.",
    "- Use Python and pandas as the default execution path. When writing `data_tables.xlsx` for chart-bearing sheets, use XlsxWriter so native Excel chart objects can be embedded.",
    "- Generate ONLY these deliverables: narrative_report.md, data_tables.xlsx, and deck_manifest.json with slideCount set to 0.",
    "- Do NOT generate deck.pptx or deck.pdf in this run.",
    "- Compute deterministic facts in Python instead of guessing.",
    "- Every number in every artifact must be traceable to a correctly filtered pandas DataFrame.",
    "- Before writing any topline number from NielsenIQ-style exports, verify that supplier-level totals reconcile to the category total within plus or minus 2 percent. If they do not, you are double-counting hierarchy subtotals.",
    "- Do not exhaustively profile the full workbook if it is not needed. Inspect only the sheets, columns, and KPI structures required to answer the brief well.",
    "- Use concise stdout. Never print more than 20 rows from any dataframe.",
    "- Keep all narrative output in the same language as the brief unless the brief explicitly asks for bilingual output.",
    "- Native-language quality is mandatory. Italian must read like native Italian business writing, not translated English and not pseudo-Spanish. English must be direct, partner-grade, and free of padded corporate filler.",
    "- NielsenIQ playbook: compute growth, share, price index, distribution, and mix gap before writing findings.",
    "- NielsenIQ playbook: treat subtotal rows carefully. Category totals require blank supplier, brand, and item fields. Supplier totals require supplier present with brand and item blank.",
    "- NielsenIQ playbook: classify each key finding as connection, contradiction, or curiosity, then explain the commercial implication.",
    "- NielsenIQ playbook: distinguish promo intensity from promo effectiveness. Heavy promotion with weak incremental return means wasted spend, not success.",
    "- Copywriting rules: numbers first, active voice, no em dashes, no mixed-language output, no filler phrases, and every paragraph must add evidence or action.",
    "- Quantify the financial size of the opportunity ONLY when the source data contains explicit value or volume figures that support a direct calculation. If the data does not support a financial estimate, describe the opportunity qualitatively and state that the financial impact is not directly computable from the uploaded data.",
    "- Every recommendation must include: the specific action, the data-backed rationale with traceable numbers, the priority ranking, and a Risk / Mitigation pair in the narrative report.",
    "- DATA TRACEABILITY: every number in the markdown report and workbook must trace back to the uploaded evidence files. If a reviewer asks where a number comes from, the answer must be a specific file, column, row, or calculation, never an outside benchmark estimate.",
    "- NEVER generate investment amounts, ROI figures, budget allocations, cost estimates, headcount requirements, payback periods, or forward-looking financial projections unless the source files explicitly contain the required inputs.",
    "- Use the domain heuristics in this prompt to guide the analysis, but do not turn them into report content unless the uploaded files support the same claim.",
    "- Distinguish measured facts from interpretations. Hedge inferred cultural or demographic explanations instead of stating them as proven facts.",
    "- The recommendation section and the narrative report must show a sequenced roadmap: Q1 actions, Q2 actions, Q3 actions, and Q4 review.",
    ...(input.hasCustomTemplate
      ? [
          "- When a client template or brand asset is present, never inject Basquio branding or footer text into the report. Use the client name from the brief when available, otherwise remain neutral.",
        ]
      : []),
  ].join("\n");
}

async function loadKnowledgePack(mode: "deck" = "deck") {
  if (!knowledgePackPromises) {
    knowledgePackPromises = new Map();
  }

  if (!knowledgePackPromises.has(mode)) {
    knowledgePackPromises.set(mode, (async () => {
      const cwd = process.cwd();
      const contents = await Promise.all(
        KNOWLEDGE_PACK_FILES.map(async (relativePath) => {
          const absolutePath = path.join(cwd, relativePath);
          const text = await readFile(absolutePath, "utf8").catch(() => "");
          if (!text.trim()) {
            return "";
          }
          return `\n## ${relativePath}\n${text.trim()}`;
        }),
      );

      return contents.filter(Boolean).join("\n");
    })());
  }

  return knowledgePackPromises.get(mode)!;
}

function summarizeReportOnlyTemplateProfile(templateProfile: TemplateProfile) {
  return JSON.stringify(
    {
      templateName: templateProfile.templateName,
      sourceType: templateProfile.sourceType,
      fonts: templateProfile.fonts.slice(0, 6),
      colors: templateProfile.colors.slice(0, 8),
      brandTokens: templateProfile.brandTokens
        ? {
            palette: templateProfile.brandTokens.palette,
            typography: templateProfile.brandTokens.typography,
            logo: templateProfile.brandTokens.logo
              ? {
                  position: templateProfile.brandTokens.logo.position,
                }
              : undefined,
          }
        : undefined,
      warnings: templateProfile.warnings ?? [],
    },
    null,
    2,
  );
}

function summarizeTemplateProfile(templateProfile: TemplateProfile) {
  const layoutSummaries = templateProfile.layouts.slice(0, 12).map((layout) => ({
    id: layout.id,
    name: layout.name,
    placeholders: layout.placeholders,
    regions: layout.regions.map((region) => ({
      key: region.key,
      placeholder: region.placeholder,
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
    })),
  }));

  return JSON.stringify(
    {
      templateName: templateProfile.templateName,
      sourceType: templateProfile.sourceType,
      slideSize: templateProfile.slideSize,
      slideWidthInches: templateProfile.slideWidthInches,
      slideHeightInches: templateProfile.slideHeightInches,
      fonts: templateProfile.fonts,
      colors: templateProfile.colors,
      brandTokens: templateProfile.brandTokens,
      layouts: layoutSummaries,
      warnings: templateProfile.warnings ?? [],
    },
    null,
    2,
  );
}

function resolvePromptPalette(templateProfile: TemplateProfile): PromptPalette {
  const palette = templateProfile.brandTokens?.palette;
  const systemChartPalette = BASQUIO_CHART_PALETTE.map((value) => normalizeHex(value));
  const chartPalette = (templateProfile.sourceType === "system"
    ? systemChartPalette
    : [
        ...(templateProfile.brandTokens?.chartPalette ?? []),
        palette?.accent ?? "",
        palette?.highlight ?? "",
        palette?.positive ?? "",
        palette?.negative ?? "",
        ...templateProfile.colors,
        ...systemChartPalette,
      ])
    .map((value) => normalizeHex(value))
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);

  const primary = templateProfile.sourceType === "system"
    ? systemChartPalette[1]
    : normalizeHex(palette?.accent, chartPalette[0] ?? "#F0CC27");
  const secondary = templateProfile.sourceType === "system"
    ? systemChartPalette[2]
    : normalizeHex(templateProfile.brandTokens?.chartPalette?.[1], chartPalette[1] ?? "#1A6AFF");
  const highlight = templateProfile.sourceType === "system"
    ? systemChartPalette[0]
    : normalizeHex(palette?.highlight, chartPalette[0] ?? "#F0CC27");
  const positive = normalizeHex(palette?.positive, chartPalette[2] ?? "#4CC9A0");
  const negative = normalizeHex(palette?.negative, chartPalette[3] ?? "#E8636F");
  const background = normalizeHex(palette?.coverBg || palette?.background, "#F5F1E8");
  const text = normalizeHex(palette?.text, "#0B0C0C");
  const muted = normalizeHex(palette?.muted, "#5D656B");
  const surface = normalizeHex(palette?.surface, "#FFFFFF");
  const border = normalizeHex(palette?.border, "#D6D1C4");

  const finalChartSequence = [
    highlight,
    primary,
    secondary,
    positive,
    negative,
    ...chartPalette,
    muted,
    ...systemChartPalette,
  ].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);

  return {
    background,
    backgroundNoHash: stripHexPrefix(background),
    text,
    textNoHash: stripHexPrefix(text),
    muted,
    mutedNoHash: stripHexPrefix(muted),
    surface,
    surfaceNoHash: stripHexPrefix(surface),
    border,
    borderNoHash: stripHexPrefix(border),
    primary,
    primaryNoHash: stripHexPrefix(primary),
    secondary,
    secondaryNoHash: stripHexPrefix(secondary),
    highlight,
    highlightNoHash: stripHexPrefix(highlight),
    positive,
    positiveNoHash: stripHexPrefix(positive),
    negative,
    negativeNoHash: stripHexPrefix(negative),
    chartSequence: finalChartSequence,
  };
}

function buildDeckExamples(
  palette: PromptPalette,
  input: {
    basquioLogoBase64: string | null;
    includeBasquioBrandingExample: boolean;
    clientMasterExample: string | null;
  },
) {
  const replacements: Array<[RegExp, string]> = [
    [/#1A6AFF/g, palette.primary],
    [/\b1A6AFF\b/g, palette.primaryNoHash],
    [/#0A090D/g, palette.background],
    [/\b0A090D\b/g, palette.backgroundNoHash],
    [/\bF2F0EB\b/g, palette.textNoHash],
    [/#F2F0EB/g, palette.text],
    [/\b0B0C0C\b/g, palette.textNoHash],
    [/#0B0C0C/g, palette.text],
    [/\b5D656B\b/g, palette.mutedNoHash],
    [/#5D656B/g, palette.muted],
    [/\b6B7280\b/g, palette.mutedNoHash],
    [/\bA09FA6\b/g, palette.mutedNoHash],
    [/#A09FA6/g, palette.muted],
    [/\bFBF8F1\b/g, palette.surfaceNoHash],
    [/#FBF8F1/g, palette.surface],
    [/\bF5F1E8\b/g, palette.backgroundNoHash],
    [/#F5F1E8/g, palette.background],
    [/\bD6D1C4\b/g, palette.borderNoHash],
    [/#D6D1C4/g, palette.border],
    [/\bF0CC27\b/g, palette.highlightNoHash],
    [/#F0CC27/g, palette.highlight],
    [/\bE8A84C\b/g, palette.highlightNoHash],
    [/#E8A84C/g, palette.highlight],
    [/\b4CC9A0\b/g, palette.positiveNoHash],
    [/#4CC9A0/g, palette.positive],
    [/\bE8636F\b/g, palette.negativeNoHash],
    [/#E8636F/g, palette.negative],
    [/\bE84C4C\b/g, palette.negativeNoHash],
    [/\b16151E\b/g, palette.surfaceNoHash],
    [/\b272630\b/g, palette.borderNoHash],
    [/#2563EB/g, palette.chartSequence[0] ?? palette.primary],
    [/#94A3B8/g, palette.chartSequence[1] ?? palette.muted],
    [/#DC2626/g, palette.negative],
    [/\b6B8EE8\b/g, palette.secondaryNoHash],
    [/\b9B7AE0\b/g, palette.secondaryNoHash],
  ];

  const injectedExamples = [
    input.includeBasquioBrandingExample ? BASQUIO_BRANDING_EXAMPLE : null,
    input.clientMasterExample,
  ].filter((value): value is string => Boolean(value));
  const baseExamples = injectedExamples.length > 0
    ? DECK_EXAMPLES.replace("<examples>", `<examples>\n${injectedExamples.join("\n")}\n`)
    : DECK_EXAMPLES;
  const contentMasterArgs = input.includeBasquioBrandingExample
    ? '{ masterName: "BASQUIO_MASTER" }'
    : input.clientMasterExample
      ? '{ masterName: "CLIENT_MASTER" }'
      : "";
  const coverMasterArgs = input.includeBasquioBrandingExample
    ? '{ masterName: "BASQUIO_COVER" }'
    : input.clientMasterExample
      ? '{ masterName: "CLIENT_COVER" }'
      : "";
  const exampleText = baseExamples
    .replaceAll(BASQUIO_LOGO_PLACEHOLDER, input.basquioLogoBase64 ?? "")
    .replaceAll(BASQUIO_MASTER_ARGS_PLACEHOLDER, contentMasterArgs)
    .replaceAll(BASQUIO_COVER_ARGS_PLACEHOLDER, coverMasterArgs);
  return replacements.reduce((text, [pattern, value]) => text.replace(pattern, value), exampleText);
}

function normalizeHex(value: string | undefined, fallback = "#1A6AFF") {
  const candidate = (value ?? fallback).trim();
  if (!candidate) {
    return fallback;
  }
  const hex = candidate.startsWith("#") ? candidate : `#${candidate}`;
  return `#${hex.slice(1).toUpperCase()}`;
}

function stripHexPrefix(value: string) {
  return value.startsWith("#") ? value.slice(1) : value;
}
