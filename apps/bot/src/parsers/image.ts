import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
import type { ParseResult } from "../kb-types.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export async function parseImage(buffer: Buffer, mimeType: string): Promise<ParseResult> {
  const base64 = buffer.toString("base64");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType as ImageMediaType, data: base64 },
        },
        {
          type: "text",
          text: `Extract ALL text and information visible in this image.
Preserve structure: headings, bullet points, tables, labels, values.
If this is a screenshot of a conversation, preserve who said what.
If this is a chart or diagram, describe all data points and relationships.
If this is a photo of a whiteboard or handwriting, transcribe everything.
Return ONLY the extracted content, no commentary.`,
        },
      ],
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return {
    text,
    metadata: { hasImages: true },
  };
}
