export const CHAT_STREAM_CHARACTER_DELAY_MS = 8;
export const CHAT_STREAM_UI_THROTTLE_MS = 16;

export function firstVisibleCharacter(buffer: string): string | null {
  return Array.from(buffer)[0] ?? null;
}
