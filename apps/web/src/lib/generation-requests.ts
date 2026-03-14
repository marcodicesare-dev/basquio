import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generationRequestSchema, type GenerationRequest } from "@basquio/types";

import { downloadFromStorage, fetchRestRows, uploadToStorage } from "@/lib/supabase/admin";

const REQUEST_BUCKET = "artifacts";
const LOCAL_REQUEST_DIR = ".basquio/run-requests";

type JobRow = {
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  updated_at?: string | null;
  summary?: unknown;
};

export async function persistGenerationRequest(request: GenerationRequest) {
  const payload = Buffer.from(JSON.stringify(generationRequestSchema.parse(request), null, 2), "utf8");
  const storagePath = buildStoredRequestPath(request.jobId);
  const credentials = getSupabaseCredentials();

  if (credentials) {
    try {
      await uploadToStorage({
        ...credentials,
        bucket: REQUEST_BUCKET,
        storagePath,
        body: payload,
        contentType: "application/json",
        upsert: true,
      });
      return;
    } catch {
      // Fall through to local persistence.
    }
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const directory = path.join(workspaceRoot, LOCAL_REQUEST_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${request.jobId}.json`), payload);
}

export async function loadPersistedGenerationRequest(jobId: string): Promise<GenerationRequest | null> {
  const credentials = getSupabaseCredentials();
  const storagePath = buildStoredRequestPath(jobId);

  if (credentials) {
    try {
      const payload = await downloadFromStorage({
        ...credentials,
        bucket: REQUEST_BUCKET,
        storagePath,
      });
      return generationRequestSchema.parse(JSON.parse(payload.toString("utf8")));
    } catch {
      // Fall through to local storage.
    }
  }

  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const contents = await readFile(path.join(workspaceRoot, LOCAL_REQUEST_DIR, `${jobId}.json`), "utf8");
    return generationRequestSchema.parse(JSON.parse(contents));
  } catch {
    return null;
  }
}

export async function getGenerationJobState(jobId: string): Promise<JobRow | null> {
  const credentials = getSupabaseCredentials();
  if (!credentials) {
    return null;
  }

  try {
    const rows = await fetchRestRows<JobRow>({
      ...credentials,
      table: "generation_jobs",
      query: {
        select: "status,updated_at,summary",
        job_key: `eq.${jobId}`,
        limit: "1",
      },
    });
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function dispatchPersistedGenerationJob(jobId: string, request?: Request) {
  const baseUrl = resolveBaseUrl(request);
  if (!baseUrl) {
    return false;
  }

  try {
    const response = await fetch(new URL(`/api/jobs/${jobId}/start`, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function dispatchPersistedGenerationExecution(jobId: string, request?: Request) {
  const baseUrl = resolveBaseUrl(request);
  if (!baseUrl) {
    return false;
  }

  try {
    const response = await fetch(new URL(`/api/jobs/${jobId}/execute`, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function buildStoredRequestPath(jobId: string) {
  return `run-requests/${jobId}.json`;
}

function resolveBaseUrl(request?: Request) {
  const direct = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (direct) {
    return direct;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (!request) {
    return null;
  }

  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (forwardedHost) {
    return `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost}`;
  }

  return url.origin;
}

function getSupabaseCredentials() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return {
    supabaseUrl,
    serviceKey,
  };
}

async function resolveWorkspaceRoot() {
  let current = process.cwd();

  for (;;) {
    try {
      await access(path.join(current, "docs", "vision.md"));
      await access(path.join(current, "package.json"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error("Unable to resolve the Basquio workspace root.");
      }
      current = parent;
    }
  }
}
