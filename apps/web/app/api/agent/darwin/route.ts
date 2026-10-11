import { forward } from "@/lib/wf/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent/darwin → agent GET /darwin (DarwinView in packages/shared). */
export function GET(req: Request) {
  return forward("/darwin", req, "GET");
}
