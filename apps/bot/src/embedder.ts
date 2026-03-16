import OpenAI from "openai";
import { env } from "./config.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: MODEL,
      input: batch,
    });
    for (const item of response.data) {
      results.push(item.embedding);
    }
  }

  return results;
}

export async function embedQuery(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: MODEL,
    input: text,
  });
  return response.data[0].embedding;
}
