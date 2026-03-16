import { serve } from "inngest/next";

import { inngest, basquioV2Generation } from "@basquio/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [basquioV2Generation],
});
