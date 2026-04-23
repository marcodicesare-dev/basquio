import OpenAI from "openai";

let client: OpenAI | null = null;

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 4;

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

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  if (typeof status === "number") {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  const code = (error as { code?: string }).code;
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND";
}

async function callWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      const backoffMs = 250 * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[embeddings] ${label} attempt ${attempt} failed, retrying in ${Math.round(backoffMs)}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Embeddings ${label} failed after ${MAX_ATTEMPTS} attempts: ${message}`);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  const openai = getClient();
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await callWithRetry(`batch ${i / BATCH_SIZE}`, () =>
      openai.embeddings.create({ model: MODEL, input: batch }),
    );
    for (const item of response.data) {
      out.push(item.embedding);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const openai = getClient();
  const response = await callWithRetry("query", () =>
    openai.embeddings.create({ model: MODEL, input: text }),
  );
  return response.data[0].embedding;
}
