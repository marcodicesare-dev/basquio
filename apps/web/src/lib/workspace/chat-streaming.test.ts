import { describe, expect, it } from "vitest";
import { smoothStream } from "ai";

import {
  CHAT_STREAM_CHARACTER_DELAY_MS,
  CHAT_STREAM_UI_THROTTLE_MS,
  firstVisibleCharacter,
} from "./chat-streaming";

describe("workspace chat streaming", () => {
  it("chunks model text one visible character at a time", async () => {
    const transform = smoothStream({
      delayInMs: null,
      chunking: firstVisibleCharacter,
      _internal: { delay: async () => undefined },
    })({ tools: {} });
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();

    const write = async () => {
      await writer.write({
        type: "text-delta",
        id: "text-1",
        text: "Hi world",
      } as never);
      await writer.close();
    };

    const emitted: string[] = [];
    const writePromise = write();
    for (let i = 0; i < "Hi world".length; i += 1) {
      const next = await reader.read();
      if (next.done) break;
      emitted.push((next.value as { text?: string }).text ?? "");
    }
    await writePromise;

    expect(emitted).toEqual(["H", "i", " ", "w", "o", "r", "l", "d"]);
  });

  it("keeps the stream fast enough to feel live", () => {
    expect(CHAT_STREAM_CHARACTER_DELAY_MS).toBeLessThanOrEqual(8);
    expect(CHAT_STREAM_UI_THROTTLE_MS).toBeLessThanOrEqual(16);
  });
});
