// Agent server: every surface flows into the supervisor graph, which hands work
// to orchestrator threads (one per request) and their specialist agents. See src/graph/.

import type { Message, Space } from "spectrum-ts";
import { scheduleBriefings } from "./brain/briefing.ts";
import { isAiUnavailable } from "./brain/gemini.ts";
import { env } from "./env.ts";
import { emit } from "./events.ts";
import { loadOrgData } from "./data/org.ts";
import { closeTiger } from "./data/tiger.ts";
import { allPaused, restore } from "./graph/runner.ts";
import { handleInbound } from "./graph/supervisor.ts";
import { initMessenger, rememberInbound, rememberSpace } from "./messenger.ts";
import { allBindings, personFor } from "./org/directory.ts";
import { syncMapFromTiger } from "./org/map.ts";
import { startServer } from "./server.ts";
import { startSpectrum } from "./spectrum/app.ts";

const seen = new Set<string>();

async function handle(space: Space, message: Message): Promise<void> {
  if (message.direction !== "inbound" || seen.has(message.id)) return;
  seen.add(message.id);
  if (message.content.type !== "text" || !message.sender) return;

  rememberSpace(message.platform, space);
  const handle = { platform: message.platform, id: message.sender.id };
  if (message.platform === "imessage") rememberInbound(handle.id, message);
  const reply = await handleInbound(handle, message.content.text.trim(), space);
  if (reply) {
    await message.reply(reply);
    emit("message_out", "agent", { to: personFor(handle), text: reply, platform: message.platform });
  }
}

const org = await loadOrgData();
console.log(`[agent] org data from ${org.source} (${org.detail})`);
console.log(`[agent] org map from ${await syncMapFromTiger()}`);
const restored = await restore();
if (restored.requests) console.log(`[agent] restored ${restored.requests} requests, ${restored.waiting} waiting on people, ${restored.resumed} resumed`);

startServer(() => ({ surfaces: env.surfaces, paused: allPaused().length, bound: Object.keys(allBindings()) }));

const { app, imessageEnabled } = await startSpectrum();
initMessenger({ app, imessageEnabled });
console.log(
  `[agent] up · surfaces: ${[imessageEnabled && "imessage", env.surfaces.includes("terminal") && "terminal"].filter(Boolean).join(", ")}`,
);

if (env.briefingAt) {
  scheduleBriefings(env.briefingAt, () => Object.entries(allBindings()).filter(([, h]) => h.platform === "imessage").map(([p]) => p));
  console.log(`[agent] voice briefings daily at ${env.briefingAt}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  // Flush queued Tiger writes before exiting.
  process.on(signal, () => void Promise.allSettled([app.stop(), closeTiger()]).finally(() => process.exit(0)));
}

async function fail(message: Message, err: unknown) {
  console.error("[agent] handler failed", err);
  emit("error", "agent", { message: String(err) });
  const text = isAiUnavailable(err)
    ? `I can't think right now: ${err.reason}. Commands like /status still work; try again once that's fixed.`
    : "Something went wrong on my end, try again in a sec.";
  await message.reply(text).catch(() => {});
}

for await (const [space, message] of app.messages) {
  // Don't await: one slow request shouldn't block other chats.
  // The typing indicator is a nicety: if Photon refuses it, handle the message without it.
  let state: "waiting" | "running" | "done" = "waiting";
  const run = async () => {
    state = "running";
    await handle(space, message);
    state = "done";
  };
  void space.responding(run).catch(async (err: unknown) => {
    if (state === "waiting") return run().catch((e) => fail(message, e));
    if (state === "done") return console.warn(`[agent] typing indicator: ${err}`);
    await fail(message, err);
  });
}
