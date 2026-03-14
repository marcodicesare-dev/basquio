import { serve } from "inngest/next";

import { functions, inngest } from "@basquio/workflows";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
