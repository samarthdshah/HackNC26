import { NextResponse } from "next/server";
import { getWF } from "@/lib/wf/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/wf?me=p_leo → the whole WF snapshot. */
export async function GET(req: Request) {
  const me = new URL(req.url).searchParams.get("me") ?? undefined;
  return NextResponse.json(await getWF(me));
}
