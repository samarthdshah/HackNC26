import { forward } from "@/lib/wf/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agent/say → agent POST /say (body: SayRequest in packages/shared). */
export function POST(req: Request) {
  return forward("/say", req);
}
