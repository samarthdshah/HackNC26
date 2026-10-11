import { forward } from "@/lib/wf/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agent/summary → agent POST /summary (body: SummaryRequest in packages/shared). */
export function POST(req: Request) {
  return forward("/summary", req);
}
