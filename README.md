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
- **Discover (Mycelium):** matches people's needs, skills, and unused resources, then introduces them. (Consent-first intros are planned: see [ideas.md](ideas.md).)
- **Evolve (Darwin):** replays past workflows and evolves better routing rules for admins to approve. (The web page shows a captured run today; live approval is in [ideas.md](ideas.md).)

## Tech stack

| Layer | Choice |
|---|---|
| Agent server | Node/TypeScript + `spectrum-ts` |
| Brain | Gemini with function calling |
| Voice | ElevenLabs over Spectrum voice calls |
| Org data | Snowflake (role-gated access: VP, manager, finance, HR tiers) |
| Live data | Tiger Data (Postgres, TimescaleDB, pgvector) |
| Money | Capital One Nessie (internal), Solana devnet (external + receipts) |
| Website | Next.js 14, Frutiger Aero kit (`docs/design/v6`), three.js, d3, GSAP, Recharts |
| Evolution | Python, FastAPI, genetic algorithm over replayed history |

## Layout

```
apps/
  agent/      # Spectrum + Gemini graphs + voice + money tools, HTTP for the web  (A)
  web/        # Next.js site: the six v6 Aero pages, live from Tiger + agent SSE   (B)
services/
  darwin/     # Python replay + evolution API                                     (C)
data/
  fixtures/   # simulated company (JSON → Snowflake / Tiger)                      (C)
  tiger/      # Tiger schema, roles, seed (SCHEMA.md is the contract)              (C)
  snowflake/  # Snowflake load, roles, verify                                     (C)
packages/
  shared/     # shared contracts: records, events, edges, live updates, WF view   (all)
docs/design/  # Aero design system; v6 is the target
```

## Team

| Person | Role | Owns | Tracks |
|---|---|---|---|
| **A** | Fullstack + AI | Agent and conversation: Spectrum, Gemini tool loop, approvals, group threads, ElevenLabs, Nessie/Solana tools | Photon, Gemini, ElevenLabs, Solana, Nessie |
| **B** | Fullstack + AI | Website and discovery: Next.js + Aero design, live push to browser, all pages, Mycelium matching, landing page | Frutiger Aero, Community, Best .Tech |
| **C** | Data | Data and intelligence: simulated company, Snowflake roles, Tiger Data + Insights queries, Darwin, demo script + Devpost | Snowflake, Tiger Data, Commit, DEV |

## Shared contracts (agree in the first 30 minutes)

1. **Event schema:** the shape of every logged event. A writes events, C stores them, and B renders them.
2. **Org map edge:** `{ from, to, task_type, confidence, source: "chart" | "learned", delegate_until? }`
3. **Tool signatures:** the Gemini functions `plan`, `route`, `check_permission`, `draft`, `pay`, `call`, `match`.
4. **Live update payload:** what the website receives when anything changes.

## Execution plan

| Phase | Hours | A (Agent) | B (Web) | C (Data) |
|---|---|---|---|---|
| 0 · Foundations | 0–2 | Spectrum + Gemini keys, voice handoff test | Next.js scaffold, Aero tokens | **JSON fixtures by hour 1**, then Snowflake + Tiger Data |
| 1 · Coordination core | 2–8 | Tool loop, routing, redirects/delegates, approvals | Roots, Currents, live push | Event log, map storage, Insights queries |
| **Gate** | **8** | **Use case 1 runs end to end (must ship)** | | |
| 2 · Full use cases | 8–14 | Nessie, Solana, ElevenLabs calls, group threads/RSVPs | Currents, Insights | VP role check, seed use cases 2 & 3 |
| 3 · Discover and Evolve | 14–19 | Incident flow, hardening | Lagoon (Mycelium matching), Darwin page | Darwin replay + evolution |
| 4 · Polish and submit | 19–24 | Rehearse phone parts | Landing page, backup video | Demo script, Devpost, DEV post, Commit form |

If a gate slips, everyone works on it together before moving to the next phase.

## Scope

- **Must ship:** iMessage agent, self-learning map, approvals by text, group threads, seeded company, event log, Roots + Currents + Insights pages
- **Should ship:** Nessie, Solana, ElevenLabs calls, Lagoon intros, full Aero styling, simple Darwin
- **Stretch:** consent intros and live Darwin approval ([ideas.md](ideas.md)), multilingual voice, policy-doc → rules, campus mode
- **Out of scope:** real company systems, real money, production-grade security

## Repo layout

Package manager: npm workspaces (`apps/*`, `packages/*`), Node 20+. Darwin is Python.

| Folder | Owner | Contents |
|---|---|---|
| `apps/agent/` | A | Agent server: Spectrum, Gemini tool loop, approvals, ElevenLabs, Nessie, Solana |
| `apps/web/` | B | Next.js site: Home Tree, Roots, Currents, Insights, Lagoon, Darwin (see [web pages](#web-pages)). This is the website; the agent's separate `web.ts` server from the `version7` branch is not used |
| `packages/shared/` | all | Shared TypeScript contracts: `Request`, `Hop`, `Event`, `OrgEdge`, `LiveUpdate`, agent HTTP API, and the web's `WF` view model |
| `data/fixtures/` | C | Simulated company fixtures (JSON → Snowflake / Tiger Data) |
| `services/darwin/` | C | Python replay + evolution API; `models.py` mirrors the shared contracts |


Setup: `npm install`, then `npm run typecheck`. Copy `.env.example` to `.env` for keys (one value per line: a wrapped value is cut off at the line break).

## Running it

```bash
npm run dev -w @wayfinder/agent          # agent on :8787 (iMessage + terminal); GET /live, POST /say, POST /intro
npm run dev -w @wayfinder/web            # website on :3000; reads Tiger as wayfinder_web, falls back to data/fixtures
npm run wf:check -w @wayfinder/web       # the web adapter reproduces Tiger's Insights numbers
npm run sim -w @wayfinder/agent          # scripted scenarios; uses apps/agent/logs-sim/, never touches live state
```

## Web pages

| Page | Route | Shows |
|---|---|---|
| Home Tree | `/` | Headline numbers from real history and live requests |
| Roots | `/roots` | The org (departments → teams → people), your requests, cross-team handoffs |
| Currents | `/currents?q=<id>` | One request end to end: hops, what Wayfinder learned, every message; compose as the viewer |
| Insights | `/insights` | Hours lost to "not us", hops before vs after, where requests flow |
| Lagoon | `/lagoon` | People who share your skills, open asks, unused rooms; Introduce texts both people |
| Darwin | `/darwin` | Routing rules evolved from replayed history (captured run) |

Add `?me=p_nina` to view as someone else and `?notour` to skip the first-visit tour.

Testing over iMessage: [docs/phase3-runbook.md](docs/phase3-runbook.md). What we've learned (how Wayfinder learns, Photon quirks, setup gotchas): [docs/learnings/](docs/learnings/README.md).
