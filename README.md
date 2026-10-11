# Avatar

Text a request. Avatar finds the person who owns it and sees it through.

Built at HackNC 2026.

## Inspiration

At work, the hard part is often not the task. It is finding who owns it. You ask one team, they say "not us," and you start over. New hires feel this most. In our simulated company, the last 10 new hires took an average of 4.01 days and 6.00 hops to get set up.

Tools like Glean connect people to information. We wanted a tool that connects people to people.

## What it does

You text Avatar in iMessage. It breaks your request into steps and sends each step to the person or team that owns it.

- **Learns the org map from replies.** When someone writes "not us, try Procurement," Avatar reroutes the step. It lowers the old route's confidence score and saves the new route. When someone writes "Priya's out, ask Tom," it saves a delegate until Priya is back.
- **Handles approvals by text.** It applies the spend policy to find who must sign off, then texts them. They reply APPROVE or DENY. If they go quiet, it nudges them, then goes to their manager.
- **Pays for approved requests.** It pays the vendor or moves budget between teams, up to the approved amount and no more.
- **Shows its work.** A live dashboard shows the org map, the path of each request, and the teams where requests sit longest.
- **Gets better over time.** Darwin replays past requests and suggests routing rules. An admin approves them on the Darwin page, and Avatar routes by them.
- **Connects people with shared work.** The Lagoon page shows people who ask about the same topics. Tap Introduce and it texts both of them.

## How we built it

- **Agent:** A TypeScript server. Photon Spectrum (`spectrum-ts`) links it to iMessage and a terminal chat. Gemini reads each text, plans the steps, and writes the asks. It sorts each reply as done, redirect, delegate, deny, or question. Short replies like APPROVE and DONE skip the model. LangGraph runs one thread per request and one agent per step. There are six kinds of step agent: task, approval, payment, call, RSVP, and room. Threads save to SQLite, so a request picks up where it left off after a restart.
- **Web:** Next.js 14 with three.js, d3, GSAP, and Recharts. It has six pages. Home gives the top numbers. Roots shows the org map. Currents follows one request from start to end. Insights shows where time goes. Lagoon shows shared topics, and Darwin shows the rules. The agent pushes each change to the browser over server-sent events (SSE).
- **Data:** A made-up company called Photon, stored as JSON. It has 10 departments and 24 people. It has 6 rooms, 6 vendors, 8 budget lines, and 11 policies. It starts with 35 map edges and holds 84 requests with 256 hops. A check script works out the demo numbers from this data.
- **Snowflake:** Holds the staff list, budgets, vendors, policies, rooms, and past requests. Six roles set what each person can see: employee, manager, finance, HR, HR head, and VP. A masking policy hides HR text. The agent runs each question as the role of the person who asked. When the VP asks why new hires take so long, Snowflake gives the numbers. When a new hire asks, Snowflake says no.
- **Tiger Data:** Postgres with TimescaleDB holds the live side. Each agent action is a row in an `events` hypertable. A trigger turns events into requests and hops. SQL views answer the Insights questions: where work gets stuck, which handoffs are slow, and how many hours we save. The org map and its change log live here too.
- **Darwin:** A Python service built on FastAPI. It replays past requests under new rule sets. A genetic algorithm looks for the best set of up to 3 rules. Before each route, the agent asks Darwin for a hint. Only approved rules count.
- **Payments:** The Capital One Nessie sandbox holds the money. Each team has its own account. Invoice and card vendors get bills, and budget moves are transfers. Vendors that take Solana get paid on devnet, with a memo that ties the payment to the request. If Nessie is down, it writes to a local ledger and marks the entry as simulated.
- **Voice:** ElevenLabs turns summaries and daily briefs into voice notes sent over iMessage. With the right keys, it can call a vendor on the phone through ElevenLabs Conversational AI. Without them, two agents act out the call, and the text says so.

### What Darwin found

Darwin replayed 83 resolved requests and proposed 3 rules:

1. Page Platform Engineering first for checkout incidents.
2. Send dashboard requests to Analytics Engineering first.
3. For onboarding, skip People Ops and go to Workplace.

Together they save 217.2 hours (7.3%), 16 hops, and 12 bounces in replay. A brute-force check of all 28 possible rule sets picked the same 3. The data backs rule 1. Checkout incidents paged to Platform first took 43 minutes on average. Those routed through other teams took 233.

## Challenges we ran into

