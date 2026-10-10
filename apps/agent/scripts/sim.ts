// Scripted end-to-end run of the demo flows through the real graphs and Gemini,
// with delivery swapped for a printer. Run: npm run sim -w @wayfinder/agent

export {};
process.env.REMINDER_MS ??= "600000";

const { initMessenger } = await import("../src/messenger.ts");
const { handleInbound } = await import("../src/graph/supervisor.ts");
const { bind } = await import("../src/org/directory.ts");
const { nameOf } = await import("../src/org/entities.ts");
const { allEdges, resetMap } = await import("../src/org/map.ts");
const { idle, resetRunner } = await import("../src/graph/runner.ts");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
initMessenger({ sink: (to, text) => console.log(`   📨 → ${nameOf(to)}: ${text}`) });
resetMap();
resetRunner();

const cast = ["leo", "raj", "tom", "priya", "sam", "nina", "maya", "victor", "dana", "ken", "jess", "elena"];
for (const name of cast) bind(`p_${name}`, { platform: "sim", id: name });

async function say(who: string, text: string) {
  if (who === "wait") {
    console.log(dim(`\n   ⏳ ${Number(text) / 1000}s pass…`));
    return new Promise((r) => setTimeout(r, Number(text)));
  }
  console.log(`\n💬 ${nameOf(`p_${who}`)}: ${text}`);
  const reply = await handleInbound({ platform: "sim", id: who }, text);
  if (reply) console.log(`   ↩︎ ${reply}`);
  await idle(); // specialist agents run in the background; let them settle
}

const scenarios: Record<string, [string, string][]> = {
  "Use case 1: Leo's warehouse access (bounce → learn → delegate)": [
    ["leo", "hey! can I get warehouse access for my first analysis? just need the curated marts"],
    ["raj", "not us, analyst access is Analytics Engineering"],
    ["tom", "done, granted the ANALYST role"],
    ["leo", "who handles data access requests now?"],
  ],
  "Welcome lunch: RSVP → approval → caterer call → payment": [
    ["sam", "set up a welcome lunch for Leo with the Commerce team on Tuesday from Greenleaf, check who's coming first"],
    ["victor", "yes!"],
    ["leo", "yes, thank you!"],
    ["nina", "count me in"],
    ["nina", "approve"],
  ],
  "Budget transfer between departments": [
    ["nina", "move $600 from Commerce's team events budget to Workplace to cover the offsite catering"],
    ["dana", "approved"],
  ],
  "Delegate: owner hands it to a teammate": [
    ["sam", "the checkout orders pipeline failed overnight, dashboards are empty"],
    ["elena", "I'm heads down on a migration today, Raj can cover this one"],
    ["raj", "fixed, backfill is running"],
  ],
  // Run with REMINDER_MS=4000 MAX_REMINDERS=1 so the timers fire quickly.
  "Reminders: nudge, then escalate": [
    ["victor", "can you get me a $120 USB-C dock from Northwind for my desk?"],
    ["wait", "5000"],
    ["wait", "8000"],
    ["dana", "approved"],
  ],
};

const only = process.argv[2];
for (const [title, lines] of Object.entries(scenarios)) {
  if (only && !title.toLowerCase().includes(only.toLowerCase())) continue;
  console.log(`\n━━ ${title} ━━`);
  for (const [who, text] of lines) await say(who, text);
}

console.log(dim("\nLearned / changed edges:"));
for (const e of allEdges().filter((e) => e.source === "learned" || e.task_type === "data_access")) {
  console.log(dim(`  ${nameOf(e.from)} → ${nameOf(e.to)} [${e.task_type}] ${e.confidence} ${e.source}${e.delegate_until ? ` until ${e.delegate_until.slice(0, 10)}` : ""}`));
}
resetMap();
process.exit(0);
