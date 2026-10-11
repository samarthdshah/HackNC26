// Server-side proxy to the agent's POST endpoints. Keeps AGENT_WEB_TOKEN off the browser.

import { NextResponse } from "next/server";

const base = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

export async function forward(path: "/say" | "/intro", req: Request) {
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AGENT_WEB_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_WEB_TOKEN}` } : {}),
      },
      body: await req.text(),
      signal: AbortSignal.timeout(60_000), // a direct answer can take a few model calls
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: `agent not reachable at ${base}: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
}
