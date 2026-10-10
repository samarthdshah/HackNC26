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
| `npm run sim` | Scripted demo flows through the real graphs and Gemini, no Spectrum. `npm run sim -- "welcome lunch"` runs one. Reminders: `REMINDER_MS=4000 MAX_REMINDERS=1 npm run sim -- reminders` |
| `npm run voice:test -- "text"` | Sends an ElevenLabs voice note to `DEMO_PHONE` over iMessage |

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
  ☀️ briefing  /briefing or BRIEFING_AT: spoken rundown of what's waiting on you
```

- **Parallel:** `schedule` launches every step whose dependencies are done. Independent steps (e.g. RSVPs and the room booking) run at the same time.
- **Briefings:** each agent gets the results of everything upstream. The approval agent reprices from the RSVP headcount, the voice agent orders the right quantity, and the treasury agent pays against the approved amount.
- **Guardrails:** the treasury agent's ceiling is fixed before the model runs, and its tools enforce it again. They refuse unapproved vendors and unsupported rails, and they're idempotent per step (`logs/payments.json`). A denial is never retried, and a failure gets at most one retry.
- **Runner** (`src/graph/runner.ts`): spawns agents outside any graph run (from the orchestrator's interrupt payload), feeds their results back, cancels leftover agents when a request ends, and indexes every paused thread by the people it waits on.
- **Exactly-once sends:** `await_*` nodes only pause, because LangGraph re-runs a paused node on resume.
- Threads are checkpointed in memory (`MemorySaver`). The org map, identities, payments and vendor wallets persist in `logs/`.

### Money

| Rail | Used for | Notes |
|---|---|---|
| Solana devnet | Vendors that accept `solana_devnet` (Greenleaf) | SOL transfer plus a memo `req/step …`, explorer link as the receipt. `SOLANA_SOL_PER_USD` scales dollars to devnet SOL |
| Nessie bill | Invoice or card vendors | On the requester's department account |
| Nessie transfer | Moving budget between departments | One Nessie checking account per department |
| Local ledger | Any Nessie call that fails | `logs/ledger.jsonl`, flagged `simulated` and shown to the user as such |

### Calls

With `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` and `VENDOR_PHONE` set, the voice agent places a real outbound call through ElevenLabs Conversational AI. Enable prompt and first-message overrides on the agent. Without them, a caller agent and a vendor-persona agent (grounded in the vendor's fixture data) role-play the call, and every message says "role-played".

## Tools

`src/tools/` implements the shared `ToolIO` contract (`packages/shared`): `plan` (planner and critic), `route`, `check_permission`, `draft`. Paying and calling live in the treasury and voice agents. `match` (Mycelium) is a stub for Phase 3.

## Logs

`apps/agent/logs/` (gitignored): `events.jsonl` (every event), `edges.jsonl` (every edge change), `edges.json` (current map), `contacts.json` (identity bindings), `payments.json` (one payment per step), `ledger.jsonl` (offline Nessie writes), `vendor-wallets.json` (devnet addresses for fictional vendors). Lane B's live push hooks into `onLiveUpdate` in `src/events.ts`.

Spectrum carries voice *notes*. Live phone calls go through ElevenLabs (see Calls above).
