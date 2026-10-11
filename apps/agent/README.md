# apps/agent

Owner: **Lane A**

Agent server: Photon Spectrum, multi-agent LangGraph orchestration on Gemini, approvals, ElevenLabs, Nessie, Solana.

## Setup

1. Fill in the Lane A block of `.env` at the repo root (see `.env.example`).
2. `npm install` from the repo root.
3. `npm run check:keys -w @wayfinder/agent` should show a ✅ for every service.

## Run

| Command (from repo root, add `-w @wayfinder/agent`) | What it does |
|---|---|
| `npm run dev` | Starts every surface in `SURFACES`, restarts on file changes |
| `npm run terminal` | Terminal chat only (tuichat downloads on first run). No phone needed |
| `npm run sim` | Scripted demo flows through the real graphs and Gemini, no Spectrum. `npm run sim -- "welcome lunch"` runs one. |
| `npm run voice:test -- "text"` | Sends an ElevenLabs voice note to `DEMO_PHONE` over iMessage |
| `npm run tiger:test` | One live request through C's events trigger: prints the derived request, hops and edge history, then cleans up (owner login; `-- --keep` leaves the rows for Insights) |
| HTTP | `GET /live` (SSE of shared `LiveUpdate`s) and `GET /health` on `AGENT_PORT` (8787) for the website |

## Playing the cast

Each phone or terminal is bound to one person from the fixtures:

- On a phone: text `/iam tom` once. From then on that phone is Tom.
- In the terminal: `/as leo`, send a request, then `/as raj` to answer as Raj. Messages to people who aren't bound to a phone show up in the terminal as `→ Name: …`.
- In a group chat: `/warroom` makes it the live status channel.

Other commands: `/briefing` (voice rundown), `/status`, `/map data_access`, `/who priya`, `/whoami`, `/voice <text>`, `/reset`, `/help`.

## Orchestration (multi-agent, LangGraph)

```
inbound text ─▶ SUPERVISOR graph (per message)
                identify ─┬─ command / unknown_sender ─▶ reply
                          └─ triage ─┬─ resume ─▶ the thread waiting on this person
                                     ├─ new ────▶ start an ORCHESTRATOR thread
                                     ├─ answer ─▶ Q&A agent (Gemini tool loop)
                                     └─ chat

ORCHESTRATOR graph (one thread per request)
  understand ─▶ planner ⇄ critic ─▶ announce ─▶ schedule ─▶ await_agents ─▶ on_result ─┬─▶ schedule
                (planning agent + policy critic,          ▲    (parallel)              └─▶ recover ─▶ schedule / wrap_up
                 up to 2 revisions)                       │                               (recovery agent)
                                                          └── spawns one SPECIALIST AGENT thread per ready step

SPECIALIST AGENTS (each its own graph + thread, briefed with every upstream result)
  👤 human     route ─▶ draft_ask ─▶ dispatch ─▶ await_owner ─▶ on_reply (done / redirect / delegate / deny / question)
  ✍️ approval  price ─▶ check_permission ─▶ ask_approver ─▶ await_answer ─▶ on_answer (chains, escalation, delegation)
  💸 treasury  guard ─▶ execute (Gemini tool loop: Solana / Nessie bill / Nessie transfer) ─▶ verify ─▶ receipt
  📞 voice     brief ─▶ call (live ElevenLabs or two agents role-play) ─▶ debrief ─▶ report (voice note)
  🙋 rsvp      resolve_invitees ─▶ invite (group thread) ─▶ await_rsvps ─▶ on_rsvp ─▶ finalize (headcount)
  🏢 room      resolve ─▶ check ─┬─▶ release (unused tail ≥ 30 min, POL-ROOM-1; booker told) ─▶ announce
                                 └─▶ announce (free, or a free alternative that fits)  · Workplace then books it
  ☀️ briefing  /briefing or BRIEFING_AT: spoken rundown of what's waiting on you
```

