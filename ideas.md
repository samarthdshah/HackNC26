# Ideas and deferred work

Things we chose not to build yet. Each entry says what it is, why it waited, and where it would plug in.

## Consent-based intros (Mycelium v2)

**What:** Lagoon's Introduce asks both people first ("Tom also works in SQL. Want an intro? yes/no"), and the intro goes out only when both say yes. This is what the original README promised.

**Today:** Introduce sends the intro immediately (`POST /intro` in `apps/agent/src/server.ts` → `openGroup` + `intro_sent` event).

**How:** add an `intro` specialist graph in `apps/agent/src/graph/agents/` modelled on `rsvp.ts`. It asks both people, waits on two replies, and emits `intro_requested` / `intro_accepted` / `intro_declined` / `intro_sent`. `/intro` would start that graph instead of sending directly. Lagoon then shows a "waiting on Tom" state from those events.

## Darwin live integration (done)

**Done:** the Darwin page is live whenever the agent reaches Darwin, with per-generation approve and reject (CodeRockerr's version7 mechanism, moved into our stack):
- Agent `GET /darwin` (`apps/agent/src/data/evolution.ts`): Darwin's `/runs/latest` as generations, each with real `avgHops` from `POST /replay`
- Agent `POST /darwin/generations/:gen/approve|reject`: records a `darwin_generation_approved|rejected` event via `emit()` (Tiger, `events.jsonl`, `/live`), then pushes the approved generations' rules to Darwin's `/rules/{id}/approve|reject`. The agent re-pushes when Darwin restarts, so approvals survive it.
- Web proxies: `/api/agent/darwin` and `/api/agent/darwin/:gen/:action`. With Darwin down, the page falls back to the snapshot with the buttons disabled.

**Still deferred:** re-evolve (`POST /evolve`) after new live requests.

**Open questions (Lane C):**
- Is "checkout orders pipeline failed" a `checkout_incident` or a `pipeline_issue`? This decides whether the Darwin checkout rule fires in the delegate scenario.
- Rule 3 (onboarding skips People Ops) has no desk/badge task type to attach to.

## Solana simulated fallback

Nessie falls back to a local ledger when it's unreachable, but Solana throws, so the payment step fails. That doesn't matter while `SOLANA_SECRET_KEY` is set. If devnet is flaky on demo day, mirror Nessie's fallback in `apps/agent/src/money/solana.ts`: write `logs/ledger.jsonl` with `simulated: true`.

## Real group threads

`openGroup` (`apps/agent/src/messenger.ts`) makes a real iMessage group only when at least 2 members are bound to iMessage phones. With one test phone, RSVPs and intros fan out as DMs. Once there are 2 or more phones, bind Leo and Victor to separate phones (`/iam`) to demo the welcome-lunch RSVP as a real group.
