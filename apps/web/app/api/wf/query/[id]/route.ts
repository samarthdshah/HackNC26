import { NextResponse } from "next/server";
import { pickQuery } from "@/lib/wf/build";
import { getWF } from "@/lib/wf/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/wf/query/:id?me= → one query and its transactions (targeted refetch after a live event). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = new URL(req.url).searchParams.get("me") ?? undefined;
  return NextResponse.json(pickQuery(await getWF(me), params.id));
}
