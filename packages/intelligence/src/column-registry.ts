/**
 * NIQ Column Registry — canonical mapping from Italian NIQ fact names to semantic keys.
 *
 * Built from "New Lista Fatti" (7,296 NIQ fact definitions).
 * The core ~60 facts that appear in 90%+ of FMCG datasets are hardcoded here.
 * Resolution order: exact → case-insensitive → normalized → pattern-based inference.
 */

// ─── TYPES ──────────────────────────────────────────────────────

export type ColumnRole = "measure" | "dimension" | "period" | "identifier";
export type ColumnPeriod = "cy" | "py" | "py2" | "pp" | null;
export type ColumnUnit = "currency" | "units" | "volume" | "percent" | "index" | "count" | "ratio" | "price" | null;

export interface ColumnRegistryEntry {
  semanticKey: string;
  canonicalName: string;
  aliases: string[];           // all known name variants (Italian + English)
  folder: string;              // NIQ folder (Sales, Share, Distribution, etc.)
  role: ColumnRole;
  period: ColumnPeriod;
  unit: ColumnUnit;
  formula: string | null;
}

export interface ResolvedColumn {
  rawHeader: string;           // original header from the dataset
  semanticKey: string;         // e.g. "sales_value_cy"
  canonicalName: string;       // e.g. "Sales Value"
  role: ColumnRole;
  period: ColumnPeriod;
  unit: ColumnUnit;
  confidence: number;          // 1.0 = exact, 0.9 = case-insensitive, 0.7 = normalized, 0.5 = pattern
}

export type ColumnRegistry = Map<string, ResolvedColumn>;

// ─── CORE FACTS REGISTRY ────────────────────────────────────────
// The ~60 most common NIQ facts from Lista Fatti, covering Sales, Share,
// Distribution, Price, Promo, and standard dimensions.

