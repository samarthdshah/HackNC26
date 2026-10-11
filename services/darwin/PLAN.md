# Darwin plan (S5)

Darwin is lane C's Python service. It replays past requests from Tiger Data under candidate routing rules, evolves a set of 2 to 3 rules, and serves them over a small HTTP API. It only reads. All data is simulated (the fictional company Photon).

Status: plan only, no service code yet. Every number below comes from read-only queries run as `wayfinder_web` on 2026-10-10 against the seeded Tiger database (scratch scripts, not committed).

## 1. Data Darwin reads

Darwin connects as `wayfinder_web` (read-only login for B and Darwin, see [data/tiger/SCHEMA.md](../../data/tiger/SCHEMA.md)). Access checked:

| Source | Rows | Columns Darwin uses |
|---|---|---|
| `requests_public` | 83 (all `resolved`, `origin = seed`) | `id`, `task_type`, `severity`, `created_at`, `resolved_at`, `status`, `origin` |
| `request_hops_public` | 255 | `request_id`, `seq`, `from_id`, `to_id`, `at`, `outcome`, `redirect_to` |
| `org_edges` | 35 (all `chart`) | `from_id`, `to_id`, `task_type`, `confidence`, `delegate_until` |
| `actors` | 35 | `id`, `kind`, `department_id` |
| `org_edge_changes` | 0 | not used in v1 |
| `events_public` | 338 | not used in v1 |

- `SELECT` on base `requests` fails with 42501, as expected.
- `agent → dept_data_platform` for `data_access` is at 0.7 `chart`, the only `data_access` route from `agent`.
- Darwin never selects `title`, `resolution` or `note`. It uses structure and times only, so HR masking is never involved.
- History spans 2026-05-04 to 2026-10-02.

## 2. Replay

### Definitions

These match the Insights views, so Darwin's numbers agree with B's panels.

- **Hours** of a request: `resolved_at − created_at`.
- **Hops**: rows in `request_hops_public`.
- **Bounces**: hops with `outcome = 'bounced'`.
- **Hold** of hop *i*: `at(i+1) − at(i)`, or `resolved_at − at(i)` for the last hop. This is the same quantity `hop_steps` uses for bottlenecks.
- **Department** of an actor: `actors.department_id` (a department maps to itself).
- **Replay set**: every `resolved` request in `requests_public`. Live agent requests are included once they resolve. A query parameter can limit the set to `origin = seed`.

### Rule kinds

```json
{ "kind": "entry", "task_type": "checkout_incident", "to": "dept_platform", "when": null }
{ "kind": "skip",  "task_type": "onboarding", "avoid": "dept_people", "use": "dept_workplace" }
```

- **entry**: for this task type, the first hop goes to department `to`. The optional `when` is `{ "severity": ["sev1"] }`.
- **skip**: for this task type, whenever the request would go to `avoid` and `avoid` would say "not us, try `use`", it goes straight to `use`.

Each rule maps onto A's existing `route()` input (`apps/agent/src/tools/route.ts` on `origin/feat/agent_ai`): an entry rule is `prefer: to`, and a skip rule is `exclude: [avoid]` plus `prefer: use`.

### Counterfactual per request

For a request of the rule's task type:

- **entry → X**
  - If hop 1 already went to department X, the request is unchanged.
  - If X's department appears later in the chain at hop *k*, keep the chain from hop *k*. Hours become `resolved_at − at(k)`. Hops become the suffix length, plus 1 if the suffix starts at a person (the team → person step that a direct page also has). Bounces are the bounces left in the suffix. X's own hold time is kept, so the estimate is conservative.
  - If X never touched the request (misroute), apply a penalty: add the median hold of bounced hops for that task type (global median 13.7 h if none), 1 hop and 1 bounce, then the original chain.
- **skip avoid → use**: remove every hop where `avoid` bounced the request to `use`. Hours lose that hop's hold. Hops and bounces each drop by 1 per removed hop.
- Requests of other task types are unchanged.

### Score

The score of a rule set sums hours, hops and bounces over the replay set.

Fitness (lower is better) = `hours + 1·hops + 2·bounces + 2·rules`, all in hour units. Weights live in config and are placeholders. Hours dominate; the hop and bounce terms make short-but-urgent wins like checkout count; the rule term keeps sets small.

### Baseline (seeded history, no rules)

| | Requests | Hours | Avg hours | Hops | Avg hops | Bounces |
|---|---|---|---|---|---|---|
| History | 83 | 2986.1 | 35.98 | 255 | 3.07 | 36 |
| With the 3 rules in §3.3 | 83 | 2768.9 | 33.36 | 239 | 2.88 | 24 |

