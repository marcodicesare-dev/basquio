import { serve } from "inngest/next";

import { inngest, basquioV2Generation, basquioExport, basquioUnderstand, basquioAuthor, basquioCritiqueRevise } from "@basquio/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // Vercel Pro + Fluid Compute supports up to 800s

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [basquioV2Generation, basquioExport, basquioUnderstand, basquioAuthor, basquioCritiqueRevise],
  streaming: "allow",
});
