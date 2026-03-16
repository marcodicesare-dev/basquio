import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// V1 execute route — removed. All generation runs through v2 agentic pipeline via Inngest.
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint has been retired. Use the v2 generation pipeline." },
    { status: 410 },
  );
}
