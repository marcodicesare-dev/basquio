/**
 * Vitest global setup. Stubs environment variables that production
 * modules read at import time so tests never crash on missing keys
 * and never accidentally exercise real network paths when an
 * integration helper reads process.env directly.
 *
 * EVERY VALUE HERE IS A TEST STUB. Never paste real keys, never
 * commit rotated values. Real credentials live only in
 * apps/web/.env.local and Vercel/Railway env stores.
 *
 * Tests that need to probe "key missing" behavior should explicitly
 * override via `vi.stubEnv` inside the test body.
 */

const TEST_STUBS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_PROJECT_ID: "test-supabase-project",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  FIRECRAWL_API_KEY: "test-firecrawl-key",
  FIBER_API_KEY: "test-fiber-key",
  FIBER_BASE_URL: "http://localhost-fiber.test",
  OPENAI_API_KEY: "test-openai-key",
  RESEND_API_KEY: "test-resend-key",
  BASQUIO_PIPELINE_VERSION: "v2",
  BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK: "true",
};

// Always overwrite. If a developer has a real key exported in their
// shell, letting the test inherit it risks firing real Firecrawl,
// Anthropic, or Supabase calls from what was meant to be a stub path.
// Tests that need the real value should import it explicitly via a
// file read, not via process.env.
for (const [key, value] of Object.entries(TEST_STUBS)) {
  process.env[key] = value;
}
