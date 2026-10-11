# How Wayfinder learns

Updated 2026-10-11: Darwin approval is live, per generation, stored as events and pushed to Darwin.

Wayfinder learns in two ways that do different jobs:
- **Live learning** (the agent) reacts to one reply and corrects one route immediately.
- **Darwin** reflects on the whole history, proposes tested rules, and needs an admin to approve them.

Each catches what the other can't.

*Written 2026-10-11 from the first live test runs and Darwin's run on the seeded history.*

## What's preloaded and what grows

| What | Starts as | Grows? |
|---|---|---|
| People and departments | 24 people, 10 departments (`data/fixtures` → Snowflake and Tiger) | No: the company directory |
| Org map: who handles what | 35 `chart` edges, e.g. "data access → Data Platform, 70%" | **Yes**: every conversation can add or adjust edges |
| Request history | 83 past requests with every handoff (May–Oct 2026) | **Yes**: every new request and hop is added |
| Policies, budgets, vendors, rooms | Fixed rules and data | No |

The chart edges are day one: Wayfinder starts like a new hire handed the official org chart. That's why Leo's request first goes to Data Platform.

Learned edges are stored in Tiger (`org_edges`, with history in `org_edge_changes`) and reloaded when the agent starts. They persist across restarts, so a truly fresh demo needs a Tiger reseed plus an empty `apps/agent/logs/`.

## Live learning: the new hire who remembers being corrected

It's triggered by a reply in a single conversation (`apps/agent/src/org/map.ts`):

| Reply | What changes |
|---|---|
| "not us, it's Analytics Engineering" (redirect) | The wrong route's confidence drops (−0.3). A new `learned` edge to the right team appears (about 0.75). |
| "done" (handled) | Each edge on the route that worked is reinforced (+0.05) |
| "I'm out, Tom covers" (delegate) | A temporary delegate edge with an end date |

**Strength:** immediate. The next request goes the right way.
**Weakness:** it only learns when someone explicitly pushes back, and it trusts a single reply.

Observed in the first live run: Leo's warehouse access was bounced by Raj and rerouted to Tom (covering for Priya). It resolved in **4 minutes against a usual 25 h**. The edge "data access → Analytics Engineering" was created at 0.75, then reinforced to 0.8.

## Darwin: the ops analyst reviewing last quarter's tickets

It's triggered when Darwin starts or `POST /evolve` is called (`services/darwin/`). It:
1. builds candidate rules from patterns in the whole history (`genes.py`);
2. **replays** every past request as if each rule had existed, counting hours, hops and bounces (`replay.py`);
3. tries combinations of rules over 25 generations, keeping and mixing the best (a genetic algorithm, `evolve.py`), then confirms against an exhaustive search of every valid rule set;
4. proposes the best 1–3 rules with evidence, for an admin to approve.

Fitness is a cost, so lower is better: hours plus hops plus bounces, plus a small penalty per rule so it doesn't hoard them.

### What it found in our seeded data

| Rule | Why live learning would miss it | Replay payoff |
|---|---|---|
| Page Platform Engineering directly for checkout incidents | No one said "not us". Incidents were politely *forwarded*. Direct paging resolved in **43 min vs 233 min** when routed. | 9.7 h, 7 hops |
| Send dashboard requests to Analytics Engineering first | Each wrong turn was small, spread across people and weeks. No single conversation looks broken. | 107.4 h, 3 hops |
| Onboarding: skip People Ops, go straight to Workplace | The bounce is at step 6 of a 7-step chain. You only see it across many new hires. | 100.1 h, 6 hops |

Together: **217 h saved (7.3%)**, bounces **36 → 24**, average hops 3.07 → 2.88, over 83 replayed requests. It converged by generation 2, and the exhaustive check over 28 rule sets agrees.

**Strength:** it finds silent waste (handoffs that work, just slowly), tests every rule against history before anything changes, and catches rules that backfire in combination.
**Weakness:** it's slow, needs history, and can't help with a brand-new kind of request.

## Why both, and the deliberate split

```
Live learning:  one reply   → immediate, small correction to one edge   (reacts)
Darwin:         all history → tested, evidence-backed policy, approved   (reflects)
```

- Live learning can be wrong (one person's opinion). Darwin later checks whether a pattern holds across many requests.
- Darwin can't react to something new. Live learning handles it on the first reply.
- **Data access is reserved for live learning.** Darwin is barred from proposing data-access rules (`FROZEN_TASK_TYPES` in `genes.py`), so the demo shows the agent learning it from Leo's thread and the two never compete over the same lesson.

## Current state and open questions

- **An admin approves a whole generation, not single rules.** On the Darwin page each generation's best rule set is a fruit. Approve it and it glows; reject it and it falls.
- **Decisions are events.** Each one is a `darwin_generation_approved|rejected` event (`gen`, `rule_ids`, `run_id`) written through `emit()`, so it lands in Tiger, `logs/events.jsonl` and the live stream like everything else. The latest decision per generation wins.
- **The agent pushes them into Darwin.** A rule is approved if any approved generation carries it, and rejected if only rejected ones do (`apps/agent/src/data/evolution.ts`). Darwin still keeps approvals in memory, so the agent re-applies them whenever Darwin's run id changes (for example after a restart).
- **That is how they reach routing:** the agent's `/route-hint` call to Darwin only returns approved rules.
- With Darwin unreachable, the page shows the **saved snapshot** (`apps/web/lib/wf/fallback/darwin-run.json`) with the buttons disabled.
- Darwin only reflects new live requests when it is re-run. Re-evolve from the page is still deferred: see [ideas.md](../../ideas.md).
- Open: is "checkout orders pipeline failed" a `checkout_incident` or a `pipeline_issue`? This decides whether Darwin's checkout rule fires in the delegate scenario.
