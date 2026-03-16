const WAKE_PATTERNS = [
  /hey basquio[,.]?\s*(.*)/i,
  /basquio[,.]?\s*(what|where|when|who|why|how|find|search|look|check)(.*)/i,
  /ask basquio\s*(.*)/i,
];

const IMPLICIT_PATTERNS = [
  /(?:do we have|where'?s the|what did we decide|find the|look up)\s+(.+)/i,
];

/**
 * Detect if a voice transcript segment contains a question directed at the bot.
 * Returns the extracted question text, or null if not a question.
 */
export function detectQuestion(transcript: string): string | null {
  // Check explicit wake patterns first
  for (const pattern of WAKE_PATTERNS) {
    const match = transcript.match(pattern);
    if (match) {
      // Combine all capture groups into the question
      const question = match.slice(1).filter(Boolean).join("").trim();
      if (question.length > 3) return question;
    }
  }

  // Check implicit search-intent patterns
  for (const pattern of IMPLICIT_PATTERNS) {
    const match = transcript.match(pattern);
    if (match) {
      const question = match[1].trim();
      if (question.length > 3) return question;
    }
  }

  return null;
}
