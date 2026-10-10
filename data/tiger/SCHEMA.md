# Tiger Data schema reference

For lanes A (agent server) and B (website). Lane C owns this database. The design and open questions are in [PLAN.md](PLAN.md).

- Tiger Data: Postgres 18 with TimescaleDB 2.30. Everything is in the `public` schema.
- Built by `data/tiger/schema.sql` and loaded by `npm --prefix data run tiger:seed`. The seed drops and recreates everything and fails without committing if any demo row or Insights number is wrong.
- All data is simulated (the fictional company Photon). The demo date is 2026-10-10.
- **Access:** only lane C's owner login exists today. The planned roles are `wayfinder_agent` for A (limited write) and `wayfinder_web` for B and Darwin (read-only, views only). They are not created yet; see PLAN.md section 6. Connection details come from lane C directly, never from this file.

## Things to know before querying

- **Column names:** `from_id` and `to_id` stand in for the shared `OrgEdge.from` and `OrgEdge.to`, because `from` and `to` are reserved in SQL. Map them back in API code.
- **Times:** all `timestamptz`. node-postgres returns JS `Date`. Use `.toISOString()` for the shared ISO 8601 strings.
- **Numbers:** node-postgres returns `numeric` and `bigint` as **strings** (`"4.01"`, `"43"`). `int` and `real` come back as numbers. Every Insights value that is rounded is `numeric`, so call `Number(...)` before charting. Counts are cast to `int`.
- **Live numbers:** the Insights views are plain views over the live tables, not cached. A new or resolved request changes them on the next query. History stats count only `status = 'resolved'` requests.
- **HR text:** HR request types are `leave_request`, `benefits_question` and `employee_relations` (the same rule as Snowflake). For these, `title`, `resolution` and hop `note` show as `[visible to HR only]` in the `*_public` views. B and Darwin read those views, never the base tables.

## Tables

| Table | Kind | Rows at seed | Holds |
|---|---|---|---|
| `actors` | plain | 35 | Id → name and department, for joins: 10 departments, 24 people, `agent` |
| `requests` | plain | 84 | Request history plus Leo's open demo request |
| `request_hops` | hypertable on `at` | 256 | Each request's routing chain |
| `events` | hypertable on `ts` | 340 | Event log (shared `Event`). Seed rows are backfilled history |
| `org_edges` | plain | 35 | Org map (shared `OrgEdge`) |
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
| `id` | text PK | `req_0001`…, `req_demo_leo` |
| `task_type` | text | e.g. `onboarding`, `data_access`, `checkout_incident` |
| `title` | text | HR text: masked in `requests_public` |
| `requester_id` | text → actors | |
| `created_at` | timestamptz | |
| `status` | text | `open` or `resolved` |
| `resolved_at` | timestamptz | Set exactly when `status = 'resolved'` (enforced) |
| `resolved_by` | text → actors | |
| `resolution` | text | HR text: masked in `requests_public` |
| `severity`, `new_hire_name`, `new_hire_id`, `room_id`, `vendor_id` | text | Optional details. Rooms and vendors live in Snowflake |
| `amount_usd` | numeric(12,2) | |
| `hr_sensitive` | boolean, generated | Computed from `task_type`. Do not insert it |
| `origin` | text | `seed` (history) or `agent` (created live). A must set `agent`; `insights_hours_saved` uses it |

### request_hops

Primary key `(request_id, seq, at)`.

| Column | Type | Notes |
|---|---|---|
| `request_id` | text → requests | |
| `seq` | int | 1, 2, 3… |
| `from_id` | text → actors | Hop 1 is from the requester. After that, it is the previous hop's `to_id` |
| `to_id` | text → actors | Who received it |
| `at` | timestamptz | When `to_id` received it |
| `outcome` | text | What `to_id` did: `pending`, `forwarded`, `bounced` ("not us"), `delegated` (out), `handled` (closed it) |
| `redirect_to` | text → actors | Set on `bounced` and `delegated`: where to go instead |
| `note` | text | HR text: masked in `request_hops_public` |