- **Parallel:** `schedule` launches every step whose dependencies are done. Independent steps (e.g. RSVPs and the room booking) run at the same time.
- **Briefings:** each agent gets the results of everything upstream. The approval agent reprices from the RSVP headcount, the voice agent orders the right quantity, and the treasury agent pays against the approved amount.
- **Guardrails:** the treasury agent's ceiling is fixed before the model runs, and its tools enforce it again. They refuse unapproved vendors and unsupported rails, and they're idempotent per step (`logs/payments.json`). A denial is never retried, and a failure gets at most one retry.
- **Runner** (`src/graph/runner.ts`): spawns agents outside any graph run (from the orchestrator's interrupt payload), feeds their results back, cancels leftover agents when a request ends, and indexes every paused thread by the people it waits on.
- **Darwin:** with `DARWIN_URL` set, the human agent's first route asks `GET /route-hint` and follows *approved* rules only (`prefer`, and `redirects` when the route lands on `avoid`), telling the requester why.
- **Hops:** `src/graph/hops.ts` emits one `hop` event when the person holding a request acts on it (`bounced`, `delegated`, `forwarded` for approvals and escalations, `handled`), numbered per request across parallel agents. C's trigger turns them into `request_hops`.
- **Exactly-once sends:** `await_*` nodes only pause, because LangGraph re-runs a paused node on resume.
- Threads are checkpointed to SQLite (`logs/checkpoints.sqlite`) and restored at startup. The org map, identities, payments and vendor wallets persist in `logs/` (the map also in Tiger).

### Money

| Rail | Used for | Notes |
|---|---|---|
| Solana devnet | Vendors that accept `solana_devnet` (Greenleaf) | SOL transfer plus a memo `req/step …`, explorer link as the receipt. `SOLANA_SOL_PER_USD` scales dollars to devnet SOL |
| Nessie bill | Invoice or card vendors | On the requester's department account |
| Nessie transfer | Moving budget between departments | One Nessie checking account per department |
| Local ledger | Any Nessie call that fails | `logs/ledger.jsonl`, flagged `simulated` and shown to the user as such |

### Calls

With `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` and `VENDOR_PHONE` set, the voice agent places a real outbound call through ElevenLabs Conversational AI. Enable prompt and first-message overrides on the agent. Without them, a caller agent and a vendor-persona agent (grounded in the vendor's fixture data) role-play the call, and every message says "role-played".

## Data

| Store | What the agent does with it |
|---|---|
| **Snowflake** `PHOTON.ORG` | Runs as the `WAYFINDER_AGENT` service user (`SNOWFLAKE_AGENT_PAT`) and names a role on every statement. At startup: directory, budgets, vendors, policies, rooms as `PHOTON_FINANCE`; `person_roles` and `resolution_by_task_type` (typical hours and hops per task type, shown in plan messages) as `PHOTON_APP`. Falls back to `data/fixtures` and says so |
| Snowflake, per person | `new_hire_setup_metrics` (`VP_NEW_HIRE_SETUP`) and `request_history` (`requests`) run **as the asker's tier role**. Dana (PHOTON_VP) gets the numbers; Leo (PHOTON_EMPLOYEE) is refused by Snowflake, and the agent relays that without hinting at the data |
| **Tiger Data** (contract: `data/tiger/SCHEMA.md`) | Login `wayfinder_agent`. Inserts every event; C's `events_derive` trigger turns `request_created`, `hop` and `request_resolved/_denied/_stuck` into `requests` and `request_hops`, which Insights and Darwin read. Map changes upsert `org_edges` and add an `org_edge_changes` row (previous confidence, reason, request) in one transaction. Reads and releases `bookings`. The agent adopts `org_edges` at startup; `/reset` zeroes learned edges and restores chart confidences (it can't delete; a full wipe is C's `tiger:seed`). Sims and tests set `TIGER_DISABLED=1` |
| **SQLite** `logs/checkpoints.sqlite` | LangGraph checkpoints for every thread, plus `logs/runner.json` for the runner's registry. `restore()` at startup re-arms reminders and continues interrupted runs, so a restart mid-demo loses nothing (`scripts/restart-test.ts` proves it) |

HR task types (benefits, leave, employee relations) never go to the war room.

## Tools

`src/tools/` implements the shared `ToolIO` contract (`packages/shared`): `plan` (planner and critic), `route`, `check_permission`, `draft`. Paying and calling live in the treasury and voice agents. `match` (Mycelium) is a stub for Phase 3.

## Logs

`apps/agent/logs/` (gitignored): `events.jsonl` (every event), `edges.jsonl` (every edge change), `edges.json` (current map), `contacts.json` (identity bindings), `payments.json` (one payment per step), `ledger.jsonl` (offline Nessie writes), `vendor-wallets.json` (devnet addresses for fictional vendors), `hops.json` (hop numbering per request), `checkpoints.sqlite` and `runner.json` (durable threads). Lane B's live push hooks into `onLiveUpdate` in `src/events.ts`.

Spectrum carries voice *notes*. Live phone calls go through ElevenLabs (see Calls above).
