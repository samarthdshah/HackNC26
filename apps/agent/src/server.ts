// HTTP surface for the website (Lane B):
//   GET /live    Server-Sent Events, one `update` per shared LiveUpdate (event or edge)
//   GET /health  liveness plus what the agent is connected to
// Initial state comes from Tiger (B reads its views); /live only carries changes.

import { createServer } from "node:http";
import { source } from "./data/fixtures.ts";
import { tigerReady } from "./data/tiger.ts";
import { env } from "./env.ts";
import { onLiveUpdate } from "./events.ts";

export function startServer(info: () => Record<string, unknown> = () => ({})) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", env.corsOrigin);
    const path = new URL(req.url ?? "/", "http://x").pathname;

    if (req.method === "GET" && path === "/live") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const off = onLiveUpdate((u) => res.write(`event: update\ndata: ${JSON.stringify(u)}\n\n`));
      const beat = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        off();
        clearInterval(beat);
      });
      return;
    }

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, org_data: source, tiger: await tigerReady(), ...info() }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found", routes: ["GET /live", "GET /health"] }));
  });
  server.listen(env.port, () => console.log(`[agent] http on :${env.port} (GET /live, GET /health)`));
  return server;
}
