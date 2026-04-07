import dotenv from "dotenv";
dotenv.config({ override: true });
import { z } from "zod";

const trimmedString = () =>
  z.string().transform((value) => value.trim()).pipe(z.string().min(1));

const trimmedOptionalString = () =>
  z.string().transform((value) => value.trim()).pipe(z.string().min(1)).optional();

const envSchema = z.object({
  // Discord
  DISCORD_BOT_TOKEN: trimmedString(),
  DISCORD_GUILD_ID: trimmedString(),
  DISCORD_VOICE_CHANNEL_ID: trimmedString(),
  DISCORD_BOT_CHANNEL_ID: trimmedString(),
  DISCORD_GENERAL_CHANNEL_ID: trimmedString(),
  DISCORD_LIVECHAT_CHANNEL_ID: trimmedOptionalString(),

  // Deepgram
  DEEPGRAM_API_KEY: trimmedString(),

  // Anthropic
  ANTHROPIC_API_KEY: trimmedString(),

  // Linear
  LINEAR_API_KEY: trimmedString(),
  LINEAR_TEAM_ID: trimmedString(),
  INTERCOM_ACCESS_TOKEN: trimmedOptionalString(),
  INTERCOM_ADMIN_ID: trimmedOptionalString(),
  INTERCOM_API_BASE_URL: z.string().transform((value) => value.trim()).pipe(z.string().url()).default("https://api.intercom.io"),

  // Supabase
  SUPABASE_URL: z.string().transform((value) => value.trim()).pipe(z.string().url()),
  SUPABASE_SERVICE_ROLE_KEY: trimmedString(),

  // OpenAI (embeddings)
  OPENAI_API_KEY: trimmedString(),

  // Knowledge Base
  DISCORD_DOCS_CHANNEL_ID: trimmedString(),

  // Optional
  WHISPER_API_KEY: z.string().transform((value) => value.trim()).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    console.error("❌ Missing or invalid environment variables:\n" + missing.join("\n"));
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();

// Team member mapping: Discord display name → Linear/role info
// linearDisplayName must match the actual Linear username exactly
export const TEAM_MEMBERS: Record<
  string,
  { role: string; linearDisplayName: string; aliases: string[] }
> = {
  marco: { role: "cto", linearDisplayName: "marco.dicesare", aliases: ["marco", "marco.dicesare", "marco di cesare"] },
  veronica: { role: "head_of_product_intelligence", linearDisplayName: "veronica", aliases: ["veronica"] },
  fra: { role: "cfo", linearDisplayName: "francesco", aliases: ["fra", "francesco", "francesco lama"] },
  francesco: { role: "cfo", linearDisplayName: "francesco", aliases: ["fra", "francesco"] },
  rossella: { role: "cpo", linearDisplayName: "rossella", aliases: ["rossella"] },
  ale: { role: "cro", linearDisplayName: "alessandro", aliases: ["ale", "alessandro", "alessandro salerni"] },
  alessandro: { role: "cro", linearDisplayName: "alessandro", aliases: ["ale", "alessandro"] },
  giulia: { role: "cmo", linearDisplayName: "giulia", aliases: ["giulia"] },
};

// Auto-assignment rules based on content category
export const ASSIGNMENT_RULES: Record<string, string[]> = {
  bug: ["Marco"],
  feature: ["Marco"],
  improvement: ["Marco"],
  feedback: ["Marco", "Rossella"],
  finance: ["Fra"],
  marketing: ["Giulia"],
  "bug-report-livechat": ["Marco"],
  "feature-request-livechat": ["Veronica"],
  "sales-signal-livechat": ["Ale"],
};

// Session timing
export const VOICE_EMPTY_TIMEOUT_MS = 30 * 1000; // 30s empty → end session
export const TEXT_INACTIVITY_MS = 5 * 60 * 1000; // 5 min silence after last message → end session
export const TEXT_MAX_SESSION_MS = 60 * 60 * 1000; // 1 hour hard cap (safety net for never-ending chats)
export const LIVECHAT_INACTIVITY_MS = 10 * 60 * 1000; // 10 min silence after last message → end thread session
export const AUDIO_CHUNK_DURATION_MS = 5 * 60 * 1000; // 5 min audio chunks
export const LONG_SESSION_SEGMENT_MS = 3 * 60 * 60 * 1000; // 3 hour segments

// Easter eggs — set to false to disable all
export const EASTER_EGGS_ENABLED = true;

// Ale gets Japanese-only responses from @Basquio Bot
export const ALE_DISCORD_ID = "1483207572176638194";