That is 217.2 h saved (7.3 %), 16 fewer hops and 12 fewer bounces.

## 3. Evolution

### 3.1 Gene pool (built from data, nothing hardcoded)

At the start of each run, Darwin builds the candidate rules from the loaded data:

- **Entry genes**: every (task type, department) pair where at least 2 resolved requests of that type went to that department at hop 1 (the **support guard**). Without the guard, replay credits fake wins: "onboarding → Workplace first" would claim 1353.6 h saved, but no onboarding request ever started at Workplace and the earlier hops are real work.
- **Skip genes**: every observed bounce pair (task type, bouncer department → redirect department) with 2 or more bounces and different departments.
- **Drop rules already in the org map**: an entry gene whose `to` is the agent's current top route in `org_edges` is dropped, and so is a skip gene whose `use` is that route. They are reported as "confirmed by history" but cannot be proposed.
- **Merge**: a skip gene whose bounces all happen at hop 1 becomes the entry gene for `use`, because the effect is the same.
- **Frozen genes** (see §4) are removed before the search.

### 3.2 Search

- A genome is a set of 1 to 3 rules, at most one entry rule per task type.
- Population 30, 25 generations, seeded RNG (default seed 42) so runs repeat exactly.
- Selection: tournament of 3, plus elitism (best 2 carried over).
- Crossover: uniform over the union of both parents' rules, capped at 3.
- Mutation, 1 per child:
  - add a random gene
  - drop a rule
  - change a rule's target to another valid gene for the same task type
  - toggle the `severity` condition on an entry rule (only for task types with severity)
- Runtime: 83 requests × 30 × 25 ≈ 62k request replays, well under 1 s in plain Python. Loading from Tiger takes about 1 s.
- **Honest check:** the pool is small (§3.4 lists 4 searchable genes), so a check script also tries every rule set of size 3 or less (14 sets) and asserts the GA's best equals the exhaustive best. The GA is the demo story (fitness climbing by generation); the exhaustive check proves it is not luck.

### 3.3 Expected result: 3 rules

| # | Rule | Evidence | Before → after (replay) |
|---|---|---|---|
| 1 | **checkout_incident: page Platform directly** (entry → `dept_platform`). The agent routes to `dept_commerce` today (0.8 chart) | 6 incidents. 2 paged Platform directly (req_0017, req_0066). 3 went Commerce → Data Platform (bounced) → Platform; 1 went Commerce → Nina → Aisha | 169 → 72 min avg (16.9 → 7.2 h), hops 3.17 → 2.00, bounces 3 → 0. Per incident: req_0004 190 → 61, req_0029 265 → 113, req_0043 170 → 17, req_0055 305 → 154 min |
| 2 | **dashboard_request: go to Analytics Engineering first** (entry → `dept_analytics_eng`). The agent routes to `dept_data_platform` today (0.6) | 5 requests. 3 went to Data Platform first and bounced ("We own pipelines, not dashboards") at 64.7 h avg; 2 went to AE first at 28.6 h avg | 50.3 → 28.8 h avg (107.4 h saved), hops 2.60 → 2.00, bounces 3 → 0 |
| 3 | **onboarding desk and badge: skip People Ops, go to Workplace** (skip `dept_people` → `dept_workplace`) | 6 of 14 onboarding requests bounced at the last step ("Desks and badges are Workplace, not People Ops") | 107.4 → 100.3 h avg (100.1 h saved), hops 6.43 → 6.00, bounces 16 → 10. Last 10 new hires: 4.01 → 3.89 days, 6.00 → 5.80 hops |

About rule 1: the `insights_checkout` view says 43 min direct vs 233 min routed. Darwin's replay of the 4 routed incidents gives 86 min, not 43, because it keeps the time Platform itself held each incident. Both numbers are honest; they measure different things. B should label which one is shown.

### 3.4 Pool after filters (what the GA searches)

| Gene | Status |
|---|---|
| checkout_incident entry → `dept_platform` (support 2) | searched, expected in best set |
| checkout_incident skip `dept_data_platform` → `dept_platform` (3 bounces, 3.6 h) | searched, adds nothing once rule 1 is in |
| dashboard_request entry → `dept_analytics_eng` (support 2; the skip gene merges into it) | searched, expected |
| onboarding skip `dept_people` → `dept_workplace` (6 bounces, 100.1 h) | searched, expected |
| data_access entry → `dept_analytics_eng` (support 2, 73.7 h) | **frozen** (§4) |
| onboarding skip `dept_data_platform` → `dept_analytics_eng` (10 bounces, 156.6 h) | **frozen** (§4) |
| catering, benefits_question, leave_request, nda_request, contract_review bounces to their right team (1 to 2 bounces each, 7.8 to 22.4 h) | dropped: the org map already routes them right ("confirmed by history") |
| every onboarding entry gene | dropped by the support guard (0 support) |

