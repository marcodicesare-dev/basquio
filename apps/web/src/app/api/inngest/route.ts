import { serve } from "inngest/next";

import { functions, inngest } from "@basquio/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
