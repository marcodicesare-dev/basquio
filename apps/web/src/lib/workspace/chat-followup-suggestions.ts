import type { UIMessage } from "ai";

export type ChatFollowUpSuggestion = {
  label: string;
  prompt: string;
};

const SUGGESTIONS_BLOCK_RE = /<suggestions>([\s\S]*?)<\/suggestions>/i;
const SUGGESTION_ITEM_RE =
  /<label>([\s\S]*?)<\/label>\s*<prompt>([\s\S]*?)<\/prompt>/gi;

export function parseFollowUpSuggestions(text: string): {
  text: string;
  suggestions: ChatFollowUpSuggestion[];
} {
  const match = text.match(SUGGESTIONS_BLOCK_RE);
  if (!match) {
    return { text: stripPartialSuggestionsBlock(text), suggestions: [] };
  }

  const block = match[1] ?? "";
  const suggestions: ChatFollowUpSuggestion[] = [];
  for (const item of block.matchAll(SUGGESTION_ITEM_RE)) {
    const label = cleanSuggestionText(item[1] ?? "");
    const prompt = cleanSuggestionText(item[2] ?? "");
    if (!label || !prompt) continue;
    suggestions.push({ label: label.slice(0, 80), prompt: prompt.slice(0, 500) });
    if (suggestions.length >= 3) break;
  }

  return {
    text: text.replace(match[0], "").trim(),
    suggestions,
  };
}

export function stripPartialSuggestionsBlock(text: string): string {
  const start = text.search(/<suggestions>/i);
  if (start < 0) return text;
  return text.slice(0, start).trimEnd();
}

export function stripFollowUpSuggestionsFromMessages(messages: UIMessage[]): {
  messages: UIMessage[];
  suggestions: ChatFollowUpSuggestion[];
} {
  let lastSuggestions: ChatFollowUpSuggestion[] = [];
  const lastAssistantIndex = findLastAssistantIndex(messages);
  if (lastAssistantIndex < 0) return { messages, suggestions: [] };

  const next = messages.map((message, index) => {
    if (index !== lastAssistantIndex) return message;
    const parts = (message.parts ?? []).map((part) => {
      if ((part as { type?: string }).type !== "text") return part;
      const text = typeof (part as { text?: unknown }).text === "string"
        ? ((part as { text: string }).text)
        : "";
      const parsed = parseFollowUpSuggestions(text);
      if (parsed.suggestions.length > 0) lastSuggestions = parsed.suggestions;
      return { ...part, text: parsed.text };
    });
    return {
      ...message,
      parts,
      metadata: {
        ...metadataObject(message.metadata),
        suggestions: lastSuggestions,
      },
    };
  });

  return { messages: next, suggestions: lastSuggestions };
}

export function suggestionsFromMessageMetadata(message: UIMessage): ChatFollowUpSuggestion[] {
  const metadata = metadataObject(message.metadata);
  const raw = metadata.suggestions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
      if (!label || !prompt) return null;
      return { label, prompt };
    })
    .filter((item): item is ChatFollowUpSuggestion => item !== null)
    .slice(0, 3);
}

function findLastAssistantIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

function cleanSuggestionText(value: string): string {
  return value
    .replace(/^\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
