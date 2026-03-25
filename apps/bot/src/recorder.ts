import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  EndBehaviorType,
} from "@discordjs/voice";
import { PermissionFlagsBits, type VoiceBasedChannel } from "discord.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus") as typeof import("@discordjs/opus");
import { spawn } from "node:child_process";
import { uploadAudio } from "./supabase.js";

interface UserStream {
  userId: string;
  chunks: Buffer[];
  startedAt: Date;
  chunkIndex: number;
}

const activeStreams = new Map<string, UserStream>();
let connection: VoiceConnection | null = null;
let sessionAudioPaths: string[] = [];

/**
 * Check and log the bot's permissions in the voice channel.
 */
function checkPermissions(channel: VoiceBasedChannel): boolean {
  const me = channel.guild.members.me;
  if (!me) {
    console.error("❌ Cannot resolve bot's own guild member");
    return false;
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    console.error("❌ Cannot resolve permissions for voice channel");
    return false;
  }

  const required = [
    { flag: PermissionFlagsBits.Connect, name: "Connect" },
    { flag: PermissionFlagsBits.Speak, name: "Speak" },
    { flag: PermissionFlagsBits.UseVAD, name: "UseVAD" },
  ] as const;

  let allGood = true;
  for (const { flag, name } of required) {
    const has = perms.has(flag);
    console.log(`  ${has ? "✅" : "❌"} ${name}`);
    if (!has) allGood = false;
  }

  // Also log some useful info
  console.log(`  Channel type: ${channel.type} (2=voice, 13=stage)`);
  console.log(`  Channel members: ${channel.members.map((m) => `${m.displayName}${m.user.bot ? " [BOT]" : ""}`).join(", ")}`);

  return allGood;
}

/**
 * Join a voice channel and start recording all participants.
 */
export async function startRecording(channel: VoiceBasedChannel): Promise<void> {
  sessionAudioPaths = [];

  // Check permissions first
  console.log(`🔑 Checking bot permissions in #${channel.name}:`);
  const hasPerms = checkPermissions(channel);
  if (!hasPerms) {
    throw new Error("Bot missing required voice channel permissions");
  }

  // Retry up to 3 times — UDP can fail transiently on containerized hosts
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    connection.on("stateChange", (oldState, newState) => {
      console.log(`🔌 Voice connection: ${oldState.status} → ${newState.status}`);
    });

    connection.on("error", (err) => {
      console.error("🔌 Voice connection error:", err);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      console.log(`✅ Voice connection ready (attempt ${attempt}/${MAX_RETRIES})`);
      break; // success
    } catch (err) {
      console.error(`❌ Voice connection attempt ${attempt}/${MAX_RETRIES} failed:`, err);
      try { connection?.destroy(); } catch { /* already destroyed */ }
      connection = null;
      if (attempt === MAX_RETRIES) {
        throw new Error(`Voice connection timed out after ${MAX_RETRIES} attempts`);
      }
      // Brief pause before retry
      await new Promise((r) => setTimeout(r, 2_000));
      console.log(`🔄 Retrying voice connection (attempt ${attempt + 1}/${MAX_RETRIES})...`);
    }
  }

  // Handle disconnects with reconnection
  connection.on(VoiceConnectionStatus.Disconnected, async (_oldState, newState) => {
    console.log("⚠️ Voice disconnected, reason:", (newState as unknown as { reason?: number }).reason);
    if (!connection) return;
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log("🔄 Auto-reconnect succeeded");
    } catch {
      console.error("❌ Auto-reconnect failed, destroying connection");
      await flushAllStreams();
      try { connection?.destroy(); } catch { /* already destroyed */ }
      connection = null;
    }
  });

  // Subscribe to each user that speaks
  const receiver = connection.receiver;

  console.log("🔊 Listening for speaking events...");

  // Log all speaking map events
  receiver.speaking.on("start", (userId) => {
    if (activeStreams.has(userId)) return;

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
    });

    const userStream: UserStream = {
      userId,
      chunks: [],
      startedAt: new Date(),
      chunkIndex: 0,
    };
    activeStreams.set(userId, userStream);

    // Collect raw opus packets as buffers
    opusStream.on("data", (chunk: Buffer) => {
      userStream.chunks.push(chunk);
    });

    opusStream.on("end", async () => {
      // User stopped speaking — flush their audio
      activeStreams.delete(userId);
      if (userStream.chunks.length > 0) {
        await processUserAudio(userStream);
      }
    });

    opusStream.on("error", (err) => {
      console.error(`Audio stream error for user ${userId}:`, err);
      activeStreams.delete(userId);
    });
  });

  console.log(`🎙️ Recording started in #${channel.name}`);
}

/**
 * Convert collected opus packets to MP3 via FFmpeg and upload to Supabase.
 */
async function processUserAudio(userStream: UserStream): Promise<void> {
  const { userId, chunks, startedAt, chunkIndex } = userStream;

  // Decode opus to PCM using @discordjs/opus
  const encoder = new OpusEncoder(48000, 2);
  const pcmBuffers: Buffer[] = [];
  for (const opusPacket of chunks) {
    try {
      const decoded = encoder.decode(opusPacket);
      pcmBuffers.push(decoded);
    } catch {
      // Skip corrupted packets
    }
  }

  if (pcmBuffers.length === 0) return;

  const pcmData = Buffer.concat(pcmBuffers);

  // Pipe PCM through FFmpeg to get MP3
  const mp3Buffer = await pcmToMp3(pcmData);
  if (!mp3Buffer || mp3Buffer.length === 0) return;

  // Upload to Supabase Storage
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const path = `sessions/${timestamp}/user-${userId}-chunk-${chunkIndex}.mp3`;

  try {
    await uploadAudio(mp3Buffer, path);
    sessionAudioPaths.push(path);
    console.log(`📁 Uploaded audio: ${path} (${(mp3Buffer.length / 1024).toFixed(1)}KB)`);
  } catch (err) {
    console.error(`Failed to upload audio for user ${userId}:`, err);
  }
}

/**
 * Convert raw PCM (48kHz, 16-bit, stereo) to MP3 using FFmpeg.
 */
function pcmToMp3(pcmBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-i",
      "pipe:0",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ]);

    const outputChunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    ffmpeg.stderr.on("data", () => {}); // Suppress FFmpeg stderr

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(outputChunks));
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);
    ffmpeg.stdin.on("error", reject);

    ffmpeg.stdin.write(pcmBuffer);
    ffmpeg.stdin.end();
  });
}

/**
 * Flush all active user streams (called on session end or disconnect).
 */
async function flushAllStreams(): Promise<void> {
  const flushPromises = Array.from(activeStreams.values()).map((stream) =>
    processUserAudio(stream),
  );
  activeStreams.clear();
  await Promise.allSettled(flushPromises);
}

/**
 * Stop recording, flush audio, leave channel.
 * Returns paths of all uploaded audio chunks.
 */
export async function stopRecording(): Promise<string[]> {
  await flushAllStreams();

  if (connection) {
    connection.destroy();
    connection = null;
  }

  const paths = [...sessionAudioPaths];
  sessionAudioPaths = [];
  console.log(`🛑 Recording stopped. ${paths.length} chunks saved.`);
  return paths;
}

/**
 * Check if the bot is currently in a voice channel.
 */
export function isRecording(): boolean {
  return connection !== null;
}
