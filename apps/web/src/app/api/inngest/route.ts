import { serve } from "inngest/next";

import { functions, inngest, basquioV2Generation } from "@basquio/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Serve both v1 and v2 Inngest functions from the same endpoint.
// Both use the shared inngest client instance.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...functions, basquioV2Generation],
});
