// Vitest shim for "server-only" / "client-only". The real modules
// are empty at runtime; Next.js only uses them at build time to
// assert module-graph boundaries. Tests running under Vitest have
// no such boundary and need a resolvable empty module. Aliased in
// vitest.config.ts.
export {};
