import { NextResponse } from "next/server";
import { tigerConfigured } from "@/lib/wf/tiger";
import { getWF } from "@/lib/wf/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";
const ping = (url: string) => fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok ? r.json() : null).catch(() => null);

/** GET /api/health → where data comes from and whether the agent is up. */
export async function GET() {
  const [wf, agent] = await Promise.all([getWF(), ping(`${agentUrl}/health`)]);
  return NextResponse.json({
    source: wf.source, tigerConfigured: tigerConfigured(), requests: wf.stats.requestsRouted,
    agent: agent ? { ok: true, ...agent } : { ok: false, url: agentUrl },
    darwin: wf.darwinSource,
  });
}