- **No Snowflake Cortex.** We planned to use Cortex for policy questions, but our trial account did not have it. So Gemini answers from data the agent pulls from Snowflake.
- **One token, many roles.** The agent's Snowflake token is locked to its own role, and that lock wins over the default role. So the agent names a role on every SQL statement.
- **Paused graphs run twice.** LangGraph runs a paused step again when it resumes. To keep from sending a text twice, our wait steps pause and do nothing else.
- **Devnet quirks.** Solana devnet turned down our v1 transfers, so we send v0.
- **One agent per Photon project.** Photon sends each text to every agent that is connected. When two of us ran the agent at the same time, each request ran twice.
- **Data that tells a true story.** The fake history needed real bounce chains, and every demo number had to come from it.

## Accomplishments that we're proud of

- One agent runs the whole loop over iMessage: request, route, "not us" reroutes, approvals, payment, and receipt. [CONFIRM: tested end to end on a real phone]
- The database guards access. Snowflake, not our app code, turns away a new hire who asks for VP data.
- Every demo number comes from queries on past requests. Scripts check them: the fixture check, the web's `wf:check`, and Darwin's `check.py`.
- Two kinds of learning that don't clash. The agent learns from single replies. Darwin learns from all past requests. Darwin may not suggest data access rules. That keeps the live demo of learning clear.
- Limits on money. The payment agent's cap is set before the model runs, and each step can pay once.

## What we learned

[Team: one or two lines each]

## What's next

- Ask both people before an intro. Today, Introduce sends it at once.
- Run Darwin again as live requests come in. Today, it evolves rules when it starts.
- Back the approval check with Snowflake roles. Today, it reads the policy from the JSON data.
- Add a local ledger fallback for Solana, like the one for Nessie.
- Use real group threads for RSVPs and intros. With one test phone, these go out as separate texts.

## Note on data

Photon is a made-up company. Its people, vendors, budgets, policies, and past requests are simulated. The data covers May 1 to October 9, 2026. Avatar touches no real systems and moves no real money. Nessie is a sandbox, and Solana runs on devnet.

## Tools and credits

- We used Claude Code and ChatGPT Codex as AI coding assistants.
- Parts of the UI took inspiration from CodePen. [CONFIRM: which pens, with authors and links]
- Built with Photon Spectrum, Gemini, ElevenLabs, Capital One Nessie, Solana, Snowflake, and Tiger Data.
- Libraries: LangGraph, Next.js, three.js, d3, GSAP, Recharts, FastAPI, and node-postgres.

## Running it locally

The code uses the project's earlier name, Wayfinder, in package names such as `@wayfinder/agent`.

You need Node 20+ (the data scripts need Node 22.6+) and Python 3.11+.

### Setup

```bash
npm install
cp .env.example .env   # fill in keys; keep each value on one line
```

### Data (Snowflake and Tiger Data)

```bash
npm --prefix data install
npm --prefix data run check              # validate fixtures and print the demo numbers
npm --prefix data run snowflake:verify   # test Snowflake access
npm --prefix data run snowflake:load     # load the company into Snowflake
npm --prefix data run snowflake:roles    # roles, grants, masking; rerun after every load
npm --prefix data run tiger:seed         # schema, fixtures, and checks on Tiger Data
npm --prefix data run tiger:roles        # agent and web logins
```

### Agent

```bash
npm run check:keys -w @wayfinder/agent   # one check per service
npm run dev -w @wayfinder/agent          # iMessage + terminal; HTTP on :8787
npm run terminal -w @wayfinder/agent     # terminal chat only, no phone needed
npm run sim -w @wayfinder/agent          # scripted demo flows, no live state
```

Each phone or terminal plays one person from the data. Text `/iam tom` from a phone, or type `/as leo` in the terminal.

### Web

```bash
npm run dev -w @wayfinder/web            # http://localhost:3000
npm run wf:check -w @wayfinder/web       # check the web numbers against Tiger's Insights
```

The site reads Tiger Data when it can and falls back to the JSON data when it can't.

### Darwin

```bash
cd services/darwin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py                  # http://localhost:8100; needs TIGER_DATABASE_URL and TIGER_WEB_PASSWORD
.venv/bin/python check.py endpoints      # with the service running
```

Set `DARWIN_URL=http://localhost:8100` in `.env` so the agent uses approved rules.

More detail: [apps/agent/README.md](apps/agent/README.md), [data/fixtures/README.md](data/fixtures/README.md), [services/darwin/PLAN.md](services/darwin/PLAN.md), and [docs/learnings/](docs/learnings/README.md).
