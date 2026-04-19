import "server-only";

import OpenAI from "openai";

let client: OpenAI | null = null;

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  const openai = getClient();
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({ model: MODEL, input: batch });
    for (const item of response.data) {
      out.push(item.embedding);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const openai = getClient();
  const response = await openai.embeddings.create({ model: MODEL, input: text });
  return response.data[0].embedding;
}
