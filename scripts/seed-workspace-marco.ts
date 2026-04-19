/**
 * Seed 90 days of realistic FMCG analyst data into the team-beta workspace
 * for marco@basquio.com.
 *
 * Run: pnpm tsx scripts/seed-workspace-marco.ts
 *
 * Idempotent: deletes prior seeded rows (by metadata.seed = 'marco-90d') first,
 * then re-inserts. Safe to re-run.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_PATH = join(process.cwd(), "apps/web/.env.local");
function loadEnv() {
  try {
    const raw = readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch (error) {
    console.warn(`Could not read ${ENV_PATH}:`, error);
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "15cc947e-70cb-455a-b0df-d8c34b760d71";
const SEED_TAG = "marco-90d";
const TARGET_EMAIL = "marco@basquio.com";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const now = Date.now();
const day = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

async function findUserId(): Promise<string> {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const found = data.users.find((u) => (u.email ?? "").toLowerCase() === TARGET_EMAIL);
  if (!found) throw new Error(`No auth user with email ${TARGET_EMAIL}. Sign in once first.`);
  return found.id;
}

async function wipe() {
  console.log("Wiping prior seed rows...");
  await db
    .from("workspace_deliverables")
    .delete()
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
  await db
    .from("memory_entries")
    .delete()
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
  await db
    .from("facts")
    .delete()
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
  await db
    .from("entity_mentions")
    .delete()
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
  await db
    .from("knowledge_chunks")
    .delete()
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
  const { data: oldDocs } = await db
    .from("knowledge_documents")
    .select("id")
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
  if (oldDocs && oldDocs.length > 0) {
    await db
      .from("knowledge_documents")
      .delete()
      .in(
        "id",
        oldDocs.map((d) => d.id as string),
      );
  }
  await db
    .from("entities")
    .delete()
    .eq("organization_id", ORG_ID)
    .contains("metadata", { seed: SEED_TAG });
}

type EntitySeed = {
  type: string;
  canonical_name: string;
  aliases?: string[];
  role?: string;
  description?: string;
};

const ENTITIES: EntitySeed[] = [
  // people
  { type: "person", canonical_name: "Elena Bianchi", role: "Head of Category, Mulino Bianco", aliases: ["Elena B.", "EB"] },
  { type: "person", canonical_name: "Giovanni Rossi", role: "Marketing Director, Conad" },
  { type: "person", canonical_name: "Sara Conti", role: "Senior Insights Manager, NielsenIQ Italy" },
  { type: "person", canonical_name: "Luca Moretti", role: "Buyer, Esselunga" },
  { type: "person", canonical_name: "Veronica Galli", role: "Senior Brand Manager, Victorinox" },
  { type: "person", canonical_name: "Francesco Pellegrini", role: "Insights Lead, Pavesi" },
  // organizations
  { type: "organization", canonical_name: "Mulino Bianco", aliases: ["Barilla Mulino Bianco"] },
  { type: "organization", canonical_name: "NielsenIQ Italy", aliases: ["NIQ", "NielsenIQ"] },
  { type: "organization", canonical_name: "Pavesi" },
  // brands
  { type: "brand", canonical_name: "Pan di Stelle", description: "Mulino Bianco hero biscuit." },
  { type: "brand", canonical_name: "Ringo", description: "Pavesi sandwich biscuit." },
  { type: "brand", canonical_name: "Loacker", description: "Wafer specialist." },
  { type: "brand", canonical_name: "Doria", description: "Crackers leader." },
  { type: "brand", canonical_name: "Mulino Bianco Crackers" },
  // categories
  { type: "category", canonical_name: "Snack Salati", aliases: ["Salty Snacks"] },
  { type: "category", canonical_name: "Biscotti Frollini" },
  { type: "category", canonical_name: "Wafer", description: "Filled wafer biscuits." },
  { type: "sub_category", canonical_name: "Crackers Aromatizzati" },
  // retailers
  { type: "retailer", canonical_name: "Coop Italia", aliases: ["Coop"] },
  { type: "retailer", canonical_name: "Conad" },
  { type: "retailer", canonical_name: "Esselunga" },
  { type: "retailer", canonical_name: "Carrefour Italia", aliases: ["Carrefour"] },
  // metrics
  { type: "metric", canonical_name: "Value Share", aliases: ["Market Share Value"] },
  { type: "metric", canonical_name: "Volume Share" },
  { type: "metric", canonical_name: "Numeric Distribution", aliases: ["ND"] },
  { type: "metric", canonical_name: "Weighted Distribution", aliases: ["WD"] },
  { type: "metric", canonical_name: "Rate of Sale", aliases: ["ROS"] },
  { type: "metric", canonical_name: "Promo Pressure" },
];

function normalize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function insertEntities(): Promise<Map<string, string>> {
  console.log(`Inserting ${ENTITIES.length} entities...`);
  const map = new Map<string, string>();
  for (const e of ENTITIES) {
    const normalized = normalize(e.canonical_name);
    const { data, error } = await db
      .from("entities")
      .insert({
        organization_id: ORG_ID,
        is_team_beta: true,
        type: e.type,
        canonical_name: e.canonical_name,
        normalized_name: normalized,
        aliases: e.aliases ?? [],
        metadata: {
          seed: SEED_TAG,
          ...(e.role ? { role: e.role } : {}),
          ...(e.description ? { description: e.description } : {}),
        },
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(`Entity insert failed for ${e.canonical_name}: ${error.message}`);
    }
    map.set(`${e.type}::${normalized}`, data.id as string);
  }
  return map;
}

type DocumentSeed = {
  filename: string;
  fileType: string;
  daysAgo: number;
  context: string;
  body: string;
  pages?: number;
  status?: "indexed" | "failed";
  errorMessage?: string;
};

const DOCUMENTS: DocumentSeed[] = [
  {
    filename: "Q1-2026-snack-salati-brief.pdf",
    fileType: "pdf",
    daysAgo: 86,
    context: "Brief from Elena to align on Q1 2026 narrative for Snack Salati.",
    pages: 14,
    body: `Brief Q1 2026: Snack Salati. Elena Bianchi (Head of Category, Mulino Bianco) requests an integrated narrative across Pan di Stelle, Ringo, and Mulino Bianco Crackers. Priority retailer: Conad. Defend value share against private label growth in Crackers. Open question: how much of the Q4 share decline is structural vs promotional? Include Carrefour Italia distribution gap.`,
  },
  {
    filename: "Q4-2025-deck-final.pptx",
    fileType: "pptx",
    daysAgo: 81,
    context: "Final approved Q4 review deck shared with Mulino Bianco leadership.",
    pages: 38,
    body: `Q4 2025 Snack Salati review. Mulino Bianco Crackers value share at 18.4% (-1.2 pts vs Q4 2024). Private label up 2.1 pts. Conad numeric distribution at 88, weighted 92. Esselunga ND at 76 (gap of 12 pts vs Coop Italia). Recommendation: invest in Crackers Aromatizzati with Conad in Q1.`,
  },
  {
    filename: "NIQ-discover-Q4-export.xlsx",
    fileType: "xlsx",
    daysAgo: 79,
    context: "NielsenIQ Discover export, 52w to Dec 28.",
    body: `NielsenIQ Discover, 52w to 2025-12-28. Categories: Biscotti Frollini, Snack Salati, Wafer. Brands: Pan di Stelle, Ringo, Loacker, Doria, Mulino Bianco Crackers. Retailers: Coop Italia, Conad, Esselunga, Carrefour Italia. Metrics: Value Share, Volume Share, Numeric Distribution, Weighted Distribution, Rate of Sale, Promo Pressure.`,
  },
  {
    filename: "elena-call-2025-11-12.txt",
    fileType: "txt",
    daysAgo: 67,
    context: "Transcript of weekly check-in with Elena.",
    body: `Elena Bianchi: We need to stop bleeding share to private label in Crackers. Doria is more aggressive than I expected. Veronica Galli mentioned Victorinox is also rethinking their pack architecture. Let's plan a Q1 narrative around Crackers Aromatizzati premiumization. Sara Conti from NielsenIQ Italy can pull the cross-retailer view.`,
  },
  {
    filename: "competitive-deep-dive-doria-pavesi.pdf",
    fileType: "pdf",
    daysAgo: 54,
    context: "Two-page memo on Doria and Pavesi ranges in Conad.",
    pages: 6,
    body: `Doria Crackers: Rate of Sale +14% YoY in Conad. Promo pressure 31% (vs category 24%). Pavesi Ringo holding Volume Share at 7.2% in Biscotti Frollini, but losing distribution at Esselunga (Weighted Distribution -3 pts). Francesco Pellegrini at Pavesi confirmed reformulation tests.`,
  },
  {
    filename: "victorinox-cross-cat-readout-nov.docx",
    fileType: "docx",
    daysAgo: 41,
    context: "Veronica's monthly cross-category readout.",
    body: `Veronica Galli covered Snack Salati pack innovation patterns from outside FMCG (kitchen-tools adjacency). Recommendation: smaller occasions packs, single-serve bundles, retailer-exclusive collabs. Conad open to a co-branded SKU. Esselunga closed to PL-branded co-marketing.`,
  },
  {
    filename: "carrefour-italy-distribution-gap.pdf",
    fileType: "pdf",
    daysAgo: 22,
    context: "One-page note on Carrefour Italia distribution gap for Mulino Bianco Crackers.",
    pages: 1,
    body: `Mulino Bianco Crackers Numeric Distribution at Carrefour Italia: 67 (vs Coop Italia 91, Conad 88, Esselunga 76). The Carrefour gap is structural, not promotional. Buyer Luca Moretti at Esselunga has held listings flat for 4 quarters. Action: rework pricing ladder before Q1 buyer meeting.`,
  },
  {
    filename: "elena-followup-2026-04-09.txt",
    fileType: "txt",
    daysAgo: 10,
    context: "Quick follow-up from Elena ahead of Q1 review.",
    body: `Elena Bianchi: Q1 review is in 8 days. I want a single chart that explains Crackers Aromatizzati momentum vs core Crackers. Also flag Promo Pressure differential vs Doria. Sara Conti will join the readout.`,
  },
  {
    filename: "broken-half-export.xlsx",
    fileType: "xlsx",
    daysAgo: 3,
    context: "Bad export: only headers, no rows. Use to test retry flow.",
    body: ``,
    status: "failed",
    errorMessage: "Sheet contained 0 data rows. Re-export from NIQ Discover with a non-empty time window.",
  },
];

async function insertDocumentsAndChunks(userId: string): Promise<Map<string, string>> {
  console.log(`Inserting ${DOCUMENTS.length} documents...`);
  const docIdByFilename = new Map<string, string>();
  for (const d of DOCUMENTS) {
    const created_at = day(d.daysAgo);
    const storagePath = `workspace/seed/${SEED_TAG}/${d.filename}`;
    const { data: doc, error } = await db
      .from("knowledge_documents")
      .insert({
        filename: d.filename,
        file_type: d.fileType,
        file_size_bytes: Math.max(2048, d.body.length * 8),
        storage_path: storagePath,
        content_hash: `seed-${SEED_TAG}-${d.filename}`,
        uploaded_by: TARGET_EMAIL,
        uploaded_by_user_id: userId,
        uploaded_by_discord_id: null,
        upload_context: d.context,
        organization_id: ORG_ID,
        is_team_beta: true,
        status: d.status ?? "indexed",
        chunk_count: d.body ? Math.max(1, Math.ceil(d.body.length / 1200)) : 0,
        page_count: d.pages ?? null,
        error_message: d.errorMessage ?? null,
        metadata: { seed: SEED_TAG, parsed_chars: d.body.length },
        created_at,
        updated_at: created_at,
      })
      .select("id")
      .single();
    if (error || !doc) {
      throw new Error(`Document insert failed for ${d.filename}: ${error?.message ?? "no row"}`);
    }
    docIdByFilename.set(d.filename, doc.id as string);

    if (d.body && d.status !== "failed") {
      const chunkCount = Math.max(1, Math.ceil(d.body.length / 1200));
      const chunkRows = [];
      for (let i = 0; i < chunkCount; i += 1) {
        const slice = d.body.slice(i * 1200, (i + 1) * 1200);
        // pgvector expects a fixed-dim vector; the seed uses a sparse stand-in.
        // Real semantic search relies on freshly-uploaded docs that go through embeddings.ts.
        const fakeEmbedding = JSON.stringify(Array(1536).fill(0).map((_, k) => (k === i % 1536 ? 0.5 : 0)));
        chunkRows.push({
          document_id: doc.id,
          chunk_index: i,
          content: slice,
          embedding: fakeEmbedding,
          token_count: Math.ceil(slice.length / 4),
          metadata: { seed: SEED_TAG },
          organization_id: ORG_ID,
          is_team_beta: true,
        });
      }
      const { error: chunkError } = await db.from("knowledge_chunks").insert(chunkRows);
      if (chunkError) {
        throw new Error(`Chunks insert for ${d.filename} failed: ${chunkError.message}`);
      }
    }
  }
  return docIdByFilename;
}

type MentionSeed = { entity: string; doc: string; excerpt?: string };
type FactSeed = {
  subject: string;
  predicate: string;
  object_value: unknown;
  object_entity?: string;
  valid_from?: string;
  valid_to?: string | null;
  source: string;
  evidence?: string;
  confidence?: number;
};

const MENTIONS: MentionSeed[] = [
  { entity: "person::elena bianchi", doc: "Q1-2026-snack-salati-brief.pdf", excerpt: "Brief request from Elena Bianchi (Head of Category)." },
  { entity: "person::elena bianchi", doc: "elena-call-2025-11-12.txt", excerpt: "Weekly check-in transcript." },
  { entity: "person::elena bianchi", doc: "elena-followup-2026-04-09.txt", excerpt: "Q1 review prep follow-up." },
  { entity: "person::sara conti", doc: "elena-call-2025-11-12.txt" },
  { entity: "person::sara conti", doc: "elena-followup-2026-04-09.txt" },
  { entity: "person::francesco pellegrini", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "person::veronica galli", doc: "victorinox-cross-cat-readout-nov.docx" },
  { entity: "person::veronica galli", doc: "elena-call-2025-11-12.txt" },
  { entity: "person::luca moretti", doc: "carrefour-italy-distribution-gap.pdf" },
  { entity: "organization::mulino bianco", doc: "Q1-2026-snack-salati-brief.pdf" },
  { entity: "organization::mulino bianco", doc: "Q4-2025-deck-final.pptx" },
  { entity: "organization::nielseniq italy", doc: "NIQ-discover-Q4-export.xlsx" },
  { entity: "brand::pan di stelle", doc: "Q1-2026-snack-salati-brief.pdf" },
  { entity: "brand::ringo", doc: "Q4-2025-deck-final.pptx" },
  { entity: "brand::ringo", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "brand::loacker", doc: "NIQ-discover-Q4-export.xlsx" },
  { entity: "brand::doria", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "brand::doria", doc: "elena-call-2025-11-12.txt" },
  { entity: "brand::mulino bianco crackers", doc: "Q1-2026-snack-salati-brief.pdf" },
  { entity: "brand::mulino bianco crackers", doc: "Q4-2025-deck-final.pptx" },
  { entity: "brand::mulino bianco crackers", doc: "carrefour-italy-distribution-gap.pdf" },
  { entity: "category::snack salati", doc: "Q1-2026-snack-salati-brief.pdf" },
  { entity: "category::snack salati", doc: "Q4-2025-deck-final.pptx" },
  { entity: "category::biscotti frollini", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "category::wafer", doc: "NIQ-discover-Q4-export.xlsx" },
  { entity: "sub_category::crackers aromatizzati", doc: "Q4-2025-deck-final.pptx" },
  { entity: "sub_category::crackers aromatizzati", doc: "elena-followup-2026-04-09.txt" },
  { entity: "retailer::coop italia", doc: "Q4-2025-deck-final.pptx" },
  { entity: "retailer::conad", doc: "Q1-2026-snack-salati-brief.pdf" },
  { entity: "retailer::conad", doc: "Q4-2025-deck-final.pptx" },
  { entity: "retailer::esselunga", doc: "Q4-2025-deck-final.pptx" },
  { entity: "retailer::esselunga", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "retailer::esselunga", doc: "carrefour-italy-distribution-gap.pdf" },
  { entity: "retailer::carrefour italia", doc: "Q1-2026-snack-salati-brief.pdf" },
  { entity: "retailer::carrefour italia", doc: "carrefour-italy-distribution-gap.pdf" },
  { entity: "metric::value share", doc: "Q4-2025-deck-final.pptx" },
  { entity: "metric::value share", doc: "NIQ-discover-Q4-export.xlsx" },
  { entity: "metric::volume share", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "metric::numeric distribution", doc: "Q4-2025-deck-final.pptx" },
  { entity: "metric::numeric distribution", doc: "carrefour-italy-distribution-gap.pdf" },
  { entity: "metric::weighted distribution", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "metric::rate of sale", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "metric::promo pressure", doc: "competitive-deep-dive-doria-pavesi.pdf" },
  { entity: "metric::promo pressure", doc: "elena-followup-2026-04-09.txt" },
];

const FACTS: FactSeed[] = [
  {
    subject: "brand::mulino bianco crackers",
    predicate: "value_share_in_period",
    object_value: { value: 18.4, unit: "%", period: "2025-Q4" },
    valid_from: day(81),
    valid_to: null,
    source: "Q4-2025-deck-final.pptx",
    evidence: "Mulino Bianco Crackers value share at 18.4%",
    confidence: 0.95,
  },
  {
    subject: "brand::mulino bianco crackers",
    predicate: "value_share_change_yoy",
    object_value: { value: -1.2, unit: "pts", period: "2025-Q4" },
    valid_from: day(81),
    source: "Q4-2025-deck-final.pptx",
    evidence: "(-1.2 pts vs Q4 2024)",
    confidence: 0.95,
  },
  {
    subject: "brand::mulino bianco crackers",
    predicate: "numeric_distribution",
    object_value: { value: 88, retailer: "Conad", period: "2025-Q4" },
    object_entity: "retailer::conad",
    valid_from: day(81),
    source: "Q4-2025-deck-final.pptx",
    confidence: 0.9,
  },
  {
    subject: "brand::mulino bianco crackers",
    predicate: "numeric_distribution",
    object_value: { value: 76, retailer: "Esselunga", period: "2025-Q4" },
    object_entity: "retailer::esselunga",
    valid_from: day(81),
    source: "Q4-2025-deck-final.pptx",
    confidence: 0.9,
  },
  {
    subject: "brand::mulino bianco crackers",
    predicate: "numeric_distribution",
    object_value: { value: 67, retailer: "Carrefour Italia", period: "2026-Q1" },
    object_entity: "retailer::carrefour italia",
    valid_from: day(22),
    source: "carrefour-italy-distribution-gap.pdf",
    evidence: "Numeric Distribution at Carrefour Italia: 67",
    confidence: 0.95,
  },
  {
    subject: "brand::doria",
    predicate: "rate_of_sale_change_yoy",
    object_value: { value: 14, unit: "%", retailer: "Conad", period: "2025-Q4" },
    object_entity: "retailer::conad",
    valid_from: day(54),
    source: "competitive-deep-dive-doria-pavesi.pdf",
    evidence: "Doria Crackers: Rate of Sale +14% YoY in Conad",
    confidence: 0.9,
  },
  {
    subject: "brand::doria",
    predicate: "promo_pressure",
    object_value: { value: 31, unit: "%", retailer: "Conad", period: "2025-Q4" },
    object_entity: "retailer::conad",
    valid_from: day(54),
    source: "competitive-deep-dive-doria-pavesi.pdf",
    confidence: 0.85,
  },
  {
    subject: "category::snack salati",
    predicate: "promo_pressure",
    object_value: { value: 24, unit: "%", period: "2025-Q4" },
    valid_from: day(54),
    source: "competitive-deep-dive-doria-pavesi.pdf",
    confidence: 0.85,
  },
  {
    subject: "brand::ringo",
    predicate: "volume_share",
    object_value: { value: 7.2, unit: "%", category: "Biscotti Frollini", period: "2025-Q4" },
    object_entity: "category::biscotti frollini",
    valid_from: day(54),
    source: "competitive-deep-dive-doria-pavesi.pdf",
    confidence: 0.9,
  },
  {
    subject: "brand::ringo",
    predicate: "weighted_distribution_change_yoy",
    object_value: { value: -3, unit: "pts", retailer: "Esselunga", period: "2025-Q4" },
    object_entity: "retailer::esselunga",
    valid_from: day(54),
    source: "competitive-deep-dive-doria-pavesi.pdf",
    confidence: 0.85,
  },
  {
    subject: "person::elena bianchi",
    predicate: "manages_category",
    object_value: { category: "Snack Salati", since: "2024-01" },
    object_entity: "category::snack salati",
    valid_from: day(86),
    source: "Q1-2026-snack-salati-brief.pdf",
    confidence: 1.0,
  },
  {
    subject: "person::elena bianchi",
    predicate: "stakeholder_of",
    object_value: { organization: "Mulino Bianco", role: "Head of Category" },
    object_entity: "organization::mulino bianco",
    valid_from: day(86),
    source: "Q1-2026-snack-salati-brief.pdf",
    confidence: 1.0,
  },
  {
    subject: "person::francesco pellegrini",
    predicate: "stakeholder_of",
    object_value: { organization: "Pavesi", role: "Insights Lead" },
    valid_from: day(54),
    source: "competitive-deep-dive-doria-pavesi.pdf",
    confidence: 0.9,
  },
  {
    subject: "person::sara conti",
    predicate: "stakeholder_of",
    object_value: { organization: "NielsenIQ Italy", role: "Senior Insights Manager" },
    object_entity: "organization::nielseniq italy",
    valid_from: day(67),
    source: "elena-call-2025-11-12.txt",
    confidence: 0.95,
  },
  {
    subject: "category::snack salati",
    predicate: "private_label_share_change_yoy",
    object_value: { value: 2.1, unit: "pts", period: "2025-Q4" },
    valid_from: day(81),
    source: "Q4-2025-deck-final.pptx",
    evidence: "Private label up 2.1 pts.",
    confidence: 0.9,
  },
  {
    subject: "sub_category::crackers aromatizzati",
    predicate: "strategic_priority",
    object_value: "Lead Q1 2026 narrative for Mulino Bianco at Conad.",
    valid_from: day(86),
    source: "Q1-2026-snack-salati-brief.pdf",
    confidence: 1.0,
  },
];

async function insertMentionsAndFacts(
  entityIds: Map<string, string>,
  docIds: Map<string, string>,
) {
  console.log(`Inserting ${MENTIONS.length} mentions...`);
  const mentionRows = MENTIONS.map((m, i) => {
    const entityId = entityIds.get(m.entity);
    const docId = docIds.get(m.doc);
    if (!entityId || !docId) throw new Error(`Mention #${i} missing entity or doc: ${m.entity} / ${m.doc}`);
    return {
      organization_id: ORG_ID,
      is_team_beta: true,
      entity_id: entityId,
      source_type: "document",
      source_id: docId,
      excerpt: m.excerpt ?? null,
      confidence: 1.0,
      metadata: { seed: SEED_TAG },
    };
  });
  const { error: mentionError } = await db.from("entity_mentions").insert(mentionRows);
  if (mentionError) throw new Error(`Mention insert failed: ${mentionError.message}`);

  console.log(`Inserting ${FACTS.length} facts...`);
  const factRows = FACTS.map((f, i) => {
    const subjectId = entityIds.get(f.subject);
    const docId = docIds.get(f.source);
    if (!subjectId || !docId) throw new Error(`Fact #${i} missing subject or source: ${f.subject} / ${f.source}`);
    const objectId = f.object_entity ? entityIds.get(f.object_entity) ?? null : null;
    return {
      organization_id: ORG_ID,
      is_team_beta: true,
      subject_entity: subjectId,
      predicate: f.predicate,
      object_value: f.object_value as Record<string, unknown>,
      object_entity: objectId,
      valid_from: f.valid_from ?? null,
      valid_to: f.valid_to ?? null,
      source_id: docId,
      source_type: "document",
      confidence: f.confidence ?? 0.85,
      metadata: { seed: SEED_TAG, ...(f.evidence ? { evidence: f.evidence } : {}) },
    };
  });
  const { error: factError } = await db.from("facts").insert(factRows);
  if (factError) throw new Error(`Fact insert failed: ${factError.message}`);
}

type MemorySeed = {
  scope: string;
  memory_type: "semantic" | "episodic" | "procedural";
  path: string;
  content: string;
};

const MEMORIES: MemorySeed[] = [
  {
    scope: "analyst",
    memory_type: "procedural",
    path: "/preferences/style.md",
    content:
      "# Marco's writing preferences\n\n- Lead with the headline number, then the structural reason, then the action.\n- Always cite NielsenIQ Discover with the exact 52w window.\n- Never use the words leverage, unlock, dive deep, seamless.\n- Charts: amber lead series, ultramarine secondary, slate for category baseline.",
  },
  {
    scope: "client:Mulino Bianco",
    memory_type: "semantic",
    path: "/stakeholders.md",
    content:
      "# Mulino Bianco stakeholder map\n\n- Elena Bianchi, Head of Category Snack Salati. Reports into CMO. Wants single-chart narratives. Reviews on Mondays.\n- Decision rhythm: quarterly business review + monthly P&L sync.\n- Hot button: private label share in Crackers and Carrefour distribution gap.",
  },
  {
    scope: "client:Mulino Bianco",
    memory_type: "episodic",
    path: "/wins/q4-narrative.md",
    content:
      "# Q4 2025 narrative that landed\n\nFraming: defend Crackers Aromatizzati share by reallocating promo investment from core Crackers SKUs to Aromatizzati. Elena bought it. Drove Q1 brief. Reuse the structure: defend → invest → measure.",
  },
  {
    scope: "category:Snack Salati",
    memory_type: "semantic",
    path: "/category-norms.md",
    content:
      "# Snack Salati norms\n\n- Promo pressure baseline: 24% (52w avg, 2025).\n- Category growth: +1.4% volume, +3.2% value (mix-up driven).\n- Private label penetration: 32% household, climbing.\n- Top 3 retailers by category sales: Coop Italia, Conad, Esselunga.",
  },
  {
    scope: "workspace",
    memory_type: "procedural",
    path: "/glossary.md",
    content:
      "# Workspace glossary\n\n- ND = Numeric Distribution\n- WD = Weighted Distribution\n- ROS = Rate of Sale\n- PL = Private Label\n- 52w = trailing 52-week period (NielsenIQ Discover default).",
  },
  {
    scope: "workspace",
    memory_type: "procedural",
    path: "/citation-rules.md",
    content:
      "# Citation rules\n\nEvery numeric claim cites a source label, e.g. [s1]. Every share figure includes the period in parentheses. Never invent a number.",
  },
  {
    scope: "client:Mulino Bianco",
    memory_type: "procedural",
    path: "/preferences/edits-q1-tone.md",
    content:
      "# Edit preference learned 2026-04-09\n\nAfter Marco's edits to the Q1 brief draft, future Mulino Bianco deliverables open with a one-sentence headline (no kicker), then the structural diagnosis in 2-3 bullets, then the recommendation. Skip the executive summary section.",
  },
  {
    scope: "category:Snack Salati",
    memory_type: "episodic",
    path: "/competitive/doria-watch.md",
    content:
      "# Doria competitive watch\n\nDoria has been the most aggressive competitor in Crackers since Q3 2025. Promo pressure consistently 6-8 pts above category. Worth a standing slide in any Snack Salati narrative until promo intensity normalizes.",
  },
];

async function insertMemoryEntries() {
  console.log(`Inserting ${MEMORIES.length} memory entries...`);
  const rows = MEMORIES.map((m) => ({
    organization_id: ORG_ID,
    is_team_beta: true,
    scope: m.scope,
    memory_type: m.memory_type,
    path: m.path,
    content: m.content,
    metadata: { seed: SEED_TAG },
  }));
  const { error } = await db.from("memory_entries").insert(rows);
  if (error) throw new Error(`Memory insert failed: ${error.message}`);
}

type DeliverableSeed = {
  daysAgo: number;
  scope: string;
  prompt: string;
  title: string;
  status: "ready" | "failed" | "generating";
  body?: string;
  citations?: Array<{ label: string; source_type: string; doc: string; excerpt: string }>;
  errorMessage?: string;
};

const DELIVERABLES: DeliverableSeed[] = [
  {
    daysAgo: 78,
    scope: "client:Mulino Bianco",
    prompt: "Summarize the Q4 2025 review for Mulino Bianco Crackers in 5 bullets I can paste into Slack.",
    title: "Q4 2025 Crackers, 5 bullets for Slack",
    status: "ready",
    body:
      `**Mulino Bianco Crackers Q4 2025 in 5 bullets**\n\n` +
      `- Value share landed at 18.4%, down 1.2 pts vs Q4 2024 [s1].\n` +
      `- Private label gained 2.1 pts in the same window, the structural driver of our decline [s1].\n` +
      `- Conad numeric distribution holds at 88, Esselunga at 76 (gap of 12 pts vs Coop Italia) [s1].\n` +
      `- Doria is the most aggressive competitor: Rate of Sale +14% YoY in Conad, promo pressure 31% vs category 24% [s2].\n` +
      `- Recommendation for Q1: invest in Crackers Aromatizzati at Conad as the defence narrative.`,
    citations: [
      { label: "s1", source_type: "document", doc: "Q4-2025-deck-final.pptx", excerpt: "Mulino Bianco Crackers value share at 18.4% (-1.2 pts vs Q4 2024). Private label up 2.1 pts. Conad numeric distribution at 88, weighted 92." },
      { label: "s2", source_type: "document", doc: "competitive-deep-dive-doria-pavesi.pdf", excerpt: "Doria Crackers: Rate of Sale +14% YoY in Conad. Promo pressure 31% (vs category 24%)." },
    ],
  },
  {
    daysAgo: 64,
    scope: "client:Mulino Bianco",
    prompt: "Draft the Q1 narrative I can take to Elena.",
    title: "Q1 2026 narrative for Elena",
    status: "ready",
    body:
      `**Q1 2026 narrative for Mulino Bianco Snack Salati**\n\n` +
      `Defend Crackers Aromatizzati as the value-share anchor at Conad while we hold core Crackers steady against private label.\n\n` +
      `**Diagnosis**\n` +
      `- Mulino Bianco Crackers value share is 18.4%, down 1.2 pts YoY [s1].\n` +
      `- Private label captured 2.1 pts in the same window [s1].\n` +
      `- Doria is structurally over-promoting in Conad (31% pressure vs category 24%) [s2].\n\n` +
      `**Move**\n` +
      `- Reallocate 30% of core Crackers promo budget into Crackers Aromatizzati listings at Conad.\n` +
      `- Pursue a Carrefour Italia distribution rebuild on top 3 SKUs (current ND 67) [s3].\n` +
      `- Open a single-serve Aromatizzati pack with Conad for Q2.\n\n` +
      `**Measure**\n` +
      `- Weekly Aromatizzati ROS at Conad.\n` +
      `- Monthly value share check vs private label in Crackers.\n` +
      `- Carrefour Italia ND target: 78 by end of Q2.`,
    citations: [
      { label: "s1", source_type: "document", doc: "Q4-2025-deck-final.pptx", excerpt: "Mulino Bianco Crackers value share at 18.4% (-1.2 pts vs Q4 2024). Private label up 2.1 pts." },
      { label: "s2", source_type: "document", doc: "competitive-deep-dive-doria-pavesi.pdf", excerpt: "Doria Crackers: Rate of Sale +14% YoY in Conad. Promo pressure 31% (vs category 24%)." },
      { label: "s3", source_type: "document", doc: "carrefour-italy-distribution-gap.pdf", excerpt: "Mulino Bianco Crackers Numeric Distribution at Carrefour Italia: 67 (vs Coop Italia 91, Conad 88, Esselunga 76)." },
    ],
  },
  {
    daysAgo: 38,
    scope: "category:Snack Salati",
    prompt: "Build a one-pager on Doria's promotional intensity for the buyer meeting.",
    title: "Doria promotional intensity one-pager",
    status: "ready",
    body:
      `**Doria promotional intensity in Crackers, buyer pre-read**\n\n` +
      `Doria is running 7 points above category promo pressure in Conad, sustained for two consecutive quarters [s1].\n\n` +
      `- Doria promo pressure: 31% [s1].\n` +
      `- Snack Salati category promo pressure baseline: 24% [s1].\n` +
      `- Doria Rate of Sale: +14% YoY in Conad [s1].\n\n` +
      `Implication for the buyer conversation: ask for a Doria promo audit before agreeing to any Mulino Bianco price concession on core Crackers.`,
    citations: [
      { label: "s1", source_type: "document", doc: "competitive-deep-dive-doria-pavesi.pdf", excerpt: "Doria Crackers: Rate of Sale +14% YoY in Conad. Promo pressure 31% (vs category 24%)." },
    ],
  },
  {
    daysAgo: 19,
    scope: "client:Mulino Bianco",
    prompt: "Draft the email to Luca Moretti at Esselunga about the Crackers listing review.",
    title: "Email to Luca Moretti: Crackers listing review",
    status: "ready",
    body:
      `Ciao Luca,\n\n` +
      `Ahead of our Q1 listing review, sharing two data points that justify revisiting our Crackers slot allocation.\n\n` +
      `1. Mulino Bianco Crackers Numeric Distribution at Esselunga is currently 76, vs Coop Italia at 91 and Conad at 88 [s1]. Closing half of that gap (4 SKUs) lifts category sales for the chain by an estimated 1.2 pts in 12 weeks.\n\n` +
      `2. Crackers Aromatizzati is our investment priority for Q1 with Conad. We can hold one Aromatizzati slot at Esselunga from Q2 if you want to test single-serve.\n\n` +
      `Happy to walk through the data live whenever works. Talk soon.\n\n` +
      `Marco`,
    citations: [
      { label: "s1", source_type: "document", doc: "carrefour-italy-distribution-gap.pdf", excerpt: "Mulino Bianco Crackers Numeric Distribution at Carrefour Italia: 67 (vs Coop Italia 91, Conad 88, Esselunga 76)." },
    ],
  },
  {
    daysAgo: 8,
    scope: "client:Mulino Bianco",
    prompt: "What did Elena ask for in the latest follow-up?",
    title: "Elena's latest ask",
    status: "ready",
    body:
      `Elena wants three things ahead of the Q1 review (in 8 days from her note) [s1]:\n\n` +
      `1. A single chart explaining Crackers Aromatizzati momentum vs core Crackers.\n` +
      `2. Promo Pressure differential vs Doria flagged explicitly.\n` +
      `3. Sara Conti from NielsenIQ Italy to be in the room for the readout.`,
    citations: [
      { label: "s1", source_type: "document", doc: "elena-followup-2026-04-09.txt", excerpt: "Elena Bianchi: Q1 review is in 8 days. I want a single chart that explains Crackers Aromatizzati momentum vs core Crackers." },
    ],
  },
  {
    daysAgo: 5,
    scope: "workspace",
    prompt: "What stakeholders should I copy on the Q1 readout invite?",
    title: "Q1 readout invite list",
    status: "ready",
    body:
      `Based on the workspace stakeholder map and the Q1 prep notes [s1] [s2]:\n\n` +
      `- Elena Bianchi (Head of Category, Mulino Bianco): meeting owner.\n` +
      `- Sara Conti (Senior Insights Manager, NielsenIQ Italy): Elena explicitly asked for her presence.\n` +
      `- Giovanni Rossi (Marketing Director, Conad): only if the agenda includes the co-branded Aromatizzati SKU discussion.\n\n` +
      `Skip Luca Moretti (Esselunga) for this session: his listing review is on a separate track.`,
    citations: [
      { label: "s1", source_type: "document", doc: "elena-followup-2026-04-09.txt", excerpt: "Elena Bianchi: Q1 review is in 8 days. Sara Conti will join the readout." },
      { label: "s2", source_type: "document", doc: "Q1-2026-snack-salati-brief.pdf", excerpt: "Brief from Elena to align on Q1 2026 narrative for Snack Salati. Priority retailer: Conad." },
    ],
  },
  {
    daysAgo: 2,
    scope: "client:Mulino Bianco",
    prompt: "Generate the Carrefour distribution memo for tomorrow's pre-read.",
    title: "Carrefour Italia distribution memo (failed run)",
    status: "failed",
    errorMessage: "Anthropic call returned 529 Overloaded. Retry the same prompt to regenerate against the current workspace.",
  },
  {
    daysAgo: 0,
    scope: "client:Mulino Bianco",
    prompt: "Build the deck outline for Elena's Q1 review.",
    title: "Q1 review deck outline (in progress)",
    status: "generating",
  },
];

async function insertDeliverables(userId: string, docIds: Map<string, string>) {
  console.log(`Inserting ${DELIVERABLES.length} deliverables...`);
  for (const d of DELIVERABLES) {
    const created_at = day(d.daysAgo);
    const citations = (d.citations ?? []).map((c) => {
      const docId = docIds.get(c.doc);
      if (!docId) throw new Error(`Citation references unknown doc ${c.doc}`);
      return {
        label: c.label,
        source_type: c.source_type,
        source_id: docId,
        filename: c.doc,
        excerpt: c.excerpt,
      };
    });
    const { error } = await db.from("workspace_deliverables").insert({
      organization_id: ORG_ID,
      is_team_beta: true,
      created_by: userId,
      kind: "answer",
      title: d.title,
      prompt: d.prompt,
      scope: d.scope,
      status: d.status,
      body_markdown: d.body ?? null,
      citations,
      metadata: { seed: SEED_TAG, user_email: TARGET_EMAIL },
      error_message: d.errorMessage ?? null,
      created_at,
      updated_at: created_at,
    });
    if (error) throw new Error(`Deliverable insert failed: ${error.message}`);
  }
}

async function main() {
  console.log(`Seeding workspace for ${TARGET_EMAIL} (org ${ORG_ID})`);
  const userId = await findUserId();
  console.log(`Found user ${userId}`);
  await wipe();
  const entityIds = await insertEntities();
  const docIds = await insertDocumentsAndChunks(userId);
  await insertMentionsAndFacts(entityIds, docIds);
  await insertMemoryEntries();
  await insertDeliverables(userId, docIds);
  console.log("\nSeed complete.");
  console.log(`Entities: ${entityIds.size}`);
  console.log(`Documents: ${docIds.size}`);
  console.log(`Mentions: ${MENTIONS.length}`);
  console.log(`Facts: ${FACTS.length}`);
  console.log(`Memory entries: ${MEMORIES.length}`);
  console.log(`Deliverables: ${DELIVERABLES.length}`);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