## 4. Demo safety

- **No writes, by grant.** Darwin connects only as `wayfinder_web`, which has no INSERT, UPDATE, DELETE or TRUNCATE on anything (covered by `tiger:test-roles`). Every session also runs `SET default_transaction_read_only = on`.
- **Never the owner login.** Darwin reads `TIGER_DATABASE_URL` for host and database only, and always sets user `wayfinder_web` and password `TIGER_WEB_PASSWORD`. It refuses to start if the resulting user is anything else.
- **Never `org_edges`.** Darwin never writes `org_edges` or `org_edge_changes`, and never calls A.
- **Leo's route is out of the search.** The frozen list removes any gene with `task_type = data_access`, and any gene whose effect is the Data Platform → Analytics Engineering redirect for a task type A routes as a `data_access` step (onboarding's data step). So Darwin can never propose a change to `agent → dept_data_platform` for `data_access`. The live demo stays the moment the agent learns that redirect from Leo's reply.
- **Hint guard.** `GET /route-hint` (§5) returns nothing for `data_access`, whatever rules exist. The check script asserts this.
- **Approval.** Rules are proposals. Nothing reaches routing unless an admin approves it (§5). Approvals live in Darwin's memory, not Tiger.

## 5. API

- **Framework:** FastAPI + uvicorn. Pydantic v2 models (already used by `models.py`).
- **Port:** 8100. `DARWIN_URL=http://localhost:8100`.
- **CORS:** allows `http://localhost:3000` (Next.js) by default.
- **Storage:** none in Tiger. The latest run and the approvals are kept in memory. Runs are deterministic (seeded), so a restart rebuilds them with one `POST /evolve`.

| Method and path | Caller | Purpose |
|---|---|---|
| `GET /health` | anyone | `{ ok, tiger: true, requests: 83, login: "wayfinder_web" }` |
| `GET /baseline` | B | History score, overall and by task type |
| `POST /evolve` | B ("Run Darwin" button) | Runs the GA and returns the result, about 1 to 2 s |
| `GET /runs/latest` | B, A | The last result, or 404 before the first run |
| `POST /replay` | B (optional what-if) | Score any rule set you send |
| `POST /rules/{id}/approve`, `POST /rules/{id}/reject` | B (admin button) | Marks a rule approved, in memory |
| `GET /route-hint?task_type=&severity=` | A (optional) | `{ prefer?, exclude?, rule_id?, reason? }` from **approved** rules only; empty for `data_access` |

`POST /evolve` request (every field optional):

```json
{ "seed": 42, "population": 30, "generations": 25, "max_rules": 3, "origin": "all" }
```

Response:

```json
{
  "run_id": "run_42_2026-10-10T20:15:00Z",
  "replayed": 83,
  "baseline": { "hours": 2986.1, "hops": 255, "bounces": 36, "fitness": 3313.1 },
  "best": {
    "fitness": 3061.9,
    "score": { "hours": 2768.9, "hops": 239, "bounces": 24 },
    "rules": [
      {
        "id": "entry:checkout_incident:dept_platform",
        "kind": "entry",
        "task_type": "checkout_incident",
        "to": "dept_platform",
        "when": null,
        "text": "Page Platform directly for checkout incidents",
        "status": "proposed",
        "evidence": {
          "requests": 6,
          "support": 2,
          "request_ids": ["req_0004", "req_0017", "req_0029", "req_0043", "req_0055", "req_0066"],
          "before": { "avg_minutes": 169.2, "avg_hops": 3.17, "bounces": 3 },
          "after":  { "avg_minutes": 71.7,  "avg_hops": 2.0,  "bounces": 0 },
          "hours_saved": 9.7
        }
      }
    ]
  },
  "generations": [ { "gen": 0, "best_fitness": 3301.0, "mean_fitness": 3290.4 } ],
  "confirmed_by_history": [ { "task_type": "catering", "route": "dept_workplace", "bounces_avoided": 2 } ],
  "runtime_ms": 640
}
```

The `fitness` numbers are illustrative. `text` is generated from a template (no LLM). Department names come from `actors.name`.

**How results reach the demo:**

