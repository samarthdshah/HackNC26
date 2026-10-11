// Proves requests survive a restart. Phase 1 starts a request and exits while it
// waits on Raj; phase 2 is a fresh process that restores and lets Raj reply.
//   npx tsx scripts/restart-test.ts 1 && npx tsx scripts/restart-test.ts 2

export {};
process.env.REMINDER_MS ??= "600000";
process.env.TIGER_DISABLED = "1"; // never write test traffic into the team's Tiger tables
const phase = process.argv[2];

const { initMessenger } = await import("../src/messenger.ts");
const { handleInbound } = await import("../src/graph/supervisor.ts");
const { bind } = await import("../src/org/directory.ts");
const { nameOf } = await import("../src/org/entities.ts");
const { idle, resetRunner, restore, waitingOn } = await import("../src/graph/runner.ts");
const { resetMap } = await import("../src/org/map.ts");
const { loadOrgData } = await import("../src/data/org.ts");

initMessenger({ sink: (to, text) => console.log(`   📨 → ${nameOf(to)}: ${text}`) });
await loadOrgData();
for (const n of ["leo", "raj", "tom"]) bind(`p_${n}`, { platform: "sim", id: n });
const say = async (who: string, text: string) => {
  console.log(`💬 ${nameOf(`p_${who}`)}: ${text}`);
  const reply = await handleInbound({ platform: "sim", id: who }, text);
  if (reply) console.log(`   ↩︎ ${reply}`);
  await idle();
};

if (phase === "1") {
  resetRunner();
  resetMap();
  await say("leo", "can I get warehouse access for the curated marts?");
  console.log(`-- process exits; waiting on Raj: ${waitingOn("p_raj").length}`);
} else {
  console.log(`-- fresh process: restore() →`, await restore(), `waiting on Raj: ${waitingOn("p_raj").length}`);
  await say("raj", "not us, try Analytics Engineering");
  await say("tom", "done");
  resetMap();
}
process.exit(0);
