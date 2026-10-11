# Phase 3 runbook: live iMessage testing with one phone

Run the real agent (not `npm run sim`) with the website open, text from your phone, and check that each page shows what happened.

## Before you start

0. **Run only one agent per Photon project.** Every connected agent gets every text. Two agents means duplicate plans, and the copy nobody answers will nudge and escalate on its own. Check that no teammate has `apps/agent` running before you test.

1. **`.env` values on one line each.** A pasted value that wrapped onto a second line is cut off at the break. Check `SOLANA_SECRET_KEY`, `SNOWFLAKE_PAT`, `SNOWFLAKE_AGENT_PAT` and `TIGER_DATABASE_URL`.
2. Run `npm run check:keys -w @wayfinder/agent`, then `npm run wf:check -w @wayfinder/web`. The second one compares the website's numbers against Tiger's views.
3. Fresh data (Lane C): `npm --prefix data run tiger:seed`. Then text `/reset` to the agent, or delete `apps/agent/logs/`.

## Start everything

```bash
npm run dev -w @wayfinder/agent     # iMessage + terminal; the terminal is where every other persona types
npm run dev -w @wayfinder/web       # http://localhost:3000
```

`curl localhost:3000/api/health` should show `"agent":{"ok":true,…}`. The site then follows the agent's live feed (`GET :8787/live`) and toasts as things happen.

## How one phone plays many people

- Your phone is whoever the scenario centres on. Text `/iam leo` (or `/iam nina`, …) to switch. Switching moves that persona to your phone, and the previous one falls back to the terminal.
- Everyone else answers from the agent's terminal: `/as raj`, then type Raj's reply. Texts to people not on your phone are printed in the terminal as `→ Name: …`.
- With one phone, "group" threads (RSVP, intros) arrive as separate DMs. That's expected (see [ideas.md](../ideas.md)).
- The website can also speak as anyone. Open Currents with `?me=p_raj` and use the compose box. That's handy when the terminal is busy.

## Scenarios

The texts are the ones in `apps/agent/scripts/sim.ts`. Run **1 first**: it's the gate.

| # | On your phone | In the terminal (`/as …`) | Check on the website |
|---|---|---|---|
| 1 | `/iam leo` · "hey! can I get warehouse access for my first analysis? just need the curated marts" | raj: "not us, analyst access is Analytics Engineering" · tom: "done, granted the ANALYST role" | **Roots:** Leo has a new query, then it's Done. **Currents:** Raj (redirect), then Tom (answer); learned arc "Data access goes straight to Analytics Engineering"; elapsed minutes vs ~25 h usual. Toast "Wayfinder learned". **Insights:** hops-after and hours saved appear |
| 1b | Leo: "who handles data access requests now?" | — | The phone reply names Analytics Engineering / Tom covering for Priya. No new query |
| 2 | `/iam sam` · "set up a welcome lunch for Leo with the Commerce team on Tuesday from Greenleaf, check who's coming first" | victor: "yes!" · leo: "yes, thank you!" · nina: "count me in" · nina: "approve" | Currents (`?me=p_sam`): RSVP rows, headcount, approval asked → approved, caterer call (role-played), payment with Solana explorer link, resolved |
| 3 | `/iam nina` · "move $600 from Commerce's team events budget to Workplace to cover the offsite catering" | dana: "approved" | Pending, then approved, then a Nessie payment row |
| 4 | `/iam dana` · "Why do new hires take so long to get set up?" then `/iam leo` and ask the same | — | Dana gets 4.01 days / 6 hops (needs a working `SNOWFLAKE_AGENT_PAT`); Leo is told he can't see it. Insights shows the same 4.01 / 6.00 |
| 5 | `/iam victor` · "I need to request two weeks of parental leave starting next month" | andre: "done, approved and logged in the leave system" | Every text on Currents reads `[visible to HR only]`; nothing in the war room |
| 6 | `/iam nina` · "I need The Commons today 12:00 to 1pm for a catered team lunch, about 12 of us" | luis: "done, booked the Commons 12-1 for Nina" | Currents: room checked, then Sam's unused time released. **Lagoon:** the "The Commons" topic disappears |
| 7 | `/iam sam` · "the checkout orders pipeline failed overnight, dashboards are empty" | elena: "I'm heads down on a migration today, Raj can cover this one" · raj: "fixed, backfill is running" | Currents: Elena delegates to Raj, then Raj answers; delegate edge toast |
| 8 | Set `REMINDER_MS=20000` and `MAX_REMINDERS=1` in `.env`, restart the agent. `/iam victor` · "can you get me a $120 USB-C dock from Northwind for my desk?" | wait ~45 s · dana: "approved" | Pending, reminder, escalated, approved, paid |
| 10 | — | — | **Lagoon** as Leo: open the "sql" topic, Introduce Tom. Your phone gets the intro; Tom's copy is in the terminal. "Intros made" goes up on Insights |
| 11 | — | — | **Currents** on an open request: type in the compose box. A "you" row appears, then Wayfinder's reply |

Scenario 9 (Darwin applying an approved rule) is deferred: see [ideas.md](../ideas.md).

## If something looks wrong

- **Page not updating:** check `curl localhost:3000/api/health`. `agent.ok: false` means the agent is down. `source: fixtures` means Tiger isn't reachable and the site is reading the fixtures plus `apps/agent/logs/events.jsonl`.
- **"I can't think right now":** Gemini is unavailable. Fix the key or quota, then text `/retry`.
- **A reply went to the wrong request:** text `/status` to see what's waiting on you, then answer with the number, e.g. `DONE 2`.