1. B's Insights page calls `POST /evolve`, animates `generations` as a fitness curve, and shows the rules with before/after and request ids.
2. An admin approves a rule there.
3. Optionally, if A opts in, A's `routeNode` calls `GET /route-hint` before `route()` and passes `prefer`/`exclude`. Then the agent can say "Paging Platform directly (Darwin: incidents resolve in 72 min instead of 169)".
4. Without A, Darwin is a B panel only.

## 6. Runtime

- **Python:** 3.11 or newer (local: 3.13.0).
- **Dependencies:** `fastapi`, `uvicorn[standard]`, `psycopg[binary]` (v3), `pydantic>=2`, `python-dotenv`. NetworkX (mentioned in the root README) is not needed: replay is list processing, no graph algorithms.
- **Files, all in `services/darwin`:**
  - `app.py` (API)
  - `db.py` (read-only load)
  - `replay.py`
  - `genes.py` (pool, filters, frozen list)
  - `evolve.py` (GA)
  - `check.py` (quick check: baseline numbers, the 3 rules found, GA = exhaustive, hint guard)
  - `models.py` (unchanged)
- **Run:**
  ```
  cd services/darwin
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  .venv/bin/uvicorn app:app --port 8100
  .venv/bin/python check.py
  ```
  `.venv/` and `__pycache__/` are already in the root `.gitignore`.
- **Env vars** (root `.env`, loaded with python-dotenv):

  | Var | Use |
  |---|---|
  | `TIGER_DATABASE_URL` | Host and database only. The user is forced to `wayfinder_web` |
  | `TIGER_WEB_PASSWORD` | Already in `.env.example` |
  | `DARWIN_URL` | Already in `.env.example`. For callers (A, B) |
  | `DARWIN_PORT` | Optional, default 8100 |
  | `DARWIN_CORS_ORIGINS` | Optional, default `http://localhost:3000` |

  The last two are new. Adding them to `.env.example` needs approval.

## 7. Proposed contract changes (not applied)

- **D1 – `models.py`:** no change needed. Darwin uses its own local models (`Rule`, `Score`, `Evidence`, `EvolveResult`) in `app.py`, which are not shared.
- **D2 – `packages/shared`:** add TypeScript mirrors so B (and A, if it uses `/route-hint`) get typed responses: `DarwinRule`, `DarwinScore`, `DarwinRun`, `RouteHint`. If approved, add matching Pydantic models to `models.py`, per the "change both together" rule.
- **D3 – existing drift:** A's branch `origin/feat/agent_ai` adds `StepKind`, `PlanStep`, `StepResult` and `ToolIO` to `packages/shared/src/index.ts` with no Python mirror. Darwin does not need them. Proposal: mirror only what Python uses, and note that in `models.py`.

## 8. Open questions

### For you (lane C)

1. **Rule 2 overlaps the Leo story.** dashboard_request → Analytics Engineering is the same Data Platform confusion Leo's request shows, but for a different task type. It does not touch the `data_access` route. Keep it, or freeze it too? If frozen, Darwin returns 2 rules: checkout plus onboarding desk and badge.
2. **Show frozen genes?** The API could list frozen genes as "left for the live agent to learn", which could be a demo line. Default: hidden.
3. **Store approvals?** Approvals stay in memory unless you approve a small `darwin_rules` table in Tiger (owner-created, with a new grant).

### For lane A

1. Will `routeNode` call `GET /route-hint` (approved rules only) and pass `prefer`/`exclude` to `route()`? Or should Darwin stay display-only?
2. Will the agent classify "the checkout orders pipeline failed overnight" (your `scripts/sim.ts`) as `checkout_incident` or `pipeline_issue`? Rule 1 only fires for `checkout_incident`.
3. Onboarding plan steps use task types from `org_edges`, and there is no desk/badge task type. Which step should rule 3 attach to, or should C add a task type (for example `desk_setup` → `dept_workplace`) to the fixtures?
4. Should `request_created` include `severity`? Live rows have null `severity` now. None of the 3 rules needs it.
5. The header of your `src/data/tiger.ts` says the agent writes `requests` and `request_hops`. `wayfinder_agent` cannot do that; the events trigger derives them. Darwin replays whatever resolves there, so live hops must come from `hop` events.

### For lane B

1. Where does the Darwin panel go (the Insights page?), and is one `POST /evolve` response with a `generations` array enough, or do you want streaming?
2. Is your Next.js origin `http://localhost:3000` (for CORS)?
3. Do you want the approve/reject buttons, or is the rules list read-only?
4. Which checkout number do you label: Insights' 43 vs 233 min (observed groups), or Darwin's 169 → 72 min (replay)?
