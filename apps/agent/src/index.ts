// Agent server: every surface flows into the supervisor graph, which hands work
// to orchestrator threads (one per request) and their specialist agents. See src/graph/.

import type { Message, Space } from "spectrum-ts";
import { scheduleBriefings } from "./brain/briefing.ts";
import { env } from "./env.ts";
import { emit } from "./events.ts";
import { handleInbound } from "./graph/supervisor.ts";
import { initMessenger, rememberSpace } from "./messenger.ts";
import { allBindings } from "./org/directory.ts";
import { startSpectrum } from "./spectrum/app.ts";

const seen = new Set<string>();

async function handle(space: Space, message: Message): Promise<void> {
  if (message.direction !== "inbound" || seen.has(message.id)) return;
  seen.add(message.id);
  if (message.content.type !== "text" || !message.sender) return;

  rememberSpace(message.platform, space);
  const handle = { platform: message.platform, id: message.sender.id };
  const reply = await handleInbound(handle, message.content.text.trim(), space);
  if (reply) {
    await message.reply(reply);
    emit("message_out", "agent", { text: reply, platform: message.platform });
  }
}

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
  process.on(signal, () => void app.stop().finally(() => process.exit(0)));
}

for await (const [space, message] of app.messages) {
  // Don't await: one slow request shouldn't block other chats.
  void space
    .responding(() => handle(space, message))
    .catch(async (err: unknown) => {
      console.error("[agent] handler failed", err);
      emit("error", "agent", { message: String(err) });
      await message.reply("Something went wrong on my end, try again in a sec.").catch(() => {});
    });
}
