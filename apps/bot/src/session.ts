import type { VoiceBasedChannel, GuildMember } from "discord.js";
import { startRecording, stopRecording } from "./recorder.js";
import { transcribeChunks } from "./transcriber.js";
import { extractFromTranscript } from "./extractor.js";
import { createIssues } from "./linear.js";
import { saveTranscript, upsertLead, saveDecisions } from "./supabase.js";
import { postSessionSummary } from "./discord.js";
import { env, VOICE_EMPTY_TIMEOUT_MS, LONG_SESSION_SEGMENT_MS } from "./config.js";

interface VoiceSession {
  startedAt: Date;
  participants: Set<string>;
  emptyTimer: ReturnType<typeof setTimeout> | null;
  segmentTimer: ReturnType<typeof setTimeout> | null;
}

let currentSession: VoiceSession | null = null;

/**
 * Called when someone joins the voice channel.
 */
export async function handleVoiceJoin(
  channel: VoiceBasedChannel,
  member: GuildMember,
): Promise<void> {
  const displayName = member.displayName;

  if (!currentSession) {
    // Start new session
    currentSession = {
      startedAt: new Date(),
      participants: new Set([displayName]),
      emptyTimer: null,
      segmentTimer: null,
    };

    try {
      await startRecording(channel);
      console.log(`🟢 Session started by ${displayName}`);

      // Set up long-session segmenting
      currentSession.segmentTimer = setTimeout(
        () => processInterimSegment(),
        LONG_SESSION_SEGMENT_MS,
      );
    } catch (err) {
      console.error("Failed to start recording:", err);
      currentSession = null;
    }
  } else {
    // Existing session — add participant, cancel empty timer
    currentSession.participants.add(displayName);
    if (currentSession.emptyTimer) {
      clearTimeout(currentSession.emptyTimer);
      currentSession.emptyTimer = null;
    }
  }
}

/**
 * Called when someone leaves the voice channel.
 */
export function handleVoiceLeave(
  channel: VoiceBasedChannel,
  member: GuildMember,
): void {
  if (!currentSession) return;

  // Check if channel is now empty (excluding the bot)
  const humanMembers = channel.members.filter((m) => !m.user.bot);

  if (humanMembers.size === 0) {
    // Start empty timer
    currentSession.emptyTimer = setTimeout(
      () => endSession(),
      VOICE_EMPTY_TIMEOUT_MS,
    );
    console.log(
      `⏳ Channel empty. Session will end in ${VOICE_EMPTY_TIMEOUT_MS / 1000}s if no one rejoins.`,
    );
  }
}

/**
 * End the current voice session and run the full pipeline.
 */
async function endSession(): Promise<void> {
  if (!currentSession) return;

  const session = currentSession;
  currentSession = null;

  // Clear segment timer
  if (session.segmentTimer) clearTimeout(session.segmentTimer);

  console.log("🔄 Session ending — processing pipeline...");

  try {
    // 1. Stop recording and get audio chunk paths
    const audioPaths = await stopRecording();
    const endedAt = new Date();
    const participants = Array.from(session.participants);
    const duration = formatDuration(endedAt.getTime() - session.startedAt.getTime());

    if (audioPaths.length === 0) {
      console.log("⚠️ No audio captured, skipping processing.");
      return;
    }

    // Determine if this is a voice memo (solo, short)
    const isVoiceMemo =
      participants.length === 1 &&
      endedAt.getTime() - session.startedAt.getTime() < 5 * 60 * 1000;

    // 2. Transcribe (download from Supabase Storage if needed, or use local buffers)
    // For now, we'll mark the path — full transcription happens via the audio chunks
    // that were uploaded during recording. We need to download them back for transcription.
    const transcript = await transcribeSessionAudio(audioPaths);

    if (!transcript.fullText.trim()) {
      console.log("⚠️ Empty transcript, skipping processing.");
      return;
    }

    // 3. Extract structured data
    const extraction = await extractFromTranscript(transcript.fullText, "voice");

    // 4. Route everything in parallel
    const transcriptUrl = `${env.SUPABASE_URL}/storage/v1/object/voice-recordings/${audioPaths[0] ?? ""}`;

    // Save transcript first — this must succeed
    const transcriptId = await saveTranscript({
      sessionType: "voice",
      startedAt: session.startedAt,
      endedAt,
      participants,
      rawTranscript: transcript.fullText,
      extraction,
      audioStoragePath: audioPaths[0],
    });

    // Create issues separately — failures here shouldn't kill the pipeline
    let issues: Awaited<ReturnType<typeof createIssues>> = [];
    try {
      issues = await createIssues(extraction.action_items, transcriptUrl, "voice");
    } catch (err) {
      console.error("⚠️ Issue creation failed (continuing pipeline):", err);
    }

    // Save decisions
    await saveDecisions(extraction.decisions, transcriptId);

    // Upsert CRM leads
    const crmUpdates: string[] = [];
    for (const mention of extraction.sales_mentions) {
      await upsertLead(mention, transcriptId);
      crmUpdates.push(`${mention.company} — ${mention.status}`);
    }

    // 5. Post summary to Discord
    const messageId = await postSessionSummary({
      sessionType: "voice",
      duration: isVoiceMemo ? `Voice memo (${duration})` : duration,
      participants,
      extraction,
      issues,
      transcriptUrl,
      crmUpdates,
    });

    // Update transcript with Discord message ID
    if (messageId) {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      await db
        .from("transcripts")
        .update({ discord_message_id: messageId })
        .eq("id", transcriptId);
    }

    console.log(
      `✅ Session processed: ${participants.join(", ")} | ${duration} | ${issues.length} issues | ${extraction.decisions.length} decisions`,
    );
  } catch (err) {
    console.error("❌ Session processing failed:", err);
  }
}

/**
 * Process an interim segment for very long sessions (3+ hours).
 */
async function processInterimSegment(): Promise<void> {
  if (!currentSession) return;
  console.log("📋 Processing interim segment for long session...");
  // For now, just reset the timer. Full implementation would:
  // 1. Flush current audio chunks
  // 2. Transcribe and extract
  // 3. Post interim summary
  // 4. Continue recording
  currentSession.segmentTimer = setTimeout(
    () => processInterimSegment(),
    LONG_SESSION_SEGMENT_MS,
  );
}

/**
 * Download audio chunks from Supabase Storage and transcribe them.
 */
async function transcribeSessionAudio(
  paths: string[],
): Promise<{ fullText: string; durationSeconds: number }> {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const chunks: Buffer[] = [];
  for (const path of paths) {
    const { data, error } = await db.storage.from("voice-recordings").download(path);
    if (error || !data) {
      console.error(`Failed to download audio chunk ${path}:`, error);
      continue;
    }
    const arrayBuffer = await data.arrayBuffer();
    chunks.push(Buffer.from(arrayBuffer));
  }

  if (chunks.length === 0) {
    return { fullText: "", durationSeconds: 0 };
  }

  const result = await transcribeChunks(chunks);
  return { fullText: result.fullText, durationSeconds: result.durationSeconds };
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Check if there's an active session.
 */
export function hasActiveSession(): boolean {
  return currentSession !== null;
}