### events

Shared `Event`. Primary key `(id, ts)`; `id` must be unique (UUID), but the database cannot enforce that alone.

| Column | Type | Notes |
|---|---|---|
| `id` | text | Defaults to a UUID. Seed rows are `seed_<request>_<n>` |
| `ts` | timestamptz | Defaults to `now()` |
| `type` | text | Seed uses `request_created`, `forwarded`, `bounced`, `delegated`, `resolved`. `learn_edge` writes `edge_updated` |
| `actor` | text | Person, team, or `agent` (no foreign key) |
| `request_id` | text | |
| `tool` | text | A `ToolName` or null |
| `payload` | jsonb | Seed rows: `request_created` has `{seeded, task_type, title, requester_id, to}`, hop events `{seeded, seq, from, to, redirect_to, note}`. **Not HR-masked.** See open items |

### org_edges

Shared `OrgEdge`. Primary key `(from_id, to_id, task_type)`.

| Column | Type | Notes |
|---|---|---|
| `from_id` | text → actors | `agent` = the agent's first route for this task type |
| `to_id` | text → actors | |
| `task_type` | text | |
| `confidence` | real | 0 to 1 |
| `source` | text | `chart` or `learned` |
| `delegate_until` | timestamptz | Set on temporary delegate edges (Priya → Tom until 2026-10-16 17:00) |
| `updated_at` | timestamptz | Not in the shared type yet (PLAN.md P1) |
| `learned_from` | text | Request id that taught this edge. Not in the shared type yet (P1) |

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

## Function: learn_edge

```sql
learn_edge(
  p_from       text,                      -- usually 'agent'
  p_wrong_to   text,                      -- the team that said "not us"; null when only adding an edge
  p_right_to   text,                      -- where it should go
  p_task_type  text,
  p_request_id text        DEFAULT NULL,  -- stored as learned_from and on the events
  p_until      timestamptz DEFAULT NULL   -- for delegate edges ("Priya's out, ask Tom")
) RETURNS SETOF org_edges                 -- the changed edges: wrong edge first, then right edge
```

In one call it does three things:

- It lowers the wrong edge by 0.3, with a floor of 0.
- It raises the right edge by 0.2 (capped at 1) and sets its `source` to `learned`. If the right edge doesn't exist, it creates it at 0.8.
- It logs one `edge_updated` event per changed edge. The payload is `{from, to, task_type, confidence, source, delegate_until?, previous_confidence}`; `previous_confidence` is null for a new edge.

The step sizes are placeholders.

Leo's demo, `SELECT * FROM learn_edge('agent', 'dept_data_platform', 'dept_analytics_eng', 'data_access', 'req_demo_leo')`, gives:

- `agent → dept_data_platform` drops from 0.7 to 0.4 (chart).
- `agent → dept_analytics_eng` is new at 0.8 (learned).

The seed tests this and rolls it back, so the seeded database still has the chart edges.

## Views

### For the website and Darwin

| View | Use |
|---|---|
| `requests_public` | `requests` with HR `title` and `resolution` masked |
| `request_hops_public` | `request_hops` plus `task_type` and `hr_sensitive`, with HR `note` masked |
| `org_edges_current` | `org_edges` without expired delegate edges. This is the live org map (Mycelium graph) |
| `hop_steps` | Every hop with `hours` the receiver held it, plus `to_department_id`. No text. Used by the Insights views |

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

## Not built yet

These are open with lanes A and B; see PLAN.md section 7.

- **Events-to-tables trigger** (PLAN 2.4). Until it exists, the Insights numbers move only if A writes `requests` (with `origin = 'agent'`) and `request_hops` directly. Writing to `events` alone does not change them.
- **Live push** (`pg_notify`): nothing is sent yet. B polls `events` and `org_edges`, or A pushes.
- **`events_feed`:** a masked view of `events`. Seed `payload.title` and `payload.note` contain HR text, so B should not render raw `events.payload` for HR requests until this exists.
- **Roles** `wayfinder_agent` and `wayfinder_web`.
