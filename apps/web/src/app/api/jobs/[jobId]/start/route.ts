import { POST as executePost } from "../execute/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export const POST = executePost;
