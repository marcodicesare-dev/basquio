import { DeepgramClient } from "@deepgram/sdk";
import { env } from "./config.js";

let deepgram: DeepgramClient;

function getDeepgram(): DeepgramClient {
  if (!deepgram) {
    deepgram = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });
  }
  return deepgram;
}

export interface TranscriptSegment {
  speaker: string; // "Speaker 0", "Speaker 1", etc. or username if known
  text: string;
  start: number; // seconds
  end: number; // seconds
}

export interface TranscriptionResult {
  fullText: string;
  segments: TranscriptSegment[];
  durationSeconds: number;
}

/**
 * Transcribe an MP3 buffer using Deepgram's pre-recorded API (nova-3).
 * Uses SDK v5 API: listen.v1.media.transcribeFile()
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType = "audio/mpeg",
): Promise<TranscriptionResult> {
  const dg = getDeepgram();

  // SDK v5: pass buffer with content type metadata
  const uploadable = { data: audioBuffer, contentType: mimeType };

  const response = await dg.listen.v1.media.transcribeFile(uploadable, {
    model: "nova-3",
    diarize: true,
    smart_format: true,
    punctuate: true,
    detect_language: true, // Team speaks Italian + English
  });

  const alternative = response?.results?.channels?.[0]?.alternatives?.[0];
  if (!alternative) {
    return { fullText: "", segments: [], durationSeconds: 0 };
  }

  // Build segments from word-level diarization
  const segments: TranscriptSegment[] = [];
  let currentSpeaker = -1;
  let currentText = "";
  let segStart = 0;
  let segEnd = 0;

  for (const word of alternative.words ?? []) {
    if (word.speaker !== currentSpeaker) {
      // Save previous segment
      if (currentText.trim()) {
        segments.push({
          speaker: `Speaker ${currentSpeaker}`,
          text: currentText.trim(),
          start: segStart,
          end: segEnd,
        });
      }
      currentSpeaker = word.speaker ?? 0;
      currentText = word.punctuated_word ?? word.word;
      segStart = word.start;
      segEnd = word.end;
    } else {
      currentText += " " + (word.punctuated_word ?? word.word);
      segEnd = word.end;
    }
  }

  // Final segment
  if (currentText.trim()) {
    segments.push({
      speaker: `Speaker ${currentSpeaker}`,
      text: currentText.trim(),
      start: segStart,
      end: segEnd,
    });
  }

  const durationSeconds =
    response?.results?.channels?.[0]?.alternatives?.[0]?.words?.at(-1)?.end ?? 0;

  // Build full text with speaker labels
  const fullText = segments.map((s) => `[${s.speaker}]: ${s.text}`).join("\n");

  return { fullText, segments, durationSeconds };
}

/**
 * Transcribe multiple audio chunks and merge into a single transcript.
 * Chunks are assumed to be sequential.
 */
export async function transcribeChunks(
  chunks: Buffer[],
  speakerMap?: Map<string, string>, // "Speaker 0" → "Marco"
): Promise<TranscriptionResult> {
  let allSegments: TranscriptSegment[] = [];
  let totalDuration = 0;
  let timeOffset = 0;

  for (const chunk of chunks) {
    const result = await transcribeAudio(chunk);

    // Offset timestamps for sequential chunks
    const offsetSegments = result.segments.map((s) => ({
      ...s,
      start: s.start + timeOffset,
      end: s.end + timeOffset,
    }));

    allSegments.push(...offsetSegments);
    timeOffset += result.durationSeconds;
    totalDuration += result.durationSeconds;
  }

  // Apply speaker name mapping if provided
  if (speakerMap) {
    allSegments = allSegments.map((s) => ({
      ...s,
      speaker: speakerMap.get(s.speaker) ?? s.speaker,
    }));
  }

  const fullText = allSegments.map((s) => `[${s.speaker}]: ${s.text}`).join("\n");

  return { fullText, segments: allSegments, durationSeconds: totalDuration };
}

/**
 * Fallback: Transcribe using OpenAI Whisper API.
 * Requires WHISPER_API_KEY to be set.
 */
export async function transcribeWithWhisper(audioBuffer: Buffer): Promise<TranscriptionResult> {
  if (!env.WHISPER_API_KEY) {
    throw new Error("WHISPER_API_KEY not configured for Whisper fallback");
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "audio.mp3");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHISPER_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    text: string;
    duration: number;
    words?: Array<{ word: string; start: number; end: number }>;
  };

  // Whisper doesn't provide speaker diarization, so single-speaker output
  const segments: TranscriptSegment[] = [
    {
      speaker: "Speaker 0",
      text: data.text,
      start: 0,
      end: data.duration ?? 0,
    },
  ];

  return {
    fullText: data.text,
    segments,
    durationSeconds: data.duration ?? 0,
  };
}