const CORE_FACTS: ColumnRegistryEntry[] = [
  // ── SALES: VALUE ──
  { semanticKey: "sales_value_cy", canonicalName: "Sales Value", aliases: ["V. Valore", "V.Valore", "Valore", "Sales Value", "Value Sales"], folder: "Sales", role: "measure", period: "cy", unit: "currency", formula: null },
  { semanticKey: "sales_value_py", canonicalName: "Sales Value PY", aliases: ["V. Valore Anno prec.", "V.Valore Anno prec.", "V. Valore Anno Prec.", "Sales Value PY", "Value PY"], folder: "Sales", role: "measure", period: "py", unit: "currency", formula: null },
  { semanticKey: "sales_value_change_abs", canonicalName: "Sales Value Change", aliases: ["Var.Ass. V. Valore Anno prec.", "Var.Ass. V. Valore", "Value Change Abs"], folder: "Sales", role: "measure", period: null, unit: "currency", formula: "V. Valore - V. Valore Anno Prec." },
  { semanticKey: "sales_value_change_pct", canonicalName: "Sales Value Growth %", aliases: ["Var.% V. Valore Anno prec.", "Var.% V. Valore", "Value Growth %", "Value Growth YoY"], folder: "Sales", role: "measure", period: null, unit: "percent", formula: "(CY/PY - 1) × 100" },

  // ── SALES: UNITS ──
  { semanticKey: "sales_units_cy", canonicalName: "Sales Units", aliases: ["V. Confezioni", "V.Confezioni", "Confezioni", "Sales Units", "Units"], folder: "Sales", role: "measure", period: "cy", unit: "units", formula: null },
  { semanticKey: "sales_units_py", canonicalName: "Sales Units PY", aliases: ["V. Confezioni Anno prec.", "V.Confezioni Anno prec.", "Units PY"], folder: "Sales", role: "measure", period: "py", unit: "units", formula: null },
  { semanticKey: "sales_units_change_pct", canonicalName: "Units Growth %", aliases: ["Var.% V. Confezioni Anno prec.", "Var.% V. Confezioni", "Units Growth %"], folder: "Sales", role: "measure", period: null, unit: "percent", formula: "(CY/PY - 1) × 100" },

  // ── SALES: VOLUME ──
  { semanticKey: "sales_volume_cy", canonicalName: "Sales Volume", aliases: ["V. Volume (ALL)", "V. Volume  (ALL)", "V.Volume (ALL)", "Volume", "Sales Volume"], folder: "Sales", role: "measure", period: "cy", unit: "volume", formula: null },
  { semanticKey: "sales_volume_py", canonicalName: "Sales Volume PY", aliases: ["V. Volume  (ALL) Anno prec.", "V. Volume (ALL) Anno prec.", "V.Volume (ALL) Anno prec.", "Volume PY"], folder: "Sales", role: "measure", period: "py", unit: "volume", formula: null },

  // ── SHARE ──
  { semanticKey: "value_share_cy", canonicalName: "Value Share", aliases: ["Quota Val. - Product", "Quota Val.", "Quota Valore", "Value Share", "Share Value"], folder: "Share", role: "measure", period: "cy", unit: "percent", formula: "Brand Value / Category Value × 100" },
  { semanticKey: "value_share_py", canonicalName: "Value Share PY", aliases: ["Quota Val. - Product Anno prec.", "Quota Val. Anno prec."], folder: "Share", role: "measure", period: "py", unit: "percent", formula: null },
  { semanticKey: "share_change_pts", canonicalName: "Share Change", aliases: ["Var.Ass. Quota Val.", "Var.Ass. Quota Val. - Product", "Share Change pts"], folder: "Share", role: "measure", period: null, unit: "percent", formula: "Share CY - Share PY" },

  // ── PRICE ──
  { semanticKey: "avg_price_pack_cy", canonicalName: "Avg Price per Pack", aliases: ["Prezzo Medio Conf.", "Prezzo Medio", "Avg Price", "Average Price"], folder: "Price", role: "measure", period: "cy", unit: "price", formula: "Value / Units" },
  { semanticKey: "avg_price_pack_py", canonicalName: "Avg Price per Pack PY", aliases: ["Prezzo Medio Conf. Anno prec.", "Prezzo Medio Anno prec."], folder: "Price", role: "measure", period: "py", unit: "price", formula: null },
  { semanticKey: "avg_price_all_cy", canonicalName: "Avg Price (ALL)", aliases: ["Prezzo Medio (ALL)", "Prezzo Medio (All)"], folder: "Price", role: "measure", period: "cy", unit: "price", formula: "Value / Volume" },
  { semanticKey: "avg_price_all_py", canonicalName: "Avg Price (ALL) PY", aliases: ["Prezzo Medio (ALL) Anno prec.", "Prezzo Medio (All) Anno prec."], folder: "Price", role: "measure", period: "py", unit: "price", formula: null },
  { semanticKey: "price_index", canonicalName: "Price Index", aliases: ["Price Index - Product", "Price Index", "Indice Prezzo"], folder: "Price", role: "measure", period: null, unit: "index", formula: "(Brand Price / Category Price) × 100" },

  // ── DISTRIBUTION ──
  { semanticKey: "weighted_dist_cy", canonicalName: "Weighted Distribution", aliases: ["Dist. Pond.", "Dist. Pond. ACV", "Dist.Pond.", "Distr. Pond.", "Weighted Distribution", "Wtd Distribution"], folder: "Distribution", role: "measure", period: "cy", unit: "percent", formula: null },
  { semanticKey: "weighted_dist_py", canonicalName: "Weighted Distribution PY", aliases: ["Dist. Pond. ACV Anno prec.", "Dist. Pond. Anno prec.", "Dist.Pond. Anno prec."], folder: "Distribution", role: "measure", period: "py", unit: "percent", formula: null },
  { semanticKey: "avg_refs_per_store_cy", canonicalName: "Avg Refs per Store", aliases: ["N. Medio Ref. per pdv", "N.Medio Ref. per pdv", "Avg Refs per Store", "Refs per Store"], folder: "Distribution", role: "measure", period: "cy", unit: "count", formula: null },
  { semanticKey: "avg_refs_per_store_py", canonicalName: "Avg Refs per Store PY", aliases: ["N. Medio Ref. per pdv Anno prec.", "N.Medio Ref. per pdv Anno prec."], folder: "Distribution", role: "measure", period: "py", unit: "count", formula: null },
  { semanticKey: "avg_selling_stores_cy", canonicalName: "Avg Selling Stores", aliases: ["N.Medio pdv vendenti", "N. Medio pdv vendenti", "Avg Selling Stores"], folder: "Distribution", role: "measure", period: "cy", unit: "count", formula: null },
  { semanticKey: "avg_selling_stores_py", canonicalName: "Avg Selling Stores PY", aliases: ["N.Medio pdv vendenti Anno prec.", "N. Medio pdv vendenti Anno prec."], folder: "Distribution", role: "measure", period: "py", unit: "count", formula: null },

  // ── RATE OF SALES ──
  { semanticKey: "ros_value_cy", canonicalName: "Value ROS per Store", aliases: ["Rotazioni Valore per PDV", "Rotazioni Valore", "Value ROS", "ROS Value"], folder: "Rate of Sales", role: "measure", period: "cy", unit: "currency", formula: "(Value / Stores) / Weeks" },
  { semanticKey: "ros_value_py", canonicalName: "Value ROS per Store PY", aliases: ["Rotazioni Valore per PDV Anno prec.", "Rotazioni Valore Anno prec."], folder: "Rate of Sales", role: "measure", period: "py", unit: "currency", formula: null },

  // ── PROMO ──
  { semanticKey: "promo_value_cy", canonicalName: "Promo Sales Value", aliases: ["V.Valore Any Promo", "V. Valore Any Promo", "Promo Value", "Promo Sales"], folder: "Promo Sales", role: "measure", period: "cy", unit: "currency", formula: null },
  { semanticKey: "promo_value_py", canonicalName: "Promo Sales Value PY", aliases: ["V.Valore Any Promo Anno prec.", "V. Valore Any Promo Anno prec."], folder: "Promo Sales", role: "measure", period: "py", unit: "currency", formula: null },
  { semanticKey: "promo_volume_cy", canonicalName: "Promo Volume", aliases: ["V. Volume (ALL) Any Promo", "V.Volume (ALL) Any Promo"], folder: "Promo Sales", role: "measure", period: "cy", unit: "volume", formula: null },
  { semanticKey: "promo_volume_py", canonicalName: "Promo Volume PY", aliases: ["V. Volume (ALL) Any Promo Anno prec."], folder: "Promo Sales", role: "measure", period: "py", unit: "volume", formula: null },
  { semanticKey: "promo_units_cy", canonicalName: "Promo Units", aliases: ["V. Conf. Any Promo", "V.Conf. Any Promo", "Promo Units"], folder: "Promo Sales", role: "measure", period: "cy", unit: "units", formula: null },
  { semanticKey: "promo_units_py", canonicalName: "Promo Units PY", aliases: ["V. Conf. Any Promo Anno prec.", "V.Conf. Any Promo Anno prec."], folder: "Promo Sales", role: "measure", period: "py", unit: "units", formula: null },
  { semanticKey: "promo_intensity", canonicalName: "Promo Intensity", aliases: ["Any Promo Int.Idx Val.", "Promo Intensity", "Promo Int."], folder: "Promo Share", role: "measure", period: null, unit: "percent", formula: "Promo Value / Total Value × 100" },

  // ── STANDARD DIMENSIONS ──
  { semanticKey: "dim_channel", canonicalName: "Channel", aliases: ["GROCERY", "Grocery", "Channel", "Canale"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_market", canonicalName: "Market", aliases: ["Markets", "Market", "Mercato", "MARKET"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_period", canonicalName: "Period", aliases: ["Periods", "Period", "Periodo", "PERIOD"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_area_ecr1", canonicalName: "Area (ECR1)", aliases: ["AREA_ECR1", "Area ECR1", "Area", "AREA"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_department_ecr2", canonicalName: "Department (ECR2)", aliases: ["COMPARTO_ECR2", "Comparto ECR2", "Department", "Comparto"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_category_ecr3", canonicalName: "Category (ECR3)", aliases: ["FAMIGLIA_ECR3", "Famiglia ECR3", "Category", "Famiglia"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_market_ecr4", canonicalName: "Market (ECR4)", aliases: ["MERCATO_ECR4", "Mercato ECR4", "Mercato"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_brand", canonicalName: "Brand", aliases: ["MARCA", "Marca", "Brand", "BRAND"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
  { semanticKey: "dim_product", canonicalName: "Product", aliases: ["PRODOTTO", "Prodotto", "Product", "PRODUCT", "Item", "ITEM"], folder: "Dimension", role: "dimension", period: null, unit: null, formula: null },
];

// ─── NORMALIZATION ──────────────────────────────────────────────

/** Normalize a header for fuzzy matching: lowercase, strip punctuation, collapse whitespace, strip accents */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/[.\-_()\/\\,;:'"]/g, " ")                // punctuation → space
    .replace(/\s+/g, " ")                               // collapse whitespace
    .trim();
}

// ─── BUILD ALIAS INDEX ──────────────────────────────────────────

interface AliasIndex {
  exact: Map<string, ColumnRegistryEntry>;        // raw alias → entry
  normalized: Map<string, ColumnRegistryEntry>;   // normalized alias → entry
}

function buildAliasIndex(): AliasIndex {
  const exact = new Map<string, ColumnRegistryEntry>();
  const normalized = new Map<string, ColumnRegistryEntry>();

  for (const entry of CORE_FACTS) {
    for (const alias of entry.aliases) {
      exact.set(alias, entry);
      exact.set(alias.toLowerCase(), entry);
      normalized.set(normalize(alias), entry);
    }
  }
  return { exact, normalized };
}

const ALIAS_INDEX = buildAliasIndex();

// ─── PATTERN-BASED INFERENCE ────────────────────────────────────

/** Infer column metadata from naming patterns when no registry match exists */
function inferFromPattern(header: string): Partial<ResolvedColumn> | null {
  const h = header.toLowerCase();
  const norm = normalize(header);

  // Period detection
  let period: ColumnPeriod = "cy";
  if (/anno\s*prec/i.test(header) || /\bpy\b/i.test(header)) period = "py";
  else if (/2\s*anno\s*prec/i.test(header)) period = "py2";
  else if (/per\.\s*prec/i.test(header) || /\bpp\b/i.test(header)) period = "pp";

  // Unit detection
  let unit: ColumnUnit = null;
  if (/var\s*\.?\s*%|growth\s*%|change\s*%/i.test(header)) unit = "percent";
  else if (/index|indice/i.test(header)) unit = "index";
  else if (/quota|share/i.test(header)) unit = "percent";
  else if (/prezzo|price|avg.*price/i.test(header)) unit = "price";
  else if (/volume/i.test(header)) unit = "volume";
  else if (/conf|units|pezzi/i.test(header)) unit = "units";
  else if (/valore|value|sales/i.test(header)) unit = "currency";
  else if (/dist|distribu/i.test(header)) unit = "percent";

  // Role detection
  let role: ColumnRole = "measure";
  if (/^(id|code|ean|sku|barcode)/i.test(header)) role = "identifier";
  // All-caps short names are often dimensions
  else if (header === header.toUpperCase() && header.length < 20 && !/\d/.test(header) && !unit) role = "dimension";
  // Known dimension patterns
  else if (/^(market|region|channel|area|store|retailer|brand|marca|prodotto|product|item|period|grocery)/i.test(norm)) role = "dimension";

  if (role === "dimension") {
    return { role: "dimension", period: null, unit: null, confidence: 0.5 };
  }

  return { role, period, unit, confidence: 0.5 };
}

// ─── PUBLIC API ─────────────────────────────────────────────────

/**
 * Resolve a list of raw dataset headers against the NIQ column registry.
 * Returns a ColumnRegistry mapping each raw header to its resolved entry.
 */
export function resolveColumns(headers: string[]): ColumnRegistry {
  const registry: ColumnRegistry = new Map();

  for (const header of headers) {
    if (!header || typeof header !== "string") continue;

    // 1. Exact match
    let entry = ALIAS_INDEX.exact.get(header) ?? ALIAS_INDEX.exact.get(header.toLowerCase());
    if (entry) {
      registry.set(header, {
        rawHeader: header,
        semanticKey: entry.semanticKey,
        canonicalName: entry.canonicalName,
        role: entry.role,
        period: entry.period,
        unit: entry.unit,
        confidence: 1.0,
      });
      continue;
    }

    // 2. Normalized match (strip punctuation, accents, collapse whitespace)
    const norm = normalize(header);
    entry = ALIAS_INDEX.normalized.get(norm);
    if (entry) {
      registry.set(header, {
        rawHeader: header,
        semanticKey: entry.semanticKey,
        canonicalName: entry.canonicalName,
        role: entry.role,
        period: entry.period,
        unit: entry.unit,
        confidence: 0.8,
      });
      continue;
    }

    // 3. Pattern-based inference
    const inferred = inferFromPattern(header);
    if (inferred) {
      registry.set(header, {
        rawHeader: header,
        semanticKey: `unresolved_${normalize(header).replace(/\s+/g, "_")}`,
        canonicalName: header,
        role: inferred.role ?? "measure",
        period: inferred.period ?? null,
        unit: inferred.unit ?? null,
        confidence: inferred.confidence ?? 0.5,
      });
    }
  }

  return registry;
}

/**
 * Resolve a column value from a row by semantic key, canonical name, or raw header.
 * Tries: semantic key → canonical name → case-insensitive raw → normalized.
 */
export function resolveColumnValue(
  row: Record<string, unknown>,
  key: string,
  registry: ColumnRegistry,
): unknown {
  // Direct row access (fast path)
  if (key in row) return row[key];

  // Find by semantic key in registry
  for (const [rawHeader, entry] of registry) {
    if (entry.semanticKey === key) {
      if (rawHeader in row) return row[rawHeader];
    }
  }

  // Find by canonical name
  for (const [rawHeader, entry] of registry) {
    if (entry.canonicalName.toLowerCase() === key.toLowerCase()) {
      if (rawHeader in row) return row[rawHeader];
    }
  }

  // Case-insensitive raw header match
  const keyLower = key.toLowerCase().trim();
  for (const rowKey of Object.keys(row)) {
    if (rowKey.toLowerCase().trim() === keyLower) return row[rowKey];
  }

  // Normalized match
  const keyNorm = normalize(key);
  for (const rowKey of Object.keys(row)) {
    if (normalize(rowKey) === keyNorm) return row[rowKey];
  }

  return undefined;
}

/**
 * Resolve a raw header to its actual key in the row object.
 * Returns the real property name that exists in the row, or undefined.
 */
export function resolveColumnKey(
  row: Record<string, unknown>,
  key: string,
  registry: ColumnRegistry,
): string | undefined {
  if (key in row) return key;

  // Semantic key → raw header
  for (const [rawHeader, entry] of registry) {
    if (entry.semanticKey === key && rawHeader in row) return rawHeader;
  }

  // Case-insensitive
  const keyLower = key.toLowerCase().trim();
  for (const rowKey of Object.keys(row)) {
    if (rowKey.toLowerCase().trim() === keyLower) return rowKey;
  }

  // Normalized
  const keyNorm = normalize(key);
  for (const rowKey of Object.keys(row)) {
    if (normalize(rowKey) === keyNorm) return rowKey;
  }

  return undefined;
}

/**
 * Build a human-readable column report for the analyst/author prompt.
 * Shows what was resolved, what wasn't, and the semantic structure.
 */
export function buildColumnReport(headers: string[]): string {
  const registry = resolveColumns(headers);
  const resolved: string[] = [];
  const dimensions: string[] = [];
  const measures: string[] = [];
  const unresolved: string[] = [];

  for (const [rawHeader, entry] of registry) {
    if (entry.confidence >= 0.8) {
      resolved.push(`"${rawHeader}" → ${entry.canonicalName} [${entry.semanticKey}] (${entry.role}, ${entry.period ?? "n/a"}, ${entry.unit ?? "n/a"})`);
      if (entry.role === "dimension") dimensions.push(entry.canonicalName);
      else measures.push(`${entry.canonicalName}${entry.period === "py" ? " (PY)" : ""}`);
    } else {
      unresolved.push(`"${rawHeader}" → inferred as ${entry.role} (confidence: ${entry.confidence})`);
    }
  }

  const parts: string[] = [];
  parts.push(`## Column Registry Resolution (${resolved.length} resolved, ${unresolved.length} inferred)`);
  if (dimensions.length > 0) parts.push(`Dimensions: ${dimensions.join(", ")}`);
  if (measures.length > 0) parts.push(`Measures: ${measures.join(", ")}`);
  if (unresolved.length > 0) parts.push(`\nInferred (low confidence):\n${unresolved.join("\n")}`);
  return parts.join("\n");
}
