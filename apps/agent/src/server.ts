// HTTP surface for the website (Lane B):
//   GET  /live    Server-Sent Events: `hello` {boot_id, bound}, then one `update` per shared
//                 LiveUpdate (event or edge), each with an id. A reconnect sends Last-Event-ID
//                 and gets what it missed; after a restart (new boot_id) it refetches instead.
//   GET  /health  liveness plus what the agent is connected to
//   POST /say     the website speaks as a person, as if they had texted (Currents compose)
//   POST /intro   Lagoon's Introduce: text two people an introduction
//   GET  /darwin  Darwin's latest run as generations with the admin's decisions (data/evolution.ts)
//   POST /darwin/generations/:gen/approve|reject   record a decision and push it to Darwin
// Initial state comes from Tiger (B reads its views); /live only carries changes.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { IntroRequest, IntroResponse, LiveHello, SayRequest, SayResponse } from "@wayfinder/shared";
import { getPerson, source } from "./data/fixtures.ts";
import { DarwinHttpError, decide, view as darwinView } from "./data/evolution.ts";
import { tigerReady } from "./data/tiger.ts";
import { env } from "./env.ts";
import { BOOT_ID, emit, onLiveUpdate, since } from "./events.ts";
import { handleAs } from "./graph/supervisor.ts";
import { openGroup } from "./messenger.ts";
import { allBindings } from "./org/directory.ts";
import { nameOf } from "./org/entities.ts";

const ROUTES = ["GET /live", "GET /health", "POST /say", "POST /intro", "GET /darwin", "POST /darwin/generations/:gen/(approve|reject)"];
const MAX_BODY = 16 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; } catch { throw new HttpError(400, "invalid JSON"); }
}

/** POSTs act as a person, so they need the shared token, or (with none set) a local caller. */
function authorise(req: IncomingMessage) {
  if (env.webToken) {
    if (req.headers.authorization !== `Bearer ${env.webToken}`) throw new HttpError(401, "missing or wrong AGENT_WEB_TOKEN");
    return;
  }
  const ip = req.socket.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) throw new HttpError(403, "set AGENT_WEB_TOKEN to allow non-local callers");
}

function person(id: unknown, field: string): string {
  if (typeof id !== "string" || !getPerson(id)) throw new HttpError(404, `${field}: unknown person ${String(id)}`);
  return id;
}

async function say(req: IncomingMessage): Promise<SayResponse> {
  const body = await readJson<SayRequest>(req);
  const as = person(body.as, "as");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new HttpError(400, "text is required");
  if (text.startsWith("/")) throw new HttpError(400, "commands are only available by text");
  const out = await handleAs(as, text, { requestId: body.request_id, mirror: body.mirror });
  return { ok: true, person: as, ...out };
}

async function intro(req: IncomingMessage): Promise<IntroResponse> {
  const body = await readJson<IntroRequest>(req);
  const a = person(body.a, "a"), b = person(body.b, "b");
  if (a === b) throw new HttpError(400, "a and b must be different people");
  const topic = String(body.topic ?? "").slice(0, 80) || "a shared interest";
  const why = String(body.why ?? "").slice(0, 300);
  const group = await openGroup([a, b], `Intro: ${topic}`);
  await group.send(`👋 ${nameOf(a)}, meet ${nameOf(b)}. ${why ? `${why} ` : ""}Wayfinder thought you two should talk about ${topic}.`);
  const event = emit("intro_sent", body.by && getPerson(body.by) ? body.by : "agent", { a, b, topic, why, group: group.id }, { tool: "match" });
  return { ok: true, group: group.id, virtual: group.id.startsWith("virtual:"), event_id: event.id };
}

function live(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const hello: LiveHello = { boot_id: BOOT_ID, bound: Object.keys(allBindings()) };
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify(hello)}\n\n`);
  const send = (id: string, u: unknown) => res.write(`id: ${id}\nevent: update\ndata: ${JSON.stringify(u)}\n\n`);
  const last = req.headers["last-event-id"];
  if (typeof last === "string" && last) {
    const missed = since(last);
    if (missed === "gap") res.write(`event: gap\ndata: {}\n\n`); // the browser refetches its snapshot
    else for (const m of missed) send(m.id, m.update);
  }
  const off = onLiveUpdate((u, id) => send(id, u));
  const beat = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => {
    off();
    clearInterval(beat);
  });
}

export function startServer(info: () => Record<string, unknown> = () => ({})) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", env.corsOrigin);
    const path = new URL(req.url ?? "/", "http://x").pathname;

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Last-Event-ID",
          "Access-Control-Max-Age": "600",
        });
        return res.end();
      }
      if (req.method === "GET" && path === "/live") return live(req, res);
      if (req.method === "GET" && path === "/health") {
        return json(res, 200, { ok: true, org_data: source, tiger: await tigerReady(), boot_id: BOOT_ID, ...info() });
      }
      if (req.method === "POST" && path === "/say") { authorise(req); return json(res, 202, await say(req)); }
      if (req.method === "POST" && path === "/intro") { authorise(req); return json(res, 200, await intro(req)); }
      if (req.method === "GET" && path === "/darwin") return json(res, 200, await darwinView());
      const gen = req.method === "POST" && /^\/darwin\/generations\/(\d+)\/(approve|reject)$/.exec(path);
      if (gen) {
        authorise(req);
        return json(res, 200, await decide(Number(gen[1]), gen[2] === "approve" ? "approved" : "rejected"));
      }
      json(res, 404, { error: "not found", routes: ROUTES });
    } catch (err) {
      const status = err instanceof HttpError || err instanceof DarwinHttpError ? err.status : 500;
      if (status === 500) console.error(`[http] ${req.method} ${path}: ${err}`);
      if (!res.headersSent) json(res, status, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(env.port, () => console.log(`[agent] http on :${env.port} (${ROUTES.join(", ")})`));
  return server;
}
