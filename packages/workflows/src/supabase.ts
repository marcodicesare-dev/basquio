import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function isSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
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
