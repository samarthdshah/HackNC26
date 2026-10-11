import { forward } from "@/lib/wf/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agent/intro → agent POST /intro (body: IntroRequest in packages/shared). */
export function POST(req: Request) {
  return forward("/intro", req);
}
