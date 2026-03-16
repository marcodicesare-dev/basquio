import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  EndBehaviorType,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
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
 * Join a voice channel and start recording all participants.
 */
export async function startRecording(channel: VoiceBasedChannel): Promise<void> {
  sessionAudioPaths = [];

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
    // DAVE E2EE breaks audio receiving in @discordjs/voice 0.19.x
    // Disable until upstream fix lands (discord.js#11419)
    daveEncryption: false,
  } as Parameters<typeof joinVoiceChannel>[0] & { daveEncryption: boolean });

  // Wait for connection to be ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    connection = null;
    throw new Error("Voice connection timed out");
  }

  // Handle disconnects with reconnection
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (!connection) return;
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Auto-reconnect succeeded
    } catch {
      // Auto-reconnect failed — save what we have and destroy
      await flushAllStreams();
      connection.destroy();
      connection = null;
    }
  });

  // Subscribe to each user that speaks
  const receiver = connection.receiver;

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
