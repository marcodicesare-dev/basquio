import dotenv from "dotenv";
dotenv.config({ override: true });
import { z } from "zod";

const envSchema = z.object({
  // Discord
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_VOICE_CHANNEL_ID: z.string().min(1),
  DISCORD_BOT_CHANNEL_ID: z.string().min(1),
  DISCORD_GENERAL_CHANNEL_ID: z.string().min(1),

  // Deepgram
  DEEPGRAM_API_KEY: z.string().min(1),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Linear
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_TEAM_ID: z.string().min(1),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // OpenAI (embeddings)
  OPENAI_API_KEY: z.string().min(1),

  // Knowledge Base
  DISCORD_DOCS_CHANNEL_ID: z.string().min(1),

  // Optional
  WHISPER_API_KEY: z.string().optional(),
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
};

// Session timing
export const VOICE_EMPTY_TIMEOUT_MS = 30 * 1000; // 30s empty → end session
export const TEXT_INACTIVITY_MS = 5 * 60 * 1000; // 5 min silence after last message → end session
export const TEXT_MAX_SESSION_MS = 60 * 60 * 1000; // 1 hour hard cap (safety net for never-ending chats)
export const AUDIO_CHUNK_DURATION_MS = 5 * 60 * 1000; // 5 min audio chunks
export const LONG_SESSION_SEGMENT_MS = 3 * 60 * 60 * 1000; // 3 hour segments

// Easter eggs — set to false to disable all
export const EASTER_EGGS_ENABLED = true;

// Ale gets Japanese-only responses from @Basquio Bot
export const ALE_DISCORD_ID = "1483207572176638194";
