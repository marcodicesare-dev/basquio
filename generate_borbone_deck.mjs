/**
 * Caffè Borbone — Canada Opportunity Deck Generator (v3)
 * Consulting-grade PPTX with NielsenIQ design system
 *
 * v3: Added derived price/unit analysis slides + enhancements
 * - NEW Slide 5: Global Price/Unit by continent
 * - NEW Slide 7: Canada Growth Decomposition (value vs volume vs price)
 * - NEW Slide 9: SSR Price/Unit worldwide
 * - ENHANCED Slide 6: USA vs Canada price/unit
 * - ENHANCED Slide 7 (old 6): Canada segments with price/unit
 * - ENHANCED Slide 14 (old 11): L'Opportunità Canada with price insights
 * Total slides: 17 (was 14)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
const XLSX = require('xlsx');
import { readFileSync, writeFileSync } from 'fs';

// ─── Constants ──────────────────────────────────────────────────────────
const INPUT = '/Users/marcodicesare/conductor/workspaces/basquio/la-paz/.context/attachments/CAFFè SP-v1.xlsx';
const OUTPUT = '/Users/marcodicesare/conductor/workspaces/basquio/la-paz/.context/attachments/Caffe-Borbone-Canada-Opportunity.pptx';
const OUTPUT2 = '/Users/marcodicesare/Desktop/Caffe-Borbone-Canada-Opportunity.pptx';

const C = {
  navy:      '060A45',
  blue:      '2C6DF6',
  purple:    'A082F3',
  amber:     'FFB500',
  rose:      'CB4B7A',
  teal:      '03A577',
  medBlue:   '4697E2',
  white:     'FFFFFF',
  gray:      '555555',
  lavLight:  'E9EAFD',
  lavMed:    'C5C8FB',
};
const CHART_COLORS = [C.purple, C.amber, C.rose, C.teal, C.medBlue, C.blue, C.lavMed];
const SOURCE_TEXT = 'Fonte: NielsenIQ Strategic Planner | Dati 2023\u20132025';

// ─── Layout constants (v2 fixes) ────────────────────────────────────────
const LM = 0.6;                    // left margin — ALWAYS 0.6
const RM = 0.5;                    // right margin from 13.333
const CW = 13.333 - LM - RM;      // usable content width ≈ 12.233
const TITLE_Y = 0.22;
const SUBTITLE_Y = 0.88;
const CONTENT_Y = 1.4;             // content starts here (not 1.85)
const FOOTER_Y = 7.05;             // footer bar top
const CONTENT_END = 6.9;           // content must stop above footer
const CONTENT_H = CONTENT_END - CONTENT_Y; // ≈ 5.5

// ─── Helpers ────────────────────────────────────────────────────────────
function fmt(v, forceUnit) {
  if (v == null || isNaN(v)) return '\u2014';
  const abs = Math.abs(v);
  if (forceUnit === 'pct') return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  if (abs >= 1e9) return '\u20AC' + (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return '\u20AC' + (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '\u20AC' + (v / 1e3).toFixed(1) + 'K';
  return '\u20AC' + v.toFixed(0);
}

function pct(cur, prev) {
  if (!prev || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function fmtPct(cur, prev) {
  const p = pct(cur, prev);
  if (p == null) return '\u2014';
  return (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
}

/** Format price/unit as €X.XX */
function fmtPrice(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return '\u2014';
  return '\u20AC' + v.toFixed(2);
}

// Continent mapping
const CONTINENT_MAP = {
  'Africa': 'Africa',
  'Asiapac': 'Asia-Pacifico',
  'Europe': 'Europa',
  'Latam': 'America Latina',
  'North America': 'Nord America',
};

// ─── Data Loading ───────────────────────────────────────────────────────
const wb = XLSX.readFile(INPUT);
function loadSheet(name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name]).slice(1).map(r => ({
    continent: r.__EMPTY,
    nation: r.__EMPTY_1,
    product: r.__EMPTY_2,
    val23: r.Value || 0,
    val24: r.Value_1 || 0,
    val25: r.Value_2 || 0,
    units23: r.Units || 0,
    units24: r.Units_1 || 0,
    units25: r.Units_2 || 0,
  }));
}

const fmcg = loadSheet('TOTAL FMCG');
const coffee = loadSheet('TOTAL COFFEE');
const borbone = loadSheet("TOTAL CAFFE' BORBONE");

// ─── Computations ───────────────────────────────────────────────────────

// 1. Coffee by continent (with units for price/unit)
function aggByContinent(data) {
  const m = {};
  for (const r of data) {
    const c = r.continent;
    if (!m[c]) m[c] = { val23: 0, val24: 0, val25: 0, units23: 0, units24: 0, units25: 0 };
    m[c].val23 += r.val23;
    m[c].val24 += r.val24;
    m[c].val25 += r.val25;
    m[c].units23 += r.units23;
    m[c].units24 += r.units24;
    m[c].units25 += r.units25;
  }
  return m;
}
const coffeeByContinent = aggByContinent(coffee);

// 2. Coffee by country (with units for price/unit)
function aggByCountry(data) {
  const m = {};
  for (const r of data) {
    const c = r.nation;
    if (!m[c]) m[c] = { val23: 0, val24: 0, val25: 0, units23: 0, units24: 0, units25: 0, continent: r.continent };
    m[c].val23 += r.val23;
    m[c].val24 += r.val24;
    m[c].val25 += r.val25;
    m[c].units23 += r.units23;
    m[c].units24 += r.units24;
    m[c].units25 += r.units25;
  }
  return m;
}
const coffeeByCountry = aggByCountry(coffee);

// 3. FMCG by country
const fmcgByCountry = {};
for (const r of fmcg) {
  fmcgByCountry[r.nation] = { val23: r.val23, val24: r.val24, val25: r.val25, continent: r.continent };
}

// 4. Borbone by country (sum multiple rows)
const borboneByCountry = aggByCountry(borbone);

// 5. Global totals
function sum(obj, field) { return Object.values(obj).reduce((s, v) => s + (v[field] || 0), 0); }
const globalCoffee25 = sum(coffeeByCountry, 'val25');
const globalCoffee24 = sum(coffeeByCountry, 'val24');
const globalCoffee23 = sum(coffeeByCountry, 'val23');

const borboneGlobal25 = sum(borboneByCountry, 'val25');
const borboneGlobal24 = sum(borboneByCountry, 'val24');
const borboneGlobal23 = sum(borboneByCountry, 'val23');

// 6. Canada specifics
const canadaCoffee = coffee.filter(r => r.nation === 'Canada');
const canadaTotal25 = canadaCoffee.reduce((s, r) => s + r.val25, 0);
const canadaTotal24 = canadaCoffee.reduce((s, r) => s + r.val24, 0);
const canadaFMCG25 = fmcgByCountry['Canada']?.val25 || 0;

// USA specifics
const usaCoffee = coffee.filter(r => r.nation === 'United States');
const usaTotal25 = usaCoffee.reduce((s, r) => s + r.val25, 0);
const usaTotal24 = usaCoffee.reduce((s, r) => s + r.val24, 0);
const usaFMCG25 = fmcgByCountry['United States']?.val25 || 0;

// 7. Borborne growth
const borboneYoY = pct(borboneGlobal25, borboneGlobal24);

// 8. Segment analysis for Canada (with units for price/unit)
const canadaSegments = {};
for (const r of canadaCoffee) {
  canadaSegments[r.product] = { val23: r.val23, val24: r.val24, val25: r.val25, units23: r.units23, units24: r.units24, units25: r.units25 };
}

