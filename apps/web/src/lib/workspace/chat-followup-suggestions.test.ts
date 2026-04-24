import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  parseFollowUpSuggestions,
  stripFollowUpSuggestionsFromMessages,
} from "./chat-followup-suggestions";

describe("parseFollowUpSuggestions", () => {
  it("extracts suggestions and strips the xml block", () => {
    const parsed = parseFollowUpSuggestions(`Coffee is shifting toward premium pods.

<suggestions>
- <label>Compare retailers</label><prompt>Compare the coffee trends across Italian retailers.</prompt>
- <label>Draft implications</label><prompt>Draft the commercial implications for Lavazza.</prompt>
- <label>Find sources</label><prompt>Find recent trade sources on coffee premiumization.</prompt>
</suggestions>`);

    expect(parsed.text).toBe("Coffee is shifting toward premium pods.");
    expect(parsed.suggestions).toEqual([
      {
        label: "Compare retailers",
        prompt: "Compare the coffee trends across Italian retailers.",
      },
      {
        label: "Draft implications",
        prompt: "Draft the commercial implications for Lavazza.",
      },
      {
        label: "Find sources",
        prompt: "Find recent trade sources on coffee premiumization.",
      },
    ]);
  });

  it("handles malformed blocks gracefully", () => {
    const parsed = parseFollowUpSuggestions(`Answer text.

<suggestions>
- <label>Broken</label>
</suggestions>`);

    expect(parsed.text).toBe("Answer text.");
    expect(parsed.suggestions).toEqual([]);
  });
});

describe("stripFollowUpSuggestionsFromMessages", () => {
  it("stores parsed suggestions on the last assistant message metadata", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "What is happening in coffee?" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Premium pods are growing.

<suggestions>
- <label>Build slide</label><prompt>Turn this into a slide outline.</prompt>
- <label>Add sources</label><prompt>Add more Italian trade sources.</prompt>
</suggestions>`,
          },
        ],
      },
    ] as unknown as UIMessage[];

    const result = stripFollowUpSuggestionsFromMessages(messages);

    expect(result.suggestions).toEqual([
      { label: "Build slide", prompt: "Turn this into a slide outline." },
      { label: "Add sources", prompt: "Add more Italian trade sources." },
    ]);
    expect((result.messages[1]?.parts?.[0] as { text: string }).text).toBe("Premium pods are growing.");
    expect(result.messages[1]?.metadata).toEqual({
      suggestions: result.suggestions,
    });
  });
});
