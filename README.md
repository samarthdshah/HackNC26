# Wayfinder OS

**Discover. Connect. Coordinate. Evolve.**

Wayfinder OS is an AI coordinator that lives in iMessage. You tell it a goal and it finds the people, resources, and approvals needed to make it happen. Along the way it learns how your organization really works.

Built at HackNC 2026.

## How it works

One agent server handles every surface. People talk to it over iMessage, voice calls, the website, or the terminal. Photon Spectrum brings all of those conversations into one Node/TypeScript server. Gemini decides what to do next, and the server carries it out by calling the sponsor tools.

```
iMessage · Voice · Website · Terminal
              │
        Photon Spectrum
              │
   Wayfinder agent server (Gemini brain)
              │
 Snowflake · Tiger Data · ElevenLabs · Nessie · Solana · Darwin
```

Three engines:

- **Coordinate (Wayfinder):** breaks a goal into steps, sends each step to its real owner, and handles approvals, payments, and reminders.
- **Discover (Mycelium):** matches people's needs, skills, and unused resources, then introduces them once they consent.
- **Evolve (Darwin):** replays past workflows and evolves better routing rules, which admins approve.

## Tech stack

| Layer | Choice |
|---|---|
| Agent server | Node/TypeScript + `spectrum-ts` |
| Brain | Gemini with function calling |
| Voice | ElevenLabs over Spectrum voice calls |
| Org data | Snowflake + Cortex |
| Live data | Tiger Data (Postgres, TimescaleDB, pgvector) |
| Money | Capital One Nessie (internal), Solana devnet (external + receipts) |
| Website | Next.js, Tailwind (Frutiger Aero theme), React Flow, Framer Motion, Recharts |
| Evolution | Python, NetworkX, genetic algorithm |

## Planned layout

```
apps/
  agent/      # Spectrum + Gemini tool loop + voice + money tools     (A)
  web/        # Next.js site, Mycelium graph, dashboards               (B)
services/
  darwin/     # Python replay + evolution API                         (C)
data/
  seed/       # simulated company fixtures (JSON → Snowflake/Tiger)   (C)
packages/
  types/      # shared contracts: events, edges, tools, live updates (all)
```

## Team

| Person | Role | Owns | Tracks |
|---|---|---|---|
| **A** | Fullstack + AI | Agent and conversation: Spectrum, Gemini tool loop, approvals, group threads, ElevenLabs, Nessie/Solana tools | Photon, Gemini, ElevenLabs, Solana, Nessie |
| **B** | Fullstack + AI | Website and discovery: Next.js + Aero design, live push to browser, all pages, Mycelium matching + consent, landing page | Frutiger Aero, Community, Best .Tech |
| **C** | Data | Data and intelligence: simulated company, Snowflake + Cortex, Tiger Data + Insights queries, Darwin, demo script + Devpost | Snowflake, Tiger Data, Commit, DEV |

## Shared contracts (agree in the first 30 minutes)

1. **Event schema:** the shape of every logged event. A writes events, C stores them, and B renders them.
2. **Org map edge:** `{ from, to, task_type, confidence, source: "chart" | "learned", delegate_until? }`
3. **Tool signatures:** the Gemini functions `plan`, `route`, `check_permission`, `draft`, `pay`, `call`, `match`.
4. **Live update payload:** what the website receives when anything changes.

## Execution plan

| Phase | Hours | A (Agent) | B (Web) | C (Data) |
|---|---|---|---|---|
| 0 · Foundations | 0–2 | Spectrum + Gemini keys, voice handoff test | Next.js scaffold, Aero tokens | **JSON fixtures by hour 1**, then Snowflake + Tiger Data |
| 1 · Coordination core | 2–8 | Tool loop, routing, redirects/delegates, approvals | Chat, Mycelium graph, live push | Event log, map storage, Insights queries |
| **Gate** | **8** | **Use case 1 runs end to end (must ship)** | | |
| 2 · Full use cases | 8–14 | Nessie, Solana, ElevenLabs calls, group threads/RSVPs | Plan view, Wallet, Insights | Cortex Q&A, VP role check, seed use cases 2 & 3 |
| 3 · Discover and Evolve | 14–19 | Incident flow, hardening | Mycelium matching + consent, Lab | Darwin replay + evolution |
| 4 · Polish and submit | 19–24 | Rehearse phone parts | Landing page, backup video | Demo script, Devpost, DEV post, Commit form |

If a gate slips, everyone works on it together before moving to the next phase.

## Scope

- **Must ship:** iMessage agent, self-learning map, approvals by text, group threads, seeded company, event log, Chat + Mycelium + Insights pages
- **Should ship:** Nessie, Solana, ElevenLabs calls, consent intros, Plan view + Wallet, full Aero styling, simple Darwin
- **Stretch:** Lab / Time Machine, multilingual voice, policy-doc → rules, campus mode
- **Out of scope:** real company systems, real money, production-grade security

## Repo layout

Package manager: npm workspaces (`apps/*`, `packages/*`), Node 20+. Darwin is Python.

| Folder | Owner | Contents |
|---|---|---|
| `apps/agent/` | A | Agent server: Spectrum, Gemini tool loop, approvals, ElevenLabs, Nessie, Solana |
| `apps/web/` | B | Next.js site, Mycelium graph and matching, Insights, landing page |
| `packages/shared/` | all | Shared TypeScript contracts: `OrgEdge`, `Event`, `LiveUpdate`, `ToolName` (draft) |
| `data/fixtures/` | C | Simulated company fixtures (JSON → Snowflake / Tiger Data) |
| `services/darwin/` | C | Python replay + evolution API; `models.py` mirrors the shared contracts |

Note: `data/fixtures/` and `packages/shared/` replace `data/seed/` and `packages/types/` from the planned layout above.

Setup: `npm install`, then `npm run typecheck`. Copy `.env.example` to `.env` for keys.
