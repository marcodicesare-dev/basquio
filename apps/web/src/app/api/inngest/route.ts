import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function retired() {
  return NextResponse.json(
    { error: "The Inngest generation endpoint has been retired. Basquio now runs deck generation through the direct code-execution worker." },
    { status: 410 },
  );
}

export const GET = retired;
export const POST = retired;
export const PUT = retired;
