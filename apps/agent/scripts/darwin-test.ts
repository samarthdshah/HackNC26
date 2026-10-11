// Checks the agent follows Darwin's approved rules. Uses the real Darwin when
// DARWIN_URL answers /health; otherwise a stand-in that returns the replies Lane C
// verified (checkout prefers dept_platform; onboarding skips People Ops -> Workplace).
//   npm run darwin:test -w @wayfinder/agent
// With real Darwin, approve rules first (approvals reset when Darwin restarts):
//   curl -X POST "$DARWIN_URL/rules/entry:checkout_incident:dept_platform/approve"

import { createServer } from "node:http";

process.env.REMINDER_MS ??= "600000";
process.env.TIGER_DISABLED = "1"; // never write test traffic into the team's Tiger tables

const { env } = await import("../src/env.ts");

let real = false;
if (env.darwinUrl) {
  try {
    const health = await fetch(new URL("/health", env.darwinUrl), { signal: AbortSignal.timeout(2000) });
    real = health.ok && ((await health.json()) as { ok?: boolean }).ok === true;
  } catch {}
}

let stub: ReturnType<typeof createServer> | undefined;
if (!real) {
  const hints: Record<string, object> = {
    checkout_incident: {
      prefer: "dept_platform",
      redirects: [],
      rule_ids: ["entry:checkout_incident:dept_platform"],
      reason: "Page Platform Engineering directly for checkout incidents",
    },
    onboarding: {
      prefer: null,
      redirects: [{ avoid: "dept_people", use: "dept_workplace" }],
      rule_ids: ["skip:onboarding:dept_people>dept_workplace"],
      reason: "Skip People Ops for desks and badges; Workplace handles them",
    },
  };
  stub = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const task = url.searchParams.get("task_type") ?? "";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ task_type: task, prefer: null, redirects: [], rule_ids: [], reason: "No approved Darwin rule", ...hints[task] }));
  }).listen(0);
  await new Promise((r) => stub!.once("listening", r));
  const { port } = stub.address() as { port: number };
  (env as { darwinUrl: string }).darwinUrl = `http://127.0.0.1:${port}`;
}
console.log(`Darwin: ${real ? `real service at ${env.darwinUrl}` : "stand-in (DARWIN_URL not answering)"}`);

const { initMessenger } = await import("../src/messenger.ts");
const { handleInbound } = await import("../src/graph/supervisor.ts");
const { bind } = await import("../src/org/directory.ts");
const { nameOf } = await import("../src/org/entities.ts");
const { idle, resetRunner } = await import("../src/graph/runner.ts");
const { resetMap } = await import("../src/org/map.ts");
const { loadOrgData } = await import("../src/data/org.ts");

const lines: string[] = [];
initMessenger({
  sink: (to, text) => {
    lines.push(`→ ${nameOf(to)}: ${text}`);
    console.log(`   📨 → ${nameOf(to)}: ${text.slice(0, 150)}`);
  },
});
await loadOrgData();
resetRunner();
resetMap();
for (const n of ["victor", "aisha", "marcus", "nina", "grace", "omar", "maya", "luis", "jess"]) bind(`p_${n}`, { platform: "sim", id: n });

async function say(who: string, text: string) {
  console.log(`💬 ${nameOf(`p_${who}`)}: ${text}`);
  const reply = await handleInbound({ platform: "sim", id: who }, text);
  if (reply) console.log(`   ↩︎ ${reply}`);
  await idle();
}

console.log("\n━━ Checkout incident: Darwin says page Platform directly ━━");
await say("victor", "checkout is down, customers can't pay with cards right now");
const darwinLine = lines.find((l) => l.includes("(Darwin:"));
const sentTo = lines.find((l) => /^→ (Aisha|Marcus|Nina)/.test(l) && !l.includes("FYI"));
console.log(`\n   Darwin hint applied: ${darwinLine ? "yes" : "NO"} · first ask went to: ${sentTo?.split(":")[0].slice(2) ?? "nobody"}`);

stub?.close();
resetMap();
process.exit(darwinLine ? 0 : 1);
