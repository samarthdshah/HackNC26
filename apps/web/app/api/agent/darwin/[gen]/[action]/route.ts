import { NextResponse } from "next/server";
import { forward } from "@/lib/wf/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agent/darwin/:gen/(approve|reject) → agent POST /darwin/generations/:gen/:action. */
export function POST(req: Request, { params }: { params: { gen: string; action: string } }) {
  if (!/^\d+$/.test(params.gen)) return NextResponse.json({ ok: false, error: "gen must be a number" }, { status: 400 });
  if (params.action !== "approve" && params.action !== "reject") return NextResponse.json({ ok: false, error: "action must be approve or reject" }, { status: 400 });
  return forward(`/darwin/generations/${params.gen}/${params.action}`, req);
}
