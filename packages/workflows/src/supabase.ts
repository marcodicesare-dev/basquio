import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_FETCH_TIMEOUT_MS = 30_000;
const SUPABASE_UPLOAD_TIMEOUT_MS = 120_000;

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
  const startedAt = Date.now();
  const directFailure = await attemptDirectUpload(input, startedAt);
  if (!directFailure) {
    return;
  }

  try {
    const signedUpload = await createSignedUploadUrl({
      supabaseUrl: input.supabaseUrl,
      serviceKey: input.serviceKey,
      bucket: input.bucket,
      storagePath: input.storagePath,
      upsert: input.upsert,
    });
    const response = await fetch(signedUpload.signedUrl, {
      method: "PUT",
      headers: {
        "cache-control": "3600",
        "content-type": input.contentType,
        "x-upsert": String(input.upsert ?? true),
      },
      body: new Uint8Array(input.body),
      signal: AbortSignal.timeout(SUPABASE_UPLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      const fallback = await readStorageError(
        response,
        `Transient storage upstream error while uploading ${input.storagePath} via signed upload.`,
      );
      throw new Error(
        `Transient storage upstream error while uploading ${input.storagePath} via signed upload ` +
        `(HTTP ${response.status}) after ${Date.now() - startedAt}ms: ${truncateStorageError(fallback)}`,
      );
    }
  } catch (error) {
    const signedFailure = formatStorageUploadException(
      input.storagePath,
      "signed upload",
      Date.now() - startedAt,
      error,
    );
    throw new Error([directFailure, signedFailure].filter(Boolean).join(" | "));
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

async function createSignedUploadUrl(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
  upsert?: boolean;
}) {
  let clientErrorMessage = "";

  try {
    const supabase = createServiceSupabaseClient(input.supabaseUrl, input.serviceKey);
    const { data, error } = await supabase.storage.from(input.bucket).createSignedUploadUrl(input.storagePath, {
      upsert: input.upsert ?? true,
    });

    if (error) {
      throw error;
    }

    if (data?.signedUrl && data.token) {
      return data;
    }
  } catch (error) {
    clientErrorMessage = error instanceof Error ? error.message : String(error);
  }

  const response = await fetch(buildStorageSignedUploadUrl(input.supabaseUrl, input.bucket, input.storagePath), {
    method: "POST",
    headers: buildServiceHeaders(input.serviceKey, {
      "Content-Type": "application/json",
      ...(input.upsert ? { "x-upsert": "true" } : {}),
    }),
    body: "{}",
    signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const apiErrorMessage = await readStorageError(
      response,
      `Unable to create a signed upload URL for ${input.storagePath}.`,
    );
    const combinedMessage = [clientErrorMessage, apiErrorMessage].filter(Boolean).join(" | ");
    throw new Error(combinedMessage || `Unable to create a signed upload URL for ${input.storagePath}.`);
  }

  const payload = (await response.json()) as { url?: string };
  const signedUrl = payload.url ? new URL(payload.url, input.supabaseUrl) : null;
  const token = signedUrl?.searchParams.get("token");

  if (!signedUrl || !token) {
    const combinedMessage = [
      clientErrorMessage,
      `Supabase did not return a usable signed upload URL for ${input.storagePath}.`,
    ].filter(Boolean).join(" | ");
    throw new Error(combinedMessage);
  }

  return {
    signedUrl: signedUrl.toString(),
    token,
    path: input.storagePath,
  };
}

async function attemptDirectUpload(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
  body: Buffer;
  contentType: string;
  upsert?: boolean;
}, startedAt: number) {
  try {
    const response = await fetch(buildStorageObjectUrl(input.supabaseUrl, input.bucket, input.storagePath), {
      method: "POST",
      headers: buildServiceHeaders(input.serviceKey, {
        "cache-control": "max-age=3600",
        "content-type": input.contentType,
        "x-upsert": String(input.upsert ?? true),
      }),
      body: new Uint8Array(input.body),
      signal: AbortSignal.timeout(SUPABASE_UPLOAD_TIMEOUT_MS),
    });

    if (response.ok) {
      return null;
    }

    const detail = await readStorageError(
      response,
      `Transient storage upstream error while uploading ${input.storagePath} via direct upload.`,
    );
    return (
      `Transient storage upstream error while uploading ${input.storagePath} via direct upload ` +
      `(HTTP ${response.status}) after ${Date.now() - startedAt}ms: ${truncateStorageError(detail)}`
    );
  } catch (error) {
    return formatStorageUploadException(input.storagePath, "direct upload", Date.now() - startedAt, error);
  }
}

function formatStorageUploadException(
  storagePath: string,
  transport: string,
  durationMs: number,
  error: unknown,
) {
  const detail = truncateStorageError(error instanceof Error ? error.message : String(error));
  return `Transient storage upload failure for ${storagePath} via ${transport} after ${durationMs}ms: ${detail}`;
}

function truncateStorageError(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}
