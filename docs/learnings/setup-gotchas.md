# Setup gotchas

These are the things that broke or confused us while wiring everything together, and the fix for each.

*Written 2026-10-11.*

## `.env`: one value per line

A pasted value that wraps onto a second line is **cut off at the break**, and the tail becomes a junk line. This broke `TIGER_DATABASE_URL` (host cut at `…tsd`), `SNOWFLAKE_AGENT_PAT` (401 invalid token) and `SOLANA_SECRET_KEY` (invalid JSON).

- **Duplicate keys:** the **last** definition wins. A fixed copy higher up is ignored if the old broken one is still below it.
- **Check:** from the repo root, `awk 'length($0)>0 && $0 !~ /^[A-Z_]+=/ && $0 !~ /^#/ {print NR}' .env` should print nothing. Then `npm run check:keys -w @wayfinder/agent`.

## The sim must not touch live state

`npm run sim` resets the org map and the request state, and binds 15 personas to fake handles. It used to share `apps/agent/logs/` with the real agent, so running it wiped live requests and stole phone bindings.

**Fix:** state lives wherever `WAYFINDER_LOGS_DIR` points (`apps/agent/src/logs.ts`). The sim uses `logs-sim/`. All `apps/agent/logs*/` folders are gitignored.

## How the website gets its numbers

- The website computes **every** number in one place (`apps/web/lib/wf/build.ts`), from raw rows that come either from Tiger (read-only, as `wayfinder_web`) or from `data/fixtures`. One code path means the two sources can't disagree.
- `npm run wf:check -w @wayfinder/web` checks the fixtures against the seed values in `data/tiger/SCHEMA.md`. When Tiger is reachable, it also compares against Tiger's own `insights_*` views.
- If Tiger is unreachable, the site falls back to the fixtures plus the agent's local `events.jsonl`. `/api/health` shows which source is in use.
- Fresh Tiger has **no request for Leo**: it's created live when he texts (`LIVE_ONLY` in `data/tiger/seed.ts`). An empty Roots list before the demo is correct.

## Fresh run

1. Stop the agent everywhere (see [one agent per project](imessage-photon.md#one-agent-per-photon-project)).
2. Move `apps/agent/logs/` aside. Learned edges and phone bindings live there and in Tiger.
3. `npm --prefix data run tiger:seed`. It uses the owner URL in `.env`, rebuilds every table, and runs Lane C's own checks.
4. Restart Darwin (it caches history at start) and the agent.
5. `npm run wf:check -w @wayfinder/web`, then open `/roots`: Leo should have 0 requests.

## Small things

- **npm 11** blocks package install scripts. Everything still worked, including `better-sqlite3` for checkpoints, but `npm install-scripts ls` shows what was skipped if something native breaks.
- **Answering questions:** the agent's Q&A loop has 6 tool turns. When it runs out, it now answers from what it found instead of replying "can you rephrase?" (`apps/agent/src/brain/gemini.ts`).