// 9. Single Serve Roast by country (top markets, with units)
const ssrByCountry = {};
for (const r of coffee) {
  if (r.product === 'COFFEE SINGLE SERVE ROAST') {
    ssrByCountry[r.nation] = { val23: r.val23, val24: r.val24, val25: r.val25, units23: r.units23, units24: r.units24, units25: r.units25, continent: r.continent };
  }
}

// 10. Borbone market entries
const newMarkets2025 = [];
for (const [country, d] of Object.entries(borboneByCountry)) {
  if (d.val25 > 0 && (!d.val23 || d.val23 === 0) && (!d.val24 || d.val24 === 0)) {
    newMarkets2025.push(country);
  }
}

// Count countries with presence per year
const borboneCountries23 = Object.entries(borboneByCountry).filter(([,d]) => d.val23 > 0).length;
const borboneCountries24 = Object.entries(borboneByCountry).filter(([,d]) => d.val24 > 0).length;
const borboneCountries25 = Object.entries(borboneByCountry).filter(([,d]) => d.val25 > 0).length;

// Italy Borbone data
const borboneItaly25 = borboneByCountry['Italy']?.val25 || 0;
const coffeeItaly25 = coffeeByCountry['Italy']?.val25 || 0;
const borboneItalyShare = (borboneItaly25 / coffeeItaly25) * 100;

// USA/Canada units for price/unit
const usaUnits25 = usaCoffee.reduce((s, r) => s + r.units25, 0);
const canadaUnits25 = canadaCoffee.reduce((s, r) => s + r.units25, 0);
const usaPricePerUnit = usaUnits25 > 0 ? usaTotal25 / usaUnits25 : 0;
const canadaPricePerUnit = canadaUnits25 > 0 ? canadaTotal25 / canadaUnits25 : 0;

// Spain growth story
const borboneSpain = borboneByCountry['Spain'];
const spainGrowth = pct(borboneSpain?.val25, borboneSpain?.val24);

// ─── Presentation ───────────────────────────────────────────────────────
const PptxGen = PptxGenJS.default || PptxGenJS;
const pptx = new PptxGen();
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'WIDE';

let slideNum = 0;

// ─── Shared chrome helpers (v2) ─────────────────────────────────────────

/** Purple accent bar at top of every content slide */
function addAccentBar(slide) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 0.06,
    fill: { color: C.purple },
  });
}

/** Navy footer bar + source text + page number — every content slide */
function addFooterChrome(slide, extra) {
  // Navy footer bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: FOOTER_Y, w: 13.333, h: 0.45,
    fill: { color: C.navy },
  });
  // Source text inside footer
  slide.addText(extra ? `${SOURCE_TEXT} | ${extra}` : SOURCE_TEXT, {
    x: 0.6, y: 7.1, w: 10, h: 0.3,
    fontSize: 8, fontFace: 'Arial', color: 'AAAAAA', italic: true,
  });
  // Page number
  slideNum++;
  if (slideNum > 1) {
    slide.addText(String(slideNum), {
      x: 12.0, y: 7.1, w: 0.8, h: 0.3,
      fontSize: 8, fontFace: 'Arial', color: '9CA3AF', align: 'right',
    });
  }
}

/** Title + thin purple divider + subtitle */
function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: LM, y: TITLE_Y, w: CW, h: 0.62,
    fontSize: 36, fontFace: 'Georgia', bold: true, color: C.navy,
    fit: 'shrink',
  });
  // Thin purple divider under title
  slide.addShape(pptx.ShapeType.rect, {
    x: LM, y: 0.85, w: 2.5, h: 0.025,
    fill: { color: C.purple },
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: LM, y: SUBTITLE_Y, w: CW, h: 0.35,
      fontSize: 14, fontFace: 'Arial', color: C.gray,
    });
  }
}

/** Common chart options for polish (v2 fix #9) */
const CHART_POLISH = {
  barGapWidthPct: 80,
  catAxisLineShow: false,
};

