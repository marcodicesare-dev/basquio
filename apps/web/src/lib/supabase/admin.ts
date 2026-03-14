import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export async function downloadFromStorage(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
}) {
  const response = await fetch(buildStorageObjectUrl(input.supabaseUrl, input.bucket, input.storagePath), {
    headers: buildServiceHeaders(input.serviceKey),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to download ${input.storagePath}.`));
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function createSignedUploadUrl(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
  upsert?: boolean;
}) {
  const response = await fetch(buildStorageSignedUploadUrl(input.supabaseUrl, input.bucket, input.storagePath), {
    method: "POST",
    headers: buildServiceHeaders(input.serviceKey, {
      "Content-Type": "application/json",
      ...(input.upsert ? { "x-upsert": "true" } : {}),
    }),
    body: "{}",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to create a signed upload URL for ${input.storagePath}.`));
  }

  const payload = (await response.json()) as { url?: string };
  const signedUrl = payload.url ? new URL(payload.url, input.supabaseUrl) : null;
  const token = signedUrl?.searchParams.get("token");

  if (!signedUrl || !token) {
    throw new Error(`Supabase did not return a usable signed upload URL for ${input.storagePath}.`);
  }

  return {
    signedUrl: signedUrl.toString(),
    token,
    path: input.storagePath,
  };
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
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to query ${input.table}.`));
  }

  return (await response.json()) as T[];
}

export async function listStorageObjects(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  prefix?: string;
  limit?: number;
}) {
  const url = new URL(`/storage/v1/object/list/${encodeURIComponent(input.bucket)}`, input.supabaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: buildServiceHeaders(input.serviceKey, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      prefix: input.prefix ?? "",
      limit: input.limit ?? 100,
      sortBy: {
        column: "name",
        order: "desc",
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readStorageError(response, `Unable to list objects in ${input.bucket}.`));
  }

  return (await response.json()) as Array<{
    id?: string;
    name: string;
    updated_at?: string;
    created_at?: string;
    metadata?: Record<string, unknown>;
  }>;
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
  return buildStoragePathUrl(supabaseUrl, "object", bucket, storagePath);
}

function buildStorageSignedUploadUrl(supabaseUrl: string, bucket: string, storagePath: string) {
  return buildStoragePathUrl(supabaseUrl, "object/upload/sign", bucket, storagePath);
}

function buildStoragePathUrl(supabaseUrl: string, prefix: string, bucket: string, storagePath: string) {
  const encodedPath = [bucket, ...storagePath.split("/").filter(Boolean)].map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/${prefix}/${encodedPath}`, supabaseUrl).toString();
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
