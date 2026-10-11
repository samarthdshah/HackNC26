// Server-side proxy to the agent's HTTP endpoints. Keeps AGENT_WEB_TOKEN off the browser.

import { NextResponse } from "next/server";
import type { DarwinView } from "@wayfinder/shared";

const base = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";
const auth = (): Record<string, string> => (process.env.AGENT_WEB_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_WEB_TOKEN}` } : {});

/** Pass a request through to the agent: POST forwards the body, GET just reads. Never cached. */
export async function forward(path: string, req: Request, method: "GET" | "POST" = "POST") {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...auth() },
      ...(method === "POST" ? { body: await req.text() } : {}),
      signal: AbortSignal.timeout(60_000), // a direct answer can take a few model calls
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: `agent not reachable at ${base}: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
}

/** Agent GET /darwin for the page's first render; null when the agent is down. */
export async function fetchDarwinView(): Promise<DarwinView | null> {
  try {
    const res = await fetch(`${base}/darwin`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as DarwinView) : null;
  } catch {
    return null;
  }
}
