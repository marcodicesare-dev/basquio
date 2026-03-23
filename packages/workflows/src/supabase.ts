import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_FETCH_TIMEOUT_MS = 30_000;

function isSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
}

function isJwtLikeKey(value: string) {
  return value.split(".").length === 3;
}

function createSecretKeyCompatibleFetch(serviceKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);

    if (headers.get("Authorization") === `Bearer ${serviceKey}`) {
      headers.delete("Authorization");
    }

    return fetch(input, {
      ...init,
      headers,
    });
  };
}

export function createServiceSupabaseClient(
  supabaseUrl: string,
  serviceKey: string,
): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: isSupabaseSecretKey(serviceKey)
      ? {
          fetch: createSecretKeyCompatibleFetch(serviceKey),
        }
      : undefined,
  });
}

export async function uploadToStorage(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
  body: Buffer;
  contentType: string;
  upsert?: boolean;
}) {
  const response = await fetch(buildStorageObjectUrl(input.supabaseUrl, input.bucket, input.storagePath), {
    method: "POST",
    headers: buildServiceHeaders(input.serviceKey, {
      "cache-control": "max-age=3600",
      "content-type": input.contentType,
      "x-upsert": String(input.upsert ?? true),
    }),
    body: new Uint8Array(input.body),
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to upload ${input.storagePath}.`));
  }
}

export async function downloadFromStorage(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
}) {
  const response = await fetch(buildStorageObjectUrl(input.supabaseUrl, input.bucket, input.storagePath), {
    headers: buildServiceHeaders(input.serviceKey),
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to download ${input.storagePath}.`));
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function fetchRestRows<T>(input: {
  supabaseUrl: string;
  serviceKey: string;
  table: string;
  query: Record<string, string>;
}) {
  const url = new URL(`/rest/v1/${input.table}`, input.supabaseUrl);

  for (const [key, value] of Object.entries(input.query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: buildServiceHeaders(input.serviceKey, {
      Accept: "application/json",
    }),
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to query ${input.table}.`));
  }

  return (await response.json()) as T[];
}

export async function upsertRestRows<T>(input: {
  supabaseUrl: string;
  serviceKey: string;
  table: string;
  rows: Record<string, unknown>[];
  onConflict: string;
  select?: string;
}) {
  const url = new URL(`/rest/v1/${input.table}`, input.supabaseUrl);
  url.searchParams.set("on_conflict", input.onConflict);

  if (input.select) {
    url.searchParams.set("select", input.select);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: buildServiceHeaders(input.serviceKey, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(input.rows),
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to upsert ${input.table}.`));
  }

  return (await response.json()) as T[];
}

export async function patchRestRows<T>(input: {
  supabaseUrl: string;
  serviceKey: string;
  table: string;
  query: Record<string, string>;
  payload: Record<string, unknown>;
  select?: string;
}) {
  const url = new URL(`/rest/v1/${input.table}`, input.supabaseUrl);

  for (const [key, value] of Object.entries(input.query)) {
    url.searchParams.set(key, value);
  }

  if (input.select) {
    url.searchParams.set("select", input.select);
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: buildServiceHeaders(input.serviceKey, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(input.payload),
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to update ${input.table}.`));
  }

  return (await response.json()) as T[];
}

export async function deleteRestRows(input: {
  supabaseUrl: string;
  serviceKey: string;
  table: string;
  query: Record<string, string>;
}) {
  const url = new URL(`/rest/v1/${input.table}`, input.supabaseUrl);

  for (const [key, value] of Object.entries(input.query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildServiceHeaders(input.serviceKey, {
      Prefer: "return=minimal",
    }),
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to delete from ${input.table}.`));
  }
}

function buildServiceHeaders(serviceKey: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("apikey", serviceKey);

  if (isJwtLikeKey(serviceKey) && !isSupabaseSecretKey(serviceKey)) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}

function buildStorageObjectUrl(supabaseUrl: string, bucket: string, storagePath: string) {
  const encodedPath = [bucket, ...storagePath.split("/").filter(Boolean)].map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/object/${encodedPath}`, supabaseUrl).toString();
}

async function readStorageError(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: string; message?: string };
      return payload.error ?? payload.message ?? fallback;
    }

    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}
