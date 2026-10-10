# Tiger Data schema reference

For lanes A (agent server) and B (website). Lane C owns this database. **This file is the contract.** [PLAN.md](PLAN.md) is the earlier design and is superseded.

- Tiger Data: Postgres 18 with TimescaleDB 2.30. Everything is in the `public` schema.
- Built by `data/tiger/schema.sql` and loaded by `npm --prefix data run tiger:seed`. The seed drops and recreates everything and fails without committing if any demo row or Insights number is wrong.
- All data is simulated (the fictional company Photon). The demo date is 2026-10-10.
- **Access:** each lane has its own login; see [Logins](#logins). Connection details and passwords come from lane C directly, never from this file.
- **Who writes what:** A writes events only (plus edges and bookings). A trigger on `events` turns A's `request_created`, `hop` and `request_resolved`/`_denied`/`_stuck` events into `requests` and `request_hops` rows, so Insights move live (see [Live path](#live-path-events-trigger)). A computes each edge's final confidence and upserts `org_edges` itself, with one `org_edge_changes` row per change. There is no database-side learning function.

## Things to know before querying

- **Column names:** `from_id` and `to_id` stand in for the shared `OrgEdge.from` and `OrgEdge.to`, because `from` and `to` are reserved in SQL. Map them back in API code.
- **Times:** all `timestamptz`. node-postgres returns JS `Date`. Use `.toISOString()` for the shared ISO 8601 strings.
- **Numbers:** node-postgres returns `numeric` and `bigint` as **strings** (`"4.01"`, `"43"`). `int` and `real` come back as numbers. Every Insights value that is rounded is `numeric`, so call `Number(...)` before charting. Counts are cast to `int`.
- **Live numbers:** the Insights views are plain views over the live tables, not cached. A new or resolved request changes them on the next query. History stats count only `status = 'resolved'` requests.
- **HR text:** HR request types are `leave_request`, `benefits_question` and `employee_relations` (the same rule as Snowflake). For these, `title`, `resolution` and hop `note` show as `[visible to HR only]` in the `*_public` views. In `events_public`, an HR event keeps only structural payload keys and every other key shows the placeholder (see [Views](#views)). **B and Darwin read `requests_public`, `request_hops_public` and `events_public`, never `requests`, `request_hops` or `events`.**

## Logins

Defined in `data/tiger/roles.sql`. `npm --prefix data run tiger:roles` creates or updates both roles and sets their passwords. `tiger:seed` re-applies the grants after it recreates the tables, so a reseed never needs a separate step. `npm --prefix data run tiger:test-roles` connects as each role and checks 46 allowed and denied actions, then plays a live request as `wayfinder_agent` (see [Live path](#live-path-events-trigger)); 60 checks in all.

| Login | Lane | Granted | Everything else |
|---|---|---|---|
| `wayfinder_agent` | A | USAGE on schema `public`; INSERT on `events`; SELECT, INSERT, UPDATE on `org_edges`; INSERT on `org_edge_changes` and USAGE on its id sequence; SELECT, UPDATE on `bookings` | Denied, including reading `events`, `requests`, `request_hops`, every view and `actors`, and any DELETE or TRUNCATE |
| `wayfinder_web` | B and Darwin | USAGE on schema `public`; SELECT on `requests_public`, `request_hops_public`, `events_public`, the five `insights_*` views, `org_edges`, `org_edge_changes`, `actors`, `bookings` | Denied, including base `requests`, `request_hops`, `events`, plus `hop_steps`, `org_edges_current` and every write |

Notes for lane A:

- **Generate every event `id` (UUID) in the app.** `wayfinder_agent` cannot read `events`, so `INSERT ... RETURNING` on `events` fails.
- **Emit one `hop` event per routing step** (not `forwarded`/`bounced`/`delegated`/`resolved` types), with the payload in [Live path](#live-path-events-trigger). Without it, live requests have no hops and Insights do not move.
- `org_edges` upserts (`INSERT ... ON CONFLICT DO UPDATE`) work. `org_edge_changes` is insert-only; `id` comes from the sequence.

Notes for lane B and Darwin:

- `org_edges_current` is not granted. For the live org map, read `org_edges` and drop expired delegate edges: `WHERE delegate_until IS NULL OR delegate_until > now()`.

Env vars by lane:

| Lane | Env vars | Notes |
|---|---|---|
| A | `TIGER_DATABASE_URL` (user `wayfinder_agent`, no password in the URL), `TIGER_PASSWORD` | Both on A's machine. Pass the password to node-postgres as `password` |
| B, Darwin | `TIGER_DATABASE_URL` (user `wayfinder_web`) plus the password from lane C | Set on their own machines |
| C | `TIGER_DATABASE_URL` (owner), `TIGER_AGENT_PASSWORD`, `TIGER_WEB_PASSWORD` | Root `.env`. The two passwords are the source for `tiger:roles` and the values C hands to A and B |

## Tables

| Table | Kind | Rows at seed | Holds |
|---|---|---|---|
| `actors` | plain | 35 | Id → name and department, for joins: 10 departments, 24 people, `agent` |
| `requests` | plain | 83 | Request history, plus live requests derived from A's events. Leo's demo request is not seeded; A creates it live |
| `request_hops` | hypertable on `at` | 255 | Each request's routing chain, plus live hops derived from A's `hop` events |
| `events` | hypertable on `ts` | 338 | Event log (shared `Event`). Seed rows are backfilled history |
| `org_edges` | plain | 35 | Org map (shared `OrgEdge`). All `chart` at seed |
| `org_edge_changes` | plain | 0 | History of every edge A creates or changes |
| `bookings` | plain | 5 | Today's room bookings |

### actors

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `dept_*`, `p_*`, or `agent` |
| `kind` | text | `department`, `person`, `agent` |
| `name` | text | Display name |
| `department_id` | text | The department itself for departments; null for `agent` |

The directory itself (email, title, manager, out-of-office) is in Snowflake.

### requests

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `req_0001`…`req_0083` (seeded history); live ids like `req_live_001` |
| `task_type` | text | e.g. `onboarding`, `data_access`, `checkout_incident` |
| `title` | text | HR text: masked in `requests_public` |
| `requester_id` | text → actors | |
| `created_at` | timestamptz | |
| `status` | text | `open`, `resolved`, `denied` or `stuck`. Seed rows are `open` or `resolved` |
| `resolved_at` | timestamptz | When the request was resolved or denied. Set exactly when `status` is `resolved` or `denied` (enforced); null for `open` and `stuck`. Insights count only `resolved` |
| `resolved_by` | text → actors | |
| `resolution` | text | HR text: masked in `requests_public` |
| `severity`, `new_hire_name`, `new_hire_id`, `room_id`, `vendor_id` | text | Optional details. Rooms and vendors live in Snowflake |
| `amount_usd` | numeric(12,2) | |
| `hr_sensitive` | boolean, generated | Computed from `task_type`. Do not insert it |
| `origin` | text | `seed` (history) or `agent` (created by the events trigger from A's `request_created`; used by `insights_hours_saved`) |

### request_hops

Primary key `(request_id, seq, at)`.

| Column | Type | Notes |
|---|---|---|
| `request_id` | text → requests | |
| `seq` | int | 1, 2, 3… |
| `from_id` | text → actors | Hop 1 is from the requester. After that, it is the previous hop's `to_id` |
| `to_id` | text → actors | Who received it |
| `at` | timestamptz | When `to_id` received it, for seeded and live rows alike. Hop 1: the request's `created_at`. Hop n: when hop n−1's receiver acted. Live rows: derived by the trigger (see [Live path](#live-path-events-trigger)) |
| `outcome` | text | What `to_id` did: `pending`, `forwarded`, `bounced` ("not us"), `delegated` (out), `handled` (closed it) |
| `redirect_to` | text → actors | Set on `bounced` and `delegated`: where to go instead |
| `note` | text | HR text: masked in `request_hops_public` |

### events

Shared `Event`. Primary key `(id, ts)`; `id` must be unique (UUID), but the database cannot enforce that alone. Every insert fires the `events_derive` trigger.

| Column | Type | Notes |
|---|---|---|
| `id` | text | A generates it (UUID). The default exists only as a fallback. Seed rows are `seed_<request>_<n>` |
| `ts` | timestamptz | Defaults to `now()` |
| `type` | text | Seed uses `request_created` and `hop`. A writes `request_created`, `hop`, `routed`, `redirected`, `delegated`, `step_done`, `approval_requested`, `approved`, `denied`, `payment_sent`, `request_resolved`, `request_denied`, `request_stuck` |
| `actor` | text | Person, team, or `agent` (no foreign key) |
| `request_id` | text | Live ids look like `req_live_001`. They exist only in `events` |
| `tool` | text | A `ToolName` or null |
| `payload` | jsonb | `request_created`: `{task_type, title, ...}`. `hop`: `{request_id, seq, from, to, outcome, redirect_to?, note}`, with `outcome` one of `forwarded`, `bounced`, `delegated`, `handled`. Seed rows add `seeded: true` (and `requester_id`, `to` on `request_created`). Not masked here; B and Darwin read `events_public` |

### org_edges

Shared `OrgEdge`. Primary key `(from_id, to_id, task_type)`. Seed: 35 edges, all `chart`. The only edges with `delegate_until` are Priya → Tom for `data_access` and `purchase_approval`. The agent's only `data_access` route is `agent → dept_data_platform` at 0.7, so it is the top route; there is no `agent → dept_analytics_eng` edge until A learns it live.

| Column | Type | Notes |
|---|---|---|
| `from_id` | text → actors | `agent` = the agent's first route for this task type. Delegations are person to person |
| `to_id` | text → actors | |
| `task_type` | text | |
| `confidence` | real | 0 to 1 |
| `source` | text | `chart` or `learned` |
| `delegate_until` | timestamptz | Set on temporary delegate edges (Priya → Tom until 2026-10-16 17:00) |
| `updated_at` | timestamptz | Defaults to `now()` on insert. A sets `updated_at = now()` on every update. Not in the shared type |
| `learned_from` | text | Optional request id that taught this edge. Not in the shared type |

### org_edge_changes

One row per edge A creates or changes. No foreign key to `org_edges`, so history outlives edges. Shape derived from the shared `OrgEdge`. This shape is the contract; A writes to it as below.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint, identity PK | Do not insert it |
| `changed_at` | timestamptz | Defaults to `now()` |
| `from_id`, `to_id` | text → actors | The edge's key, as in `org_edges` |
| `task_type` | text | |
| `previous_confidence` | real, nullable | Null for a new edge |
| `confidence` | real | The new value |
| `source` | text | `chart` or `learned` |
| `delegate_until` | timestamptz, nullable | |
| `reason` | text, nullable | e.g. `redirected`, `delegated`, `reinforced` |
| `request_id` | text, nullable | No foreign key, because live requests exist only in `events` |

### bookings

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | e.g. `bk_sam_commons` |
| `room_id` | text | Rooms are in Snowflake |
| `booked_by` | text → actors | |
| `title` | text | |
| `start_at`, `end_at` | timestamptz | |
| `attendees_expected` | int | |
| `status` | text | `confirmed`, `partially_used`, `released`, `cancelled` |
| `used_until` | timestamptz | Sam's Commons booking: used until 12:00 of 11:00–13:00 |
| `note` | text | |
| `released_at` | timestamptz | Set when the unused part is given back |

Constraint `bookings_no_overlap`: two bookings of the same room cannot overlap unless one is `cancelled`. A new 12:00–13:00 Commons booking fails until Sam's is released:

```sql
UPDATE bookings SET end_at = used_until, status = 'released', released_at = now() WHERE id = 'bk_sam_commons';
```

## Writing edges (lane A)

`learn_edge` was removed. A computes the final confidence and writes the edge and its history in one transaction:

```sql
BEGIN;
INSERT INTO org_edges (from_id, to_id, task_type, confidence, source, delegate_until, learned_from)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (from_id, to_id, task_type) DO UPDATE SET
  confidence = EXCLUDED.confidence, source = EXCLUDED.source, delegate_until = EXCLUDED.delegate_until,
  learned_from = EXCLUDED.learned_from, updated_at = now();
INSERT INTO org_edge_changes (from_id, to_id, task_type, previous_confidence, confidence, source, delegate_until, reason, request_id)
VALUES ($1, $2, $3, $8, $4, $5, $6, $9, $7);
COMMIT;
```

The seed runs this pattern on `agent → dept_data_platform` (0.7 → 0.4) and rolls it back.

## Views

### For the website and Darwin

| View | Use |
|---|---|
| `events_public` | `events` (same columns). For events of HR-sensitive requests, the payload keeps only structural keys: `id`, any `*_id`, `task_type`, `from`, `to`, `redirect_to`, `outcome`, `seq`, `status`, `amount`, `amount_usd`, `ts`, any `*_at`, `delegate_until` (scalar values only). Every other key (`title`, `note`, `text`, `message`, `seeded`, ...) becomes `[visible to HR only]`. A request counts as HR from its `requests` row, or from an HR `task_type` on its `request_created` event or the event itself if the trigger skipped the row. Non-HR events and events with no request pass through unchanged. This is the activity feed: read it instead of `events` |
| `requests_public` | `requests` with HR `title` and `resolution` masked |
| `request_hops_public` | `request_hops` plus `task_type` and `hr_sensitive`, with HR `note` masked |
| `org_edges_current` | `org_edges` without expired delegate edges. Not granted to `wayfinder_web`: B reads `org_edges` and applies the same filter for the Mycelium graph |
| `hop_steps` | Every hop with `hours` the receiver held it, plus `to_department_id`. No text. Used by the Insights views; not granted to any login |

### Insights panels

| Panel | View | Columns |
|---|---|---|
| New-hire stat ("last 10 new hires averaged 4 days and 6 hops") | `insights_new_hires` | `requests`, `avg_days`, `avg_hops` (one row) |
| Checkout incidents: direct vs routed (backs the Darwin rule) | `insights_checkout` | `path` (`direct`/`routed`), `incidents`, `avg_minutes`, `avg_hops` |
| Bottlenecks by department | `insights_bottlenecks` | `rank`, `department_id`, `department`, `hops_received`, `total_hours`, `avg_hours`, `bounces`, `bounce_hours`, `bounce_pct` |
| Slowest handoffs | `insights_slowest_handoffs` | `scope`, `rank`, `from_name`, `from_department`, `to_name`, `to_department`, `handoffs`, `avg_hours`, `total_hours` |
| Hours saved | `insights_hours_saved` | `metric`, `kind` (`saved`/`lost`), `basis_count`, `basis`, `hours` |

Definitions:

- **Bottlenecks:** the hours each department (including its people) held requests, counted from receiving a request until passing it on or resolving it. `bounce_*` is the part that ended in "not us". Ranked by `total_hours`.
- **Slowest handoffs:** the average hours from a handoff until the receiver acted. The first hop's sender is `Requester`. There are two scopes:
  - `new_hires`: the last 10 resolved onboarding requests. This matches the Snowflake VP view.
  - `all`: every resolved request, only handoffs that happened 3 or more times.
- **Hours saved:** three metrics.
  - `checkout_direct_paging`: routed incidents × (routed average − direct average).
  - `bounces`: hours lost while requests sat with a team that then bounced them.
  - `agent_routing`: for requests the agent created and resolved live (`origin = 'agent'`), the seeded average for that task type minus the actual time. It is 0 until the demo runs.

Values at seed (checked by `tiger:seed`):

| View | Value |
|---|---|
| `insights_new_hires` | 10 requests, 4.01 days, 6.00 hops |
| `insights_checkout` | direct: 2 incidents, 43 min, 2.0 hops · routed: 4 incidents, 233 min, 3.8 hops |
| `insights_bottlenecks` | rank 1 Analytics Engineering 829.7 h · Data Platform: 22 of 22 hops bounced, 341.3 h |
| `insights_slowest_handoffs` | `new_hires` rank 1: IT → Analytics Engineering, 4 handoffs, 19.0 h · `all` rank 1: Requester → Finance & Procurement, 17 handoffs, 27.6 h |
| `insights_hours_saved` | `checkout_direct_paging` saved 12.7 h (4 incidents) · `bounces` lost 537.6 h (36 hops) · `agent_routing` 0.0 h (0 requests) |

The top four new-hire handoffs are within 1.1 h of each other (19.0 to 17.9 h), so the rank-1 handoff wins by a thin margin.

## Live path (events trigger)

`events_derive` is an `AFTER INSERT` row trigger on `events`. Its function is `SECURITY DEFINER`, owned by lane C's owner login, so it writes tables `wayfinder_agent` cannot touch. It is applied by `schema.sql` (safe to rerun).

| A's event | Payload A sends | What the trigger writes |
|---|---|---|
| `request_created` | `{task_type, title}`; `request_id` column set | `requests` row: `id` = `request_id`, `requester_id` = `actor`, `created_at` = `ts`, `status = 'open'`, `origin = 'agent'`. Ignored if the id exists |
| `hop` | `{request_id, seq, from, to, outcome, redirect_to?, note}` | `request_hops` row with `at` = when `to` received it: the request's `created_at` for `seq` 1, else the `ts` of the `seq − 1` hop event. Ignored if `(request_id, seq)` exists |
| `request_resolved`, `request_denied` | `request_id` column set | That request's `status` (`resolved`/`denied`) and `resolved_at = ts` |
| `request_stuck` | `request_id` column set | `status = 'stuck'`, `resolved_at` stays null. Only an `open` request becomes stuck; a later `request_resolved` still closes it |

Rules for A:

- Send `request_created` before any `hop` for that request, with `actor` = the requester (`p_*`). `from`, `to`, `redirect_to` and the requester must be ids in `actors`.
- **When to emit a `hop` event:** when `to` acts on the request (says "not us", forwards it, delegates it, or handles it), with `ts` = that moment and `outcome` = what `to` did. Do not emit it when `to` first receives the request. The trigger derives the receive time (`request_hops.at`) from the request's `created_at` and the previous hop event. This is the same meaning the seeded history uses.
- For the last hop (`handled`), emit the `hop` event, then `request_resolved` with the same `ts`.
- Use the same `request_id` in the event column and the payload, and send hops in `seq` order (1, 2, 3…). If the previous hop event is missing, the hop's own `ts` is used.
- The trigger never makes A's insert fail. On any error (unknown actor, missing `seq` or `title`, bad `outcome`) the event is still stored, the derived write is skipped, and Postgres sends a `WARNING` (`events_derive skipped ...`). Log notices from node-postgres to see them.
- Other event types are stored only.

`tiger:test-roles` checks this as `wayfinder_agent`: it plays a stuck onboarding request (status `stuck`, no `resolved_at`, no Insights view changes), then `req_live_test` (created; hop bounced Data Platform → Analytics Engineering; hop handled; resolved), checks the request and hops appear with `at` = receive times, that `insights_bottlenecks`, `insights_slowest_handoffs` and `insights_hours_saved` change (`agent_routing` 0 → 1 request), that a bad hop is skipped with the insert intact, that replays are ignored, and that an HR test request leaks nothing through `events_public`, `requests_public` or `request_hops_public`. Then the owner deletes the test rows and checks the Insights are back to the seed values.

**Live updates:** A pushes them to the website over SSE (`GET /live`). Tiger sends no notifications. B queries the Tiger views directly.

**Payload keys for live events:** `events_public` masks every non-structural key on HR events, so free text under any key name (`text`, `message`, ...) is covered. A structural key name (e.g. `status`, any `*_id`) must not carry free text.
