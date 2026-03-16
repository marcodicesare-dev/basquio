import {
  Client,
  GatewayIntentBits,
  Events,
  type VoiceState,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import { env, TEAM_MEMBERS } from "./config.js";
import { initChannels, postRecordingWarning, postWeeklyDigest } from "./discord.js";
import { handleVoiceJoin, handleVoiceLeave, hasActiveSession } from "./session.js";
import { handleTextMessage, handleReaction } from "./text-handler.js";
import { ensureLabels } from "./linear.js";
import { handleDocsMessage } from "./ingestor.js";
import { handleBotMention } from "./searcher.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// ── Startup ────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Basquio Bot online as ${c.user.tag}`);

  await initChannels(client);
  await ensureLabels();

  // Schedule weekly digest — Monday 9:00 CET
  scheduleWeeklyDigest();
});

// ── Voice State Updates ────────────────────────────────────────────

client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const targetChannelId = env.DISCORD_VOICE_CHANNEL_ID;

  // Someone joined The Office
  if (newState.channelId === targetChannelId && oldState.channelId !== targetChannelId) {
    const channel = newState.channel;
    if (!channel) return;

    // Check if this is a known team member
    const name = member.displayName.toLowerCase();
    const isTeamMember = Object.keys(TEAM_MEMBERS).some(
      (k) => name.includes(k),
    );

    if (!isTeamMember) {
      await postRecordingWarning(member.displayName);
    }

    await handleVoiceJoin(channel, member);
  }

  // Someone left The Office
  if (oldState.channelId === targetChannelId && newState.channelId !== targetChannelId) {
    const channel = oldState.channel;
    if (!channel) return;
    handleVoiceLeave(channel, member);
  }
});

// ── Text Messages ──────────────────────────────────────────────────

client.on(Events.MessageCreate, (message: Message) => {
  if (message.author.bot) return;

  // #docs channel — file ingestion
  if (message.channelId === env.DISCORD_DOCS_CHANNEL_ID) {
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        handleDocsMessage(message, attachment).catch((err) => {
          console.error(`Ingestion failed for ${attachment.name}:`, err);
        });
      }
    }
    return;
  }

  // @mention — knowledge base search (any channel)
  if (message.mentions.has(client.user!.id)) {
    const query = message.content
      .replace(/<@!?\d+>/g, "") // strip mention
      .trim();
    if (query.length > 3) {
      handleBotMention(message, query).catch((err) => {
        console.error("Search failed:", err);
      });
    }
    return;
  }

  // #general — text message buffering (existing)
  if (message.channelId !== env.DISCORD_GENERAL_CHANNEL_ID) return;
  handleTextMessage(message);
});

// ── Emoji Reactions ────────────────────────────────────────────────

client.on(
  Events.MessageReactionAdd,
  async (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) => {
    if (user.bot) return;

    const channelId = reaction.message.channelId;
    const emoji = reaction.emoji.name;

    // 📚 and 🔍 work in ANY channel (knowledge base shortcuts)
    // Other reactions (⚡🐛💡🏢) only in #general and #basquio-ai
    const isKbEmoji = emoji === "📚" || emoji === "🔍";
    if (
      !isKbEmoji &&
      channelId !== env.DISCORD_GENERAL_CHANNEL_ID &&
      channelId !== env.DISCORD_BOT_CHANNEL_ID
    ) {
      return;
    }

    // Fetch full user if partial
    const fullUser = user.partial ? await user.fetch() : user;
    await handleReaction(reaction, fullUser);
  },
);

// ── Weekly Digest Scheduler ────────────────────────────────────────

function scheduleWeeklyDigest(): void {
  const now = new Date();
  const nextMonday = getNextMonday9amCET();
  const msUntilNext = nextMonday.getTime() - now.getTime();

  console.log(
    `📅 Next weekly digest: ${nextMonday.toISOString()} (in ${Math.round(msUntilNext / 3600000)}h)`,
  );

  setTimeout(async () => {
    await postWeeklyDigest();
    // Reschedule for next week
    setInterval(() => postWeeklyDigest(), 7 * 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

function getNextMonday9amCET(): Date {
  const now = new Date();
  // CET = UTC+1 (ignoring DST for simplicity — CET/CEST handled by offset)
  const cetOffset = 1;
  const utcHour = 9 - cetOffset; // 9 CET = 8 UTC

  const next = new Date(now);
  next.setUTCHours(utcHour, 0, 0, 0);

  // Find next Monday
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);

  // If it's already past, add a week
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 7);
  }

  return next;
}

// ── Graceful Shutdown ──────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

  if (hasActiveSession()) {
    console.log("⏳ Waiting for active session to flush...");
    // Import dynamically to avoid circular deps
    const { stopRecording } = await import("./recorder.js");
    await stopRecording();
  }

  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Catch all unhandled errors so the bot doesn't silently die
process.on("unhandledRejection", (err) => {
  console.error("‼️ Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("‼️ Uncaught exception:", err);
});

// ── Login ──────────────────────────────────────────────────────────

client.login(env.DISCORD_BOT_TOKEN);