// ────────────────────────────────────────────────────────────────────────
// SLIDE 1: COVER (v2 fix #10 — better gradient + centered title)
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  slideNum++;
  slide.background = { fill: C.navy };

  // Top purple accent
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 0.08,
    fill: { color: C.purple },
  });

  // Large semi-transparent purple shape on the right (cobranded pattern)
  slide.addShape(pptx.ShapeType.rect, {
    x: 8.5, y: 0, w: 4.833, h: 7.5,
    fill: { color: C.purple },
    transparency: 85,
  });
  // Second overlay for depth
  slide.addShape(pptx.ShapeType.rect, {
    x: 10.0, y: 0, w: 3.333, h: 7.5,
    fill: { color: C.purple },
    transparency: 75,
  });

  // Amber accent
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.7, y: 2.8, w: 0.8, h: 0.06,
    fill: { color: C.amber },
  });

  // Title block — vertically centered better
  slide.addText('Caff\u00E8 Borbone', {
    x: 0.7, y: 3.0, w: 7.5, h: 0.9,
    fontSize: 48, fontFace: 'Georgia', bold: true, color: C.white,
  });
  slide.addText('Opportunit\u00E0 di Espansione in Canada', {
    x: 0.7, y: 3.8, w: 7.5, h: 0.7,
    fontSize: 32, fontFace: 'Georgia', color: C.purple,
  });
  slide.addText('Analisi del Mercato Globale del Caff\u00E8 e\nDimensionamento dell\'Opportunit\u00E0 Canadese', {
    x: 0.7, y: 4.6, w: 7.5, h: 0.8,
    fontSize: 16, fontFace: 'Arial', color: C.lavLight,
    lineSpacing: 24,
  });
  slide.addText('NielsenIQ Strategic Planner  |  Dati 2023\u20132025', {
    x: 0.7, y: 6.3, w: 8, h: 0.4,
    fontSize: 12, fontFace: 'Arial', color: C.gray,
  });
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 2: EXECUTIVE SUMMARY
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Executive Summary', 'I numeri chiave e le evidenze principali');

  // KPI Cards — start at CONTENT_Y
  const kpis = [
    { label: 'Mercato Globale Caff\u00E8\n2025', value: fmt(globalCoffee25), color: C.purple },
    { label: 'Mercato Caff\u00E8 Canada\n2025', value: fmt(canadaTotal25), color: C.teal },
    { label: 'Fatturato Globale\nBorbone 2025', value: fmt(borboneGlobal25), color: C.amber },
    { label: 'Crescita YoY\nBorbone', value: fmtPct(borboneGlobal25, borboneGlobal24), color: C.rose },
  ];

  const cardCount = kpis.length;
  const gap = 0.3;
  const totalGaps = gap * (cardCount - 1);
  const cardW = (CW - totalGaps) / cardCount;
  kpis.forEach((kpi, i) => {
    const x = LM + i * (cardW + gap);
    // Card background — roundRect (v2 fix #9)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: CONTENT_Y, w: cardW, h: 1.5,
      fill: { color: C.lavLight },
      rectRadius: 0.1,
    });
    // Accent top strip
    slide.addShape(pptx.ShapeType.rect, {
      x, y: CONTENT_Y, w: cardW, h: 0.05,
      fill: { color: kpi.color },
    });
    // Value
    slide.addText(kpi.value, {
      x, y: CONTENT_Y + 0.15, w: cardW, h: 0.6,
      fontSize: 28, fontFace: 'Georgia', bold: true, color: C.navy, align: 'center', valign: 'middle',
    });
    // Label
    slide.addText(kpi.label, {
      x, y: CONTENT_Y + 0.8, w: cardW, h: 0.55,
      fontSize: 10, fontFace: 'Arial', color: C.gray, align: 'center',
      lineSpacing: 14,
    });
  });

  // Bullet findings
  const coffeeShareCanada = ((canadaTotal25 / canadaFMCG25) * 100).toFixed(1);
  const canadaGrowth = fmtPct(canadaTotal25, canadaTotal24);
  const ssrCanada = canadaSegments['COFFEE SINGLE SERVE ROAST'];
  const ssrGrowth = fmtPct(ssrCanada?.val25, ssrCanada?.val24);

  const bullets = [
    `Il mercato del caffè in Canada vale ${fmt(canadaTotal25)} nel 2025 (${coffeeShareCanada}% del FMCG), in crescita del ${canadaGrowth} YoY`,
    `Il segmento Single Serve Roast (capsule/cialde) cresce del ${ssrGrowth} in Canada — il core business di Borbone`,
    `Borbone ha raggiunto ${borboneCountries25} mercati nel 2025 (da ${borboneCountries23} nel 2023), con un fatturato globale in crescita del ${fmtPct(borboneGlobal25, borboneGlobal24)}`,
    `La Spagna dimostra la scalabilità internazionale: fatturato Borbone ${fmtPct(borboneSpain?.val25, borboneSpain?.val24)} YoY — un modello replicabile in Canada`,
  ];

  const bulletY0 = CONTENT_Y + 1.7;
  bullets.forEach((b, i) => {
    slide.addText(b, {
      x: LM + 0.1, y: bulletY0 + i * 0.62, w: CW - 0.2, h: 0.55,
      fontSize: 12, fontFace: 'Arial', color: C.gray,
      bullet: { indent: 12 },
      lineSpacing: 16,
      paraSpaceBefore: 2, paraSpaceAfter: 4,
    });
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 3: GLOBAL COFFEE MARKET BY CONTINENT
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Il Mercato Globale del Caff\u00E8', 'Dimensionamento per continente \u2014 Valore 2025 (\u20AC)');

  const continents = ['Europe', 'North America', 'Asiapac', 'Latam', 'Africa'];
  const labels = ['Europa', 'Nord America', 'Asia-Pacifico', 'America Latina', 'Africa'];
  const vals25 = continents.map(c => (coffeeByContinent[c]?.val25 || 0) / 1e9);

  slide.addChart(pptx.charts.BAR, [
    { name: 'Valore 2025 (\u20ACB)', labels, values: vals25 },
  ], {
    x: LM, y: CONTENT_Y, w: 7.5, h: CONTENT_H,
    barDir: 'bar',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '#,##0.0"B"',
    dataLabelFontSize: 10,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisOrientation: 'minMax',
    catAxisLabelFontSize: 11,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Callout box
  const europeVal = coffeeByContinent['Europe']?.val25 || 0;
  const naVal = coffeeByContinent['North America']?.val25 || 0;
  const europeShare = ((europeVal / globalCoffee25) * 100).toFixed(0);
  const naShare = ((naVal / globalCoffee25) * 100).toFixed(0);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.6, y: CONTENT_Y + 0.3, w: 4.2, h: 2.8,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Insight', {
    x: 8.8, y: CONTENT_Y + 0.4, w: 3.8, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });
  slide.addText(
    `L'Europa domina con il ${europeShare}% del mercato globale del caff\u00E8 (${fmt(europeVal)}).\n\nIl Nord America \u00E8 il secondo mercato: ${naShare}% del totale (${fmt(naVal)}), con una dinamica di crescita importante.`,
    {
      x: 8.8, y: CONTENT_Y + 0.8, w: 3.8, h: 2.1,
      fontSize: 11, fontFace: 'Arial', color: C.gray,
      lineSpacing: 16,
    }
  );

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 4: GROWTH TRENDS BY CONTINENT
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Trend di Crescita del Caff\u00E8', 'Evoluzione del valore per continente 2023\u20132025 (\u20ACB)');

  const continents = ['Europe', 'North America', 'Asiapac', 'Latam', 'Africa'];
  const labels = ['Europa', 'Nord America', 'Asia-Pacifico', 'America Latina', 'Africa'];

  slide.addChart(pptx.charts.BAR, [
    { name: '2023', labels, values: continents.map(c => (coffeeByContinent[c]?.val23 || 0) / 1e9) },
    { name: '2024', labels, values: continents.map(c => (coffeeByContinent[c]?.val24 || 0) / 1e9) },
    { name: '2025', labels, values: continents.map(c => (coffeeByContinent[c]?.val25 || 0) / 1e9) },
  ], {
    x: LM, y: CONTENT_Y, w: 8.5, h: CONTENT_H,
    barDir: 'col',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '#,##0.0',
    dataLabelFontSize: 8,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.lavMed, C.medBlue, C.purple],
    showLegend: true,
    legendPos: 't',
    legendFontSize: 9,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // YoY growth callouts
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 9.6, y: CONTENT_Y + 0.3, w: 3.2, h: 3.5,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Crescita 2024\u21922025', {
    x: 9.8, y: CONTENT_Y + 0.4, w: 2.8, h: 0.4,
    fontSize: 12, fontFace: 'Georgia', bold: true, color: C.navy,
  });

  continents.forEach((c, i) => {
    const g = pct(coffeeByContinent[c]?.val25, coffeeByContinent[c]?.val24);
    const gStr = g != null ? (g >= 0 ? '+' : '') + g.toFixed(1) + '%' : '\u2014';
    const gColor = g >= 0 ? C.teal : C.rose;
    slide.addText(`${labels[i]}:  `, {
      x: 9.8, y: CONTENT_Y + 0.85 + i * 0.55, w: 1.5, h: 0.4,
      fontSize: 11, fontFace: 'Arial', color: C.gray,
    });
    slide.addText(gStr, {
      x: 11.2, y: CONTENT_Y + 0.85 + i * 0.55, w: 1.2, h: 0.4,
      fontSize: 14, fontFace: 'Georgia', bold: true, color: gColor,
    });
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 5: GLOBAL PRICE/UNIT BY CONTINENT (NEW — v3)
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Prezzo per Unità — Posizionamento Globale', 'Price/Unit medio del caffè per continente (€, 2025)');

  const continents = ['North America', 'Europe', 'Africa', 'Latam', 'Asiapac'];
  const labels = ['Nord America', 'Europa', 'Africa', 'America Latina', 'Asia-Pacifico'];
  const pricePerUnit = continents.map(c => {
    const d = coffeeByContinent[c];
    return (d && d.units25 > 0) ? d.val25 / d.units25 : 0;
  });

  slide.addChart(pptx.charts.BAR, [
    { name: 'Prezzo/Unità (€)', labels, values: pricePerUnit },
  ], {
    x: LM, y: CONTENT_Y, w: 7.5, h: CONTENT_H,
    barDir: 'bar',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '€#,##0.00',
    dataLabelFontSize: 11,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisOrientation: 'minMax',
    catAxisLabelFontSize: 11,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Price inflation callout
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.6, y: CONTENT_Y + 0.3, w: 4.2, h: 3.8,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Insight', {
    x: 8.8, y: CONTENT_Y + 0.4, w: 3.8, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });
  slide.addText(
    `Il Nord America ha il prezzo/unità più alto al mondo: ${fmtPrice(pricePerUnit[0])}.\n\nL'Europa segue a ${fmtPrice(pricePerUnit[1])}, quasi la metà.\n\nQuesto rende il Nord America il mercato ideale per brand premium italiani come Borbone: margini più alti per unità venduta.`,
    {
      x: 8.8, y: CONTENT_Y + 0.8, w: 3.8, h: 2.2,
      fontSize: 11, fontFace: 'Arial', color: C.gray,
      lineSpacing: 16,
    }
  );

  // Price inflation trend
  slide.addText('Inflazione Prezzo/Unità (2Y)', {
    x: 8.8, y: CONTENT_Y + 3.1, w: 3.8, h: 0.35,
    fontSize: 11, fontFace: 'Georgia', bold: true, color: C.navy,
  });
  const inflationData = [
    ['Europa', '+26.5%'],
    ['Nord America', '+11.5%'],
    ['America Latina', '+49.2%'],
  ];
  inflationData.forEach(([label, val], i) => {
    slide.addText(label, {
      x: 8.8, y: CONTENT_Y + 3.5 + i * 0.35, w: 2.0, h: 0.3,
      fontSize: 10, fontFace: 'Arial', color: C.gray,
    });
    slide.addText(val, {
      x: 10.8, y: CONTENT_Y + 3.5 + i * 0.35, w: 1.6, h: 0.3,
      fontSize: 12, fontFace: 'Georgia', bold: true, color: C.teal, align: 'right',
    });
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 6: NORTH AMERICA FOCUS — USA vs Canada
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Focus Nord America', 'Il mercato del caff\u00E8 in USA e Canada a confronto');

  const countries = [
    { name: 'Stati Uniti', val25: usaTotal25, val24: usaTotal24, fmcg: usaFMCG25, ppu: usaPricePerUnit },
    { name: 'Canada', val25: canadaTotal25, val24: canadaTotal24, fmcg: canadaFMCG25, ppu: canadaPricePerUnit },
  ];

  countries.forEach((c, i) => {
    const x = LM + i * 6.2;
    const share = ((c.val25 / c.fmcg) * 100).toFixed(1);
    const growth = fmtPct(c.val25, c.val24);

    // Card
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: CONTENT_Y, w: 5.7, h: 5.0,
      fill: { color: i === 1 ? C.lavLight : C.white },
      line: { color: i === 1 ? C.purple : 'E0E0E0', width: i === 1 ? 2 : 1 },
      rectRadius: 0.1,
    });

    // Country name
    slide.addText(c.name, {
      x: x + 0.3, y: CONTENT_Y + 0.1, w: 5, h: 0.55,
      fontSize: 24, fontFace: 'Georgia', bold: true, color: C.navy,
    });

    // Metrics
    const metrics = [
      { label: 'Mercato Caff\u00E8 2025', value: fmt(c.val25) },
      { label: 'Crescita YoY', value: growth },
      { label: 'Prezzo/Unit\u00E0', value: fmtPrice(c.ppu) },
      { label: 'Quota Caff\u00E8 su FMCG', value: share + '%' },
      { label: 'Valore FMCG 2025', value: fmt(c.fmcg) },
    ];

    metrics.forEach((m, j) => {
      slide.addText(m.label, {
        x: x + 0.3, y: CONTENT_Y + 0.8 + j * 0.8, w: 3, h: 0.35,
        fontSize: 11, fontFace: 'Arial', color: C.gray,
      });
      slide.addText(m.value, {
        x: x + 3.3, y: CONTENT_Y + 0.8 + j * 0.8, w: 2, h: 0.35,
        fontSize: 18, fontFace: 'Georgia', bold: true,
        color: j === 1 ? C.teal : C.navy, align: 'right',
      });
    });

    // Highlight for Canada
    if (i === 1) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: x + 0.3, y: CONTENT_Y + 4.5, w: 5.1, h: 0.35,
        fill: { color: C.purple },
        rectRadius: 0.05,
      });
      slide.addText('BORBONE NON \u00C8 ANCORA PRESENTE \u2192 OPPORTUNIT\u00C0', {
        x: x + 0.3, y: CONTENT_Y + 4.5, w: 5.1, h: 0.35,
        fontSize: 10, fontFace: 'Arial', bold: true, color: C.white, align: 'center',
      });
    }
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 7: CANADA SEGMENTATION (enhanced with price/unit — v3)
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Canada \u2014 Segmentazione del Caff\u00E8', 'Valore 2025 e crescita per segmento');

  const segNames = ['COFFEE MULTI SERVE', 'COFFEE SINGLE SERVE ROAST', 'COFFEE SOLUBLE'];
  const segLabels = ['Multi Serve\n(Macinato)', 'Single Serve Roast\n(Capsule/Cialde)', 'Solubile'];
  const segVals25 = segNames.map(s => (canadaSegments[s]?.val25 || 0) / 1e6);

  slide.addChart(pptx.charts.BAR, [
    { name: 'Valore 2025 (\u20ACM)', labels: segLabels, values: segVals25 },
  ], {
    x: LM, y: CONTENT_Y, w: 7, h: CONTENT_H,
    barDir: 'col',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '#,##0"M"',
    dataLabelFontSize: 11,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Segment detail cards on the right (v3: with price/unit)
  const segData = segNames.map((s, i) => {
    const seg = canadaSegments[s];
    const ppu25 = (seg && seg.units25 > 0) ? seg.val25 / seg.units25 : 0;
    const ppu24 = (seg && seg.units24 > 0) ? seg.val24 / seg.units24 : 0;
    const ppuGrowth = ppu24 > 0 ? fmtPct(ppu25, ppu24) : '\u2014';
    return {
      label: segLabels[i].replace('\n', ' '),
      val25: seg?.val25 || 0,
      growth: fmtPct(seg?.val25, seg?.val24),
      share: ((seg?.val25 || 0) / canadaTotal25 * 100).toFixed(1),
      ppu: fmtPrice(ppu25),
      ppuGrowth,
    };
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.1, y: CONTENT_Y, w: 4.7, h: CONTENT_H,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Dettaglio Segmenti', {
    x: 8.3, y: CONTENT_Y + 0.1, w: 4.3, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });

  segData.forEach((s, i) => {
    const y = CONTENT_Y + 0.6 + i * 1.6;
    slide.addText(s.label, {
      x: 8.3, y, w: 4.3, h: 0.3,
      fontSize: 11, fontFace: 'Arial', bold: true, color: C.navy,
    });
    slide.addText(`${fmt(s.val25)}  |  ${s.share}% del totale  |  Crescita: ${s.growth}`, {
      x: 8.3, y: y + 0.3, w: 4.3, h: 0.3,
      fontSize: 10, fontFace: 'Arial', color: C.gray,
    });
    // Price/unit line (v3)
    slide.addText(`Prezzo/Unit\u00E0: ${s.ppu}  (${s.ppuGrowth} YoY)`, {
      x: 8.3, y: y + 0.58, w: 4.3, h: 0.25,
      fontSize: 10, fontFace: 'Arial', bold: true, color: C.amber,
    });
    // Highlight SSR
    if (i === 1) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 8.3, y: y + 0.88, w: 4.1, h: 0.25,
        fill: { color: C.teal },
        rectRadius: 0.04,
      });
      slide.addText('CORE BUSINESS DI BORBONE', {
        x: 8.3, y: y + 0.88, w: 4.1, h: 0.25,
        fontSize: 9, fontFace: 'Arial', bold: true, color: C.white, align: 'center',
      });
    }
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 8: CANADA GROWTH DECOMPOSITION (NEW — v3, KEY INSIGHT)
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Canada — Decomposizione della Crescita', 'Crescita Valore vs Volume vs Prezzo per segmento (YoY 2024→2025)');

  // Clustered bar chart: Value Growth, Volume Growth, Price Growth for 3 segments
  const decompLabels = ['Multi Serve', 'Single Serve Roast', 'Solubile'];
  const decompSegKeys = ['COFFEE MULTI SERVE', 'COFFEE SINGLE SERVE ROAST', 'COFFEE SOLUBLE'];

  // Compute actual growth rates from data
  const valGrowth = decompSegKeys.map(k => {
    const s = canadaSegments[k];
    return s && s.val24 > 0 ? ((s.val25 - s.val24) / s.val24) * 100 : 0;
  });
  const volGrowth = decompSegKeys.map(k => {
    const s = canadaSegments[k];
    return s && s.units24 > 0 ? ((s.units25 - s.units24) / s.units24) * 100 : 0;
  });
  const priceGrowth = decompSegKeys.map(k => {
    const s = canadaSegments[k];
    const ppu25 = s && s.units25 > 0 ? s.val25 / s.units25 : 0;
    const ppu24 = s && s.units24 > 0 ? s.val24 / s.units24 : 0;
    return ppu24 > 0 ? ((ppu25 - ppu24) / ppu24) * 100 : 0;
  });

  slide.addChart(pptx.charts.BAR, [
    { name: 'Crescita Valore', labels: decompLabels, values: valGrowth },
    { name: 'Crescita Volume', labels: decompLabels, values: volGrowth },
    { name: 'Crescita Prezzo', labels: decompLabels, values: priceGrowth },
  ], {
    x: LM, y: CONTENT_Y, w: 7, h: CONTENT_H - 0.6,
    barDir: 'col',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '+#,##0.0"%";-#,##0.0"%"',
    dataLabelFontSize: 9,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisLabelFontSize: 11,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple, C.rose, C.teal],
    showLegend: true,
    legendPos: 't',
    legendFontSize: 9,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Insight callout on the right
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.0, y: CONTENT_Y, w: 4.8, h: CONTENT_H - 0.6,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Insight Chiave', {
    x: 8.2, y: CONTENT_Y + 0.1, w: 4.4, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });
  slide.addText(
    'La crescita del caffè in Canada è interamente guidata dal prezzo.\n\nI volumi sono in calo in tutti i segmenti.\n\nQuesto indica un mercato maturo che si premiumizza — esattamente il territorio di Borbone.',
    {
      x: 8.2, y: CONTENT_Y + 0.55, w: 4.4, h: 3.2,
      fontSize: 12, fontFace: 'Arial', color: C.gray,
      lineSpacing: 18,
    }
  );

  // Green callout bar at bottom
  const barY = CONTENT_END - 0.5;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: LM, y: barY, w: CW, h: 0.45,
    fill: { color: C.teal },
    rectRadius: 0.06,
  });
  slide.addText('MERCATO IN PREMIUMIZZAZIONE \u2192 OPPORTUNIT\u00C0 PER BRAND PREMIUM', {
    x: LM, y: barY, w: CW, h: 0.45,
    fontSize: 13, fontFace: 'Arial', bold: true, color: C.white, align: 'center', valign: 'middle',
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 9: SINGLE SERVE ROAST DEEP DIVE
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Single Serve Roast \u2014 Il Segmento Chiave', 'Top 10 mercati per valore e crescita 2024\u21922025');

  // Top 10 SSR markets by value 2025
  const ssrEntries = Object.entries(ssrByCountry)
    .filter(([, d]) => d.val25 > 0)
    .sort((a, b) => b[1].val25 - a[1].val25)
    .slice(0, 10);

  const ssrLabels = ssrEntries.map(([c]) => c === 'United States' ? 'USA' : c === 'Korea(South)' ? 'Corea Sud' : c);
  const ssrVals = ssrEntries.map(([, d]) => d.val25 / 1e6);

  slide.addChart(pptx.charts.BAR, [
    { name: 'Valore 2025 (\u20ACM)', labels: ssrLabels, values: ssrVals },
  ], {
    x: LM, y: CONTENT_Y, w: 8, h: CONTENT_H,
    barDir: 'bar',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '#,##0',
    dataLabelFontSize: 9,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisOrientation: 'minMax',
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Growth rates on the right
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 9.1, y: CONTENT_Y, w: 3.7, h: CONTENT_H,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Crescita YoY', {
    x: 9.3, y: CONTENT_Y + 0.1, w: 3.3, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });

  ssrEntries.forEach(([c, d], i) => {
    const g = pct(d.val25, d.val24);
    const gStr = g != null ? (g >= 0 ? '+' : '') + g.toFixed(1) + '%' : 'Nuovo';
    const gColor = g == null ? C.blue : (g >= 0 ? C.teal : C.rose);
    const name = c === 'United States' ? 'USA' : c === 'Korea(South)' ? 'Corea Sud' : c;
    slide.addText(name, {
      x: 9.3, y: CONTENT_Y + 0.55 + i * 0.48, w: 1.8, h: 0.38,
      fontSize: 9, fontFace: 'Arial', color: C.gray,
    });
    slide.addText(gStr, {
      x: 11.1, y: CONTENT_Y + 0.55 + i * 0.48, w: 1.3, h: 0.38,
      fontSize: 11, fontFace: 'Georgia', bold: true, color: gColor, align: 'right',
    });
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 10: SSR PRICE/UNIT WORLDWIDE (NEW — v3)
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Single Serve Roast — Prezzo per Unità nel Mondo', 'Price/Unit 2025 per i top 10 mercati SSR (€)');

  // SSR by country sorted by price/unit (only those with units data)
  const ssrPriceEntries = Object.entries(ssrByCountry)
    .filter(([, d]) => d.val25 > 0 && d.units25 > 0)
    .map(([c, d]) => ({ country: c, ppu: d.val25 / d.units25 }))
    .sort((a, b) => b.ppu - a.ppu)
    .slice(0, 10);

  const ssrPriceLabels = ssrPriceEntries.map(e => e.country === 'United States' ? 'USA' : e.country === 'Korea(South)' ? 'Corea Sud' : e.country);
  const ssrPriceVals = ssrPriceEntries.map(e => e.ppu);

  // Determine which index is Canada for highlighting
  const canadaIdx = ssrPriceEntries.findIndex(e => e.country === 'Canada');

  // For pptxgenjs bar charts, we can't color individual bars differently in a single series
  // So we use two series: one for Canada, one for others
  const canadaVals = ssrPriceVals.map((v, i) => i === canadaIdx ? v : null);
  const otherVals = ssrPriceVals.map((v, i) => i === canadaIdx ? null : v);

  slide.addChart(pptx.charts.BAR, [
    { name: 'Canada', labels: ssrPriceLabels, values: canadaVals },
    { name: 'Altri Mercati', labels: ssrPriceLabels, values: otherVals },
  ], {
    x: LM, y: CONTENT_Y, w: 7.5, h: CONTENT_H,
    barDir: 'bar',
    barGrouping: 'stacked',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '€#,##0.00',
    dataLabelFontSize: 10,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisOrientation: 'minMax',
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.amber, C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Key markets callout on the right
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.6, y: CONTENT_Y + 0.3, w: 4.2, h: 4.5,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Prezzo/Unità SSR — Mercati Chiave', {
    x: 8.8, y: CONTENT_Y + 0.4, w: 3.8, h: 0.4,
    fontSize: 12, fontFace: 'Georgia', bold: true, color: C.navy,
  });

  // Key market prices table
  const keySSRMarkets = [
    ['Canada', ssrByCountry['Canada'], true],
    ['USA', ssrByCountry['United States'], false],
    ['Italy', ssrByCountry['Italy'], false],
    ['France', ssrByCountry['France'], false],
    ['Spain', ssrByCountry['Spain'], false],
  ];
  keySSRMarkets.forEach(([label, d, highlight], i) => {
    const ppuVal = (d && d.units25 > 0) ? d.val25 / d.units25 : 0;
    const ppuStr = fmtPrice(ppuVal);
    const extra = highlight ? '  (HIGHEST)' : '';
    slide.addText(String(label), {
      x: 8.8, y: CONTENT_Y + 0.9 + i * 0.42, w: 1.8, h: 0.35,
      fontSize: 11, fontFace: 'Arial', bold: !!highlight, color: highlight ? C.amber : C.gray,
    });
    slide.addText(ppuStr + extra, {
      x: 10.6, y: CONTENT_Y + 0.9 + i * 0.42, w: 2.0, h: 0.35,
      fontSize: 12, fontFace: 'Georgia', bold: true, color: highlight ? C.amber : C.navy, align: 'right',
    });
  });

  // Insight text
  slide.addText(
    'Il Canada ha il prezzo/unità più alto al mondo nel Single Serve Roast.\n\nUn brand premium come Borbone può posizionarsi con margini superiori rispetto a qualsiasi altro mercato.',
    {
      x: 8.8, y: CONTENT_Y + 3.1, w: 3.8, h: 1.5,
      fontSize: 11, fontFace: 'Arial', color: C.gray,
      lineSpacing: 16,
    }
  );

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 11: BORBONE GLOBAL PERFORMANCE
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Caff\u00E8 Borbone \u2014 Performance Globale', 'Fatturato per mercato 2025 (\u20AC)');

  // Sort by val25
  const bEntries = Object.entries(borboneByCountry)
    .filter(([, d]) => d.val25 > 0)
    .sort((a, b) => b[1].val25 - a[1].val25);

  // Top 10
  const topB = bEntries.slice(0, 10);
  const bLabels = topB.map(([c]) => c);
  const bVals = topB.map(([, d]) => d.val25 / 1e6);

  slide.addChart(pptx.charts.BAR, [
    { name: 'Fatturato 2025 (\u20ACM)', labels: bLabels, values: bVals },
  ], {
    x: LM, y: CONTENT_Y, w: 7.5, h: CONTENT_H,
    barDir: 'bar',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '#,##0.0',
    dataLabelFontSize: 9,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisOrientation: 'minMax',
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Key metrics panel
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.6, y: CONTENT_Y, w: 4.2, h: CONTENT_H,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Performance Chiave', {
    x: 8.8, y: CONTENT_Y + 0.1, w: 3.8, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });

  const italyShare = ((borboneItaly25 / borboneGlobal25) * 100).toFixed(1);
  const intlRev = borboneGlobal25 - borboneItaly25;
  const intlShare = (100 - parseFloat(italyShare)).toFixed(1);

  // KPI lines WITHOUT new markets (those go as a separate callout below)
  const kpiLines = [
    ['Fatturato globale 2025', fmt(borboneGlobal25)],
    ['Crescita YoY', fmtPct(borboneGlobal25, borboneGlobal24)],
    ['Italia: % del totale', italyShare + '%'],
    ['Fatturato internazionale', fmt(intlRev)],
    ['Quota internazionale', intlShare + '%'],
    ['Mercati attivi 2025', String(borboneCountries25)],
  ];

  kpiLines.forEach(([label, value], i) => {
    slide.addText(label, {
      x: 8.8, y: CONTENT_Y + 0.6 + i * 0.45, w: 2.2, h: 0.38,
      fontSize: 10, fontFace: 'Arial', color: C.gray,
    });
    slide.addText(value, {
      x: 11.0, y: CONTENT_Y + 0.6 + i * 0.45, w: 1.6, h: 0.38,
      fontSize: 12, fontFace: 'Georgia', bold: true, color: C.navy, align: 'right',
    });
  });

  // New markets as separate callout below KPI list (v2 fix #4)
  const newMktY = CONTENT_Y + 0.6 + kpiLines.length * 0.45 + 0.15;
  slide.addText('Nuovi mercati 2025:', {
    x: 8.8, y: newMktY, w: 3.8, h: 0.3,
    fontSize: 10, fontFace: 'Arial', bold: true, color: C.navy,
  });
  slide.addText(newMarkets2025.join(', ') || '\u2014', {
    x: 8.8, y: newMktY + 0.28, w: 3.8, h: 0.6,
    fontSize: 9, fontFace: 'Arial', color: C.gray,
    lineSpacing: 14,
    wrap: true,
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 12: BORBONE GEOGRAPHIC EXPANSION
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Borbone nel Mondo \u2014 Espansione Geografica', 'Evoluzione della presenza internazionale 2023\u20132025');

  // Expansion timeline chart
  slide.addChart(pptx.charts.BAR, [
    { name: 'Mercati Attivi', labels: ['2023', '2024', '2025'], values: [borboneCountries23, borboneCountries24, borboneCountries25] },
  ], {
    x: LM, y: CONTENT_Y, w: 4.5, h: 2.5,
    barDir: 'col',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFontSize: 16,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisLabelFontSize: 12,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { style: 'none' },
    ...CHART_POLISH,
  });

  // Revenue evolution
  slide.addChart(pptx.charts.BAR, [
    { name: 'Fatturato Globale (\u20ACM)', labels: ['2023', '2024', '2025'], values: [borboneGlobal23 / 1e6, borboneGlobal24 / 1e6, borboneGlobal25 / 1e6] },
  ], {
    x: 5.6, y: CONTENT_Y, w: 4.5, h: 2.5,
    barDir: 'col',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '#,##0.0"M"',
    dataLabelFontSize: 12,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisLabelFontSize: 12,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.amber],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { style: 'none' },
    ...CHART_POLISH,
  });

  // Labels
  slide.addText('Numero di Mercati', {
    x: LM, y: CONTENT_Y + 2.55, w: 4.5, h: 0.35,
    fontSize: 11, fontFace: 'Arial', bold: true, color: C.navy, align: 'center',
  });
  slide.addText('Fatturato Globale', {
    x: 5.6, y: CONTENT_Y + 2.55, w: 4.5, h: 0.35,
    fontSize: 11, fontFace: 'Arial', bold: true, color: C.navy, align: 'center',
  });

  // Country table
  slide.addText('Dettaglio per Paese \u2014 Fatturato 2025', {
    x: LM, y: CONTENT_Y + 3.1, w: 12, h: 0.35,
    fontSize: 12, fontFace: 'Georgia', bold: true, color: C.navy,
  });

  const headerOpts = { bold: true, fill: { color: C.navy }, color: C.white, fontSize: 9, fontFace: 'Arial' };
  const tableRows = [
    [
      { text: 'Paese', options: headerOpts },
      { text: '2023', options: { ...headerOpts, align: 'right' } },
      { text: '2024', options: { ...headerOpts, align: 'right' } },
      { text: '2025', options: { ...headerOpts, align: 'right' } },
      { text: 'YoY%', options: { ...headerOpts, align: 'right' } },
    ],
  ];

  const sortedCountries = Object.entries(borboneByCountry)
    .sort((a, b) => b[1].val25 - a[1].val25)
    .slice(0, 10);

  sortedCountries.forEach(([country, d], idx) => {
    const g = pct(d.val25, d.val24);
    const gStr = g != null ? (g >= 0 ? '+' : '') + g.toFixed(1) + '%' : 'Nuovo';
    const rowFill = idx % 2 === 0 ? C.lavLight : C.white;
    const cellOpts = { fontSize: 8, fontFace: 'Arial', fill: { color: rowFill } };
    tableRows.push([
      { text: country, options: cellOpts },
      { text: d.val23 > 0 ? fmt(d.val23) : '\u2014', options: { ...cellOpts, align: 'right' } },
      { text: d.val24 > 0 ? fmt(d.val24) : '\u2014', options: { ...cellOpts, align: 'right' } },
      { text: d.val25 > 0 ? fmt(d.val25) : '\u2014', options: { ...cellOpts, align: 'right' } },
      { text: gStr, options: { ...cellOpts, bold: true, align: 'right', color: g >= 0 ? C.teal : C.rose } },
    ]);
  });

  // v2 fix #5: colW sums to 12.0 = w, rowH 0.18
  slide.addTable(tableRows, {
    x: LM, y: CONTENT_Y + 3.5, w: 12.0, h: 2.0,
    colW: [3.0, 2.4, 2.4, 2.4, 1.8],
    border: { type: 'solid', color: 'E0E0E0', pt: 0.5 },
    rowH: 0.18,
    autoPage: false,
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 13: BORBONE MARKET SHARE
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Borbone in Europa \u2014 Quota di Mercato', 'Quota del caff\u00E8 totale nei mercati europei chiave 2025');

  // Compute market share — filter >= 0.01% so tiny shares don't show "0.00%"
  const europeCountries = Object.entries(borboneByCountry)
    .filter(([c, d]) => d.val25 > 0 && coffeeByCountry[c] && coffeeByCountry[c].val25 > 0)
    .map(([c, d]) => ({
      country: c,
      borboneVal: d.val25,
      coffeeVal: coffeeByCountry[c].val25,
      share: (d.val25 / coffeeByCountry[c].val25) * 100,
    }))
    .filter(d => d.share >= 0.01)  // v2 fix: filter out misleading 0.00% entries
    .sort((a, b) => b.share - a.share)
    .slice(0, 10);

  const shareLabels = europeCountries.map(d => d.country === 'United States' ? 'USA' : d.country);
  const shareVals = europeCountries.map(d => d.share);

  // Determine format code based on data range
  const maxShare = Math.max(...shareVals);
  const formatCode = maxShare < 1 ? '#,##0.000"%"' : '#,##0.00"%"';

  slide.addChart(pptx.charts.BAR, [
    { name: 'Quota di Mercato (%)', labels: shareLabels, values: shareVals },
  ], {
    x: LM, y: CONTENT_Y, w: 7.5, h: CONTENT_H,
    barDir: 'bar',
    barGrouping: 'clustered',
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: formatCode,
    dataLabelFontSize: 10,
    dataLabelFontFace: 'Georgia',
    dataLabelFontBold: true,
    dataLabelColor: C.navy,
    catAxisOrientation: 'minMax',
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.gray,
    valAxisHidden: true,
    chartColors: [C.purple],
    showLegend: false,
    catGridLine: { style: 'none' },
    valGridLine: { color: 'E0E0E0', style: 'dash', size: 0.5 },
    ...CHART_POLISH,
  });

  // Callout
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.6, y: CONTENT_Y, w: 4.2, h: 3.5,
    fill: { color: C.lavLight },
    rectRadius: 0.1,
  });
  slide.addText('Insight', {
    x: 8.8, y: CONTENT_Y + 0.1, w: 3.8, h: 0.4,
    fontSize: 14, fontFace: 'Georgia', bold: true, color: C.navy,
  });
  slide.addText(
    `In Italia, Borbone detiene il ${borboneItalyShare.toFixed(1)}% del mercato caff\u00E8 \u2014 un marchio di riferimento.\n\nIn mercati pi\u00F9 recenti come Spagna e Belgio, le quote crescono rapidamente: la Spagna ha registrato ${fmtPct(borboneSpain?.val25, borboneSpain?.val24)} YoY.\n\nIl Canada, con un mercato caff\u00E8 da ${fmt(canadaTotal25)}, rappresenta un'opportunit\u00E0 vergine.`,
    {
      x: 8.8, y: CONTENT_Y + 0.5, w: 3.8, h: 2.7,
      fontSize: 11, fontFace: 'Arial', color: C.gray,
      lineSpacing: 16,
    }
  );

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 14: L'OPPORTUNITA CANADA (enhanced — v3)
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, "L'Opportunit\u00E0 Canada \u2014 Perch\u00E9 Ora", "Sintesi delle evidenze a supporto dell'ingresso nel mercato canadese");

  // Three column layout
  const cols = [
    {
      title: 'Mercato Attrattivo',
      color: C.purple,
      bullets: [
        `Caff\u00E8: ${fmt(canadaTotal25)} (2025)`,
        `Crescita: ${fmtPct(canadaTotal25, canadaTotal24)} YoY`,
        `Prezzo/unit\u00E0 pi\u00F9 alto al mondo nel SSR (${fmtPrice(ssrByCountry['Canada']?.units25 > 0 ? ssrByCountry['Canada'].val25 / ssrByCountry['Canada'].units25 : 0)})`,
        `Crescita 100% guidata dal prezzo \u2014 mercato in premiumizzazione`,
        `Quota caff\u00E8/FMCG: ${((canadaTotal25 / canadaFMCG25) * 100).toFixed(1)}%`,
      ],
    },
    {
      title: 'Borbone \u00E8 Pronto',
      color: C.amber,
      bullets: [
        `${borboneCountries25} mercati attivi nel 2025`,
        `Fatturato globale: ${fmt(borboneGlobal25)}`,
        `Crescita: ${fmtPct(borboneGlobal25, borboneGlobal24)} YoY`,
        `Expertise in Single Serve Roast (core)`,
      ],
    },
    {
      title: 'Caso Spagna',
      color: C.teal,
      bullets: [
        `Spagna 2023: ${fmt(borboneSpain?.val23)}`,
        `Spagna 2025: ${fmt(borboneSpain?.val25)}`,
        `Crescita: ${fmtPct(borboneSpain?.val25, borboneSpain?.val23)} in 2 anni`,
        `Modello replicabile in Canada`,
      ],
    },
  ];

  const colW = 3.9;
  const colGap = (CW - colW * 3) / 2;
  cols.forEach((col, i) => {
    const x = LM + i * (colW + colGap);
    // Card
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: CONTENT_Y, w: colW, h: CONTENT_H,
      fill: { color: C.white },
      line: { color: col.color, width: 1.5 },
      rectRadius: 0.1,
    });
    // Top accent
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.05, y: CONTENT_Y, w: colW - 0.1, h: 0.07,
      fill: { color: col.color },
    });
    // Title
    slide.addText(col.title, {
      x: x + 0.2, y: CONTENT_Y + 0.2, w: colW - 0.4, h: 0.5,
      fontSize: 16, fontFace: 'Georgia', bold: true, color: C.navy,
    });
    // Bullets (v3: tighter spacing to fit extra items)
    const bulletStep = col.bullets.length > 4 ? 0.55 : 0.65;
    col.bullets.forEach((b, j) => {
      slide.addText(b, {
        x: x + 0.2, y: CONTENT_Y + 0.8 + j * bulletStep, w: colW - 0.4, h: 0.50,
        fontSize: 11, fontFace: 'Arial', color: C.gray,
        bullet: true,
        lineSpacing: 15,
      });
    });
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 15: RACCOMANDAZIONI STRATEGICHE
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Raccomandazioni Strategiche', "Piano d'azione per l'ingresso nel mercato canadese");

  const recs = [
    {
      num: '01',
      title: 'Entrare con il Single Serve Roast (Capsule)',
      body: `Il segmento vale ${fmt(canadaSegments['COFFEE SINGLE SERVE ROAST']?.val25)} in Canada e cresce del ${fmtPct(canadaSegments['COFFEE SINGLE SERVE ROAST']?.val25, canadaSegments['COFFEE SINGLE SERVE ROAST']?.val24)}. \u00C8 il core business di Borbone e il segmento con la dinamica di prezzo migliore.`,
      color: C.purple,
    },
    {
      num: '02',
      title: 'Replicare il Modello Spagna',
      body: `In Spagna, Borbone \u00E8 passato da ${fmt(borboneSpain?.val23)} a ${fmt(borboneSpain?.val25)} in due anni (${fmtPct(borboneSpain?.val25, borboneSpain?.val23)}). La stessa strategia di distribuzione graduale pu\u00F2 funzionare in Canada.`,
      color: C.amber,
    },
    {
      num: '03',
      title: 'Posizionamento Premium "Made in Italy"',
      body: `Il Canada \u00E8 un mercato sofisticato con alta propensione alla spesa per il caff\u00E8 (${((canadaTotal25 / canadaFMCG25) * 100).toFixed(1)}% del FMCG). Il posizionamento premium italiano \u00E8 un vantaggio competitivo chiaro.`,
      color: C.teal,
    },
    {
      num: '04',
      title: 'Partnership Distributiva Locale',
      body: `Identificare 1-2 distributori chiave nel canale retail canadese per costruire presenza scaffale e trial. Borbone ha dimostrato in Europa che la brand awareness si costruisce dal punto vendita.`,
      color: C.rose,
    },
  ];

  // v2 fix #8: 4 recs in y: CONTENT_Y to CONTENT_END = 5.5", each gets 1.3"
  const recHeight = 1.3;
  const recGap = (CONTENT_H - recHeight * recs.length) / (recs.length - 1);

  recs.forEach((rec, i) => {
    const y = CONTENT_Y + i * (recHeight + recGap);
    // Number circle
    slide.addShape(pptx.ShapeType.roundRect, {
      x: LM, y, w: 0.5, h: 0.5,
      fill: { color: rec.color },
      rectRadius: 0.25,
    });
    slide.addText(rec.num, {
      x: LM, y, w: 0.5, h: 0.5,
      fontSize: 16, fontFace: 'Georgia', bold: true, color: C.white, align: 'center', valign: 'middle',
    });
    // Title
    slide.addText(rec.title, {
      x: LM + 0.65, y, w: CW - 0.65, h: 0.4,
      fontSize: 16, fontFace: 'Georgia', bold: true, color: C.navy,
    });
    // Body
    slide.addText(rec.body, {
      x: LM + 0.65, y: y + 0.4, w: CW - 0.65, h: 0.75,
      fontSize: 11, fontFace: 'Arial', color: C.gray,
      lineSpacing: 15,
    });
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 16: APPENDICE — DATA TABLE
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addAccentBar(slide);
  addTitle(slide, 'Appendice \u2014 Top 20 Mercati del Caff\u00E8', 'Dettaglio valore e crescita per paese 2025');

  // Top 20 coffee markets
  const topCoffee = Object.entries(coffeeByCountry)
    .sort((a, b) => b[1].val25 - a[1].val25)
    .slice(0, 20);

  const headerOpts = { bold: true, fill: { color: C.navy }, color: C.white, fontSize: 8, fontFace: 'Arial' };
  const tableRows = [
    [
      { text: '#', options: { ...headerOpts, align: 'center' } },
      { text: 'Paese', options: headerOpts },
      { text: 'Continente', options: headerOpts },
      { text: 'Caff\u00E8 2025', options: { ...headerOpts, align: 'right' } },
      { text: 'Caff\u00E8 2024', options: { ...headerOpts, align: 'right' } },
      { text: 'YoY%', options: { ...headerOpts, align: 'right' } },
      { text: 'FMCG 2025', options: { ...headerOpts, align: 'right' } },
      { text: 'Caff\u00E8/FMCG', options: { ...headerOpts, align: 'right' } },
      { text: 'Borbone 2025', options: { ...headerOpts, align: 'right' } },
    ],
  ];

  topCoffee.forEach(([country, d], i) => {
    const g = pct(d.val25, d.val24);
    const gStr = g != null ? (g >= 0 ? '+' : '') + g.toFixed(1) + '%' : '\u2014';
    const fVal = fmcgByCountry[country]?.val25 || 0;
    const coffeeShare = fVal > 0 ? ((d.val25 / fVal) * 100).toFixed(1) + '%' : '\u2014';
    const bVal = borboneByCountry[country]?.val25 || 0;
    const rowFill = i % 2 === 0 ? C.lavLight : C.white;
    const cellOpts = { fontSize: 7.5, fontFace: 'Arial', fill: { color: rowFill } };
    const isCanada = country === 'Canada';
    const highlight = isCanada ? { ...cellOpts, bold: true, color: C.purple } : cellOpts;

    tableRows.push([
      { text: String(i + 1), options: { ...highlight, align: 'center' } },
      { text: country, options: highlight },
      { text: CONTINENT_MAP[d.continent] || d.continent, options: highlight },
      { text: fmt(d.val25), options: { ...highlight, align: 'right' } },
      { text: fmt(d.val24), options: { ...highlight, align: 'right' } },
      { text: gStr, options: { ...highlight, align: 'right', color: g >= 0 ? C.teal : C.rose, bold: true } },
      { text: fmt(fVal), options: { ...highlight, align: 'right' } },
      { text: coffeeShare, options: { ...highlight, align: 'right' } },
      { text: bVal > 0 ? fmt(bVal) : '\u2014', options: { ...highlight, align: 'right' } },
    ]);
  });

  // v2 fix #6: colW sums to 12.0 = w, placed at x: LM
  slide.addTable(tableRows, {
    x: LM, y: CONTENT_Y, w: 12.0, h: CONTENT_H,
    colW: [0.5, 1.8, 1.4, 1.5, 1.5, 1.0, 1.7, 1.1, 1.5],
    border: { type: 'solid', color: 'E0E0E0', pt: 0.5 },
    rowH: 0.22,
    autoPage: false,
  });

  addFooterChrome(slide);
}

// ────────────────────────────────────────────────────────────────────────
// SLIDE 17: BACK COVER
// ────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  slideNum++;
  slide.background = { fill: C.navy };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 0.08,
    fill: { color: C.purple },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 5.5, y: 2.8, w: 2.3, h: 0.06,
    fill: { color: C.amber },
  });

  slide.addText('Grazie', {
    x: 0, y: 3.0, w: 13.333, h: 1.2,
    fontSize: 56, fontFace: 'Georgia', bold: true, color: C.white, align: 'center',
  });

  slide.addText('Caff\u00E8 Borbone \u2014 Espansione Canada', {
    x: 0, y: 4.2, w: 13.333, h: 0.6,
    fontSize: 18, fontFace: 'Arial', color: C.purple, align: 'center',
  });

  slide.addText('Per ulteriori informazioni contattare il team NielsenIQ\nstrategicplanner@nielseniq.com', {
    x: 0, y: 5.2, w: 13.333, h: 0.8,
    fontSize: 12, fontFace: 'Arial', color: C.lavLight, align: 'center',
    lineSpacing: 20,
  });
}

// ─── Export ─────────────────────────────────────────────────────────────
const data = await pptx.write({ outputType: 'nodebuffer' });
writeFileSync(OUTPUT, data);
writeFileSync(OUTPUT2, data);
console.log(`Done: Deck saved to:`);
console.log(`  ${OUTPUT}`);
console.log(`  ${OUTPUT2}`);
console.log(`  ${slideNum} slides generated`);
console.log(`  Global coffee 2025: ${fmt(globalCoffee25)}`);
console.log(`  Canada coffee 2025: ${fmt(canadaTotal25)}`);
console.log(`  Borbone global 2025: ${fmt(borboneGlobal25)}`);
console.log(`  Borbone countries 2025: ${borboneCountries25}`);
