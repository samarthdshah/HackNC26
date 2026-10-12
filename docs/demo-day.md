# Demo day run-through

One laptop runs everything. One phone texts as the person the demo is about. The auto-reply script plays everyone else.

## Before judges arrive

**Only one agent per Photon project.** If anyone else has `apps/agent` running, every text is handled twice and the extra copy escalates on its own. Stop it first.

Keep the laptop **awake and plugged in**. Sleep drops the Photon connection; see "If something goes wrong".

### Fresh start (about 2 minutes)

```bash
# 1. Stop the agent if it's running (Ctrl+C), then clear its memory
mv apps/agent/logs apps/agent/logs-backup-$(date +%H%M%S)

# 2. Reset Tiger to the seeded company (ends with "PASS: committed")
npm --prefix data run tiger:seed
```

### Start (four terminals)

```bash
npm run dev -w @wayfinder/agent                       # T1: agent, wait for "[agent] up"
npm run dev -w @wayfinder/web                         # T2: http://localhost:3000
(cd services/darwin && .venv/bin/python app.py)       # T3: Darwin on :8100
npm run autoreply -w @wayfinder/agent -- lunch        # T4: plays everyone except the phone
```

Check: `curl localhost:3000/api/health` shows `"agent":{"ok":true` and `"requests":83`.

**T4 runs one scenario at a time.** Before each demo, Ctrl+C it and restart it with that demo's scenario name (the table below).

## The three demos

| # | Demo | T4 scenario | Phone texts | What happens on its own | Show on the website | Tested |
|---|---|---|---|---|---|---|
| 1 | **Leo's first day**: it learns who really does what | `leo` | `/iam leo`, then: *hey! can I get warehouse access for my first analysis? just need the curated marts*. Then: *who handles data access requests now?* | Raj: "not us" → reroute → Tom covers for Priya → done; "Wayfinder learned" toast. The follow-up names Analytics Engineering / Tom | `/roots`, `/currents`, `/insights` | ⚠️ not run today |
| 2 | **Team lunch**: one text sets up a whole event | `lunch` | `/iam nina`, then: *Set up a welcome lunch for Leo with the Commerce team on Tuesday from Greenleaf, check who's coming first* | RSVPs → prices for headcount (6-person minimum, $132) → Luis books The Commons → Dana approves → caterer call → Solana payment | `/currents?me=p_nina`; the Solana explorer link from the last text | ✅ ~1:45 |
| 2b | **Budget transfer** (Nessie), same persona | `transfer` | *Move $300 from Commerce's team events budget to Workplace for snacks* | Maya approves as the other budget owner (POL-SPEND-2) → Nessie transfer | `/currents?me=p_nina` | ✅ ~45 s |
| 3 | **Checkout outage**: it finds the right hands fast | `outage` | `/iam sam`, then: *the checkout orders pipeline failed overnight, dashboards are empty* | Elena hands it to Raj → Raj fixes it; delegate toast | `/currents` | ⚠️ not run today |

## Show the website as someone else

The website shows **Leo** by default. Add `?me=<person id>` to any page to see it as someone else. It only applies to that page and isn't remembered when you click to another one, so use the full links. Add `&notour` to skip the first-visit tour.

| Demo | Person | Links |
|---|---|---|
| 1 | Leo (asks) | [Roots](http://localhost:3000/roots?me=p_leo&notour) · [Currents](http://localhost:3000/currents?me=p_leo&notour) |
| 1 | Raj (says "not us") | [Currents](http://localhost:3000/currents?me=p_raj&notour) |
| 1 | Tom (grants access) | [Currents](http://localhost:3000/currents?me=p_tom&notour) |
| 2 | Nina (asks) | [Home](http://localhost:3000/?me=p_nina&notour) · [Roots](http://localhost:3000/roots?me=p_nina&notour) · [Currents](http://localhost:3000/currents?me=p_nina&notour) |
| 2 | Dana (approves the lunch) | [Currents](http://localhost:3000/currents?me=p_dana&notour) |
| 2b | Maya (approves the transfer) | [Currents](http://localhost:3000/currents?me=p_maya&notour) |
| 3 | Sam (reports the outage) | [Roots](http://localhost:3000/roots?me=p_sam&notour) · [Currents](http://localhost:3000/currents?me=p_sam&notour) |
| 3 | Elena → Raj (handoff) | [Elena](http://localhost:3000/currents?me=p_elena&notour) · [Raj](http://localhost:3000/currents?me=p_raj&notour) |
| any | Same for everyone | [Insights](http://localhost:3000/insights?notour) · [Lagoon](http://localhost:3000/lagoon?me=p_leo&notour) · [Darwin](http://localhost:3000/darwin?notour) |

On Currents, the compose box sends a message **as the person in `?me=`**. That's a quick way to answer for someone without the terminal: open `?me=p_dana` and type `approve`.

<details><summary>All person ids</summary>

| Team | People |
|---|---|
| Commerce | `p_nina` Nina (manager) · `p_leo` Leo · `p_sam` Sam · `p_victor` Victor |
| Platform | `p_dana` Dana (VP) · `p_marcus` Marcus (manager) · `p_aisha` Aisha |
| Data Platform | `p_raj` Raj (manager) · `p_elena` Elena |
| Analytics Engineering | `p_priya` Priya (manager) · `p_tom` Tom · `p_zoe` Zoe |
| Workplace | `p_maya` Maya (manager) · `p_luis` Luis |
| Finance | `p_hannah` Hannah · `p_ben` Ben |
| IT | `p_jess` Jess (manager) · `p_ken` Ken |
| People Ops | `p_grace` Grace (manager) · `p_omar` Omar |
| HR | `p_teresa` Teresa (manager) · `p_andre` Andre |
| Legal | `p_felix` Felix (manager) · `p_imani` Imani |

</details>

After any demo: **Insights** (hours saved, bottlenecks), **Lagoon** (people with shared topics; Introduce texts both), **Darwin** (approve or reject an evolved generation).

Type the team name exactly: "conference team" instead of "Commerce team" stops the RSVP step ("couldn't work out who to invite").

## If a judge asks

| Topic | T4 scenario | Phone texts | What happens | Tested |
|---|---|---|---|---|
| **Who can see what** (Snowflake) | none | `/iam dana`: *Why do new hires take so long to get set up?* then `/iam leo` and the same text | Dana gets 4.01 days / 6 hops; Leo is refused. `/insights` shows the same numbers | ⚠️ |
| **Private HR request** | `leave` | `/iam victor`: *I need to request two weeks of parental leave starting next month* | Andre approves; every text shows `[visible to HR only]` on the website | ⚠️ |

## If something goes wrong

| Symptom | Fix |
|---|---|
| Laptop slept; texts get no reply; T1 shows `ECONNRESET` / "reconnecting" with no "recovered" | Ctrl+C T1 and start it again. T4 reconnects by itself |
| Duplicate replies, or escalations nobody asked for | A second agent is connected somewhere. Stop it |
| The agent says it's stuck or can't find someone | Send a new, corrected text. Replying to the stuck one won't restart it |
| A reply went to the wrong request | Text `/status`, then answer with the number, e.g. `DONE 2` |
| "I can't think right now" | Gemini is down or out of quota. Fix it, then text `/retry` |
| Nobody answers for a persona | Answer by hand: `curl -X POST localhost:8787/say -H 'content-type: application/json' -d '{"as":"p_maya","text":"approve"}'` |
| Website frozen | `curl localhost:3000/api/health`. `agent.ok: false` means T1 is down |
