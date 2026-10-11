> Superseded by [SCHEMA.md](SCHEMA.md), which is the contract. This plan is kept for history.

# Tiger Data plan (S4)

Status: plan only. Nothing has connected to Tiger yet. All SQL below is unverified until S4 step 2.

Tiger Data (TimescaleDB on Postgres) holds everything live: the event log, the org map edges, today's bookings, and a copy of request history so Insights can run in one place. Snowflake keeps the static directory and the warehouse copy of history (see `data/snowflake/SCHEMA.md`).

Conventions:

- Column names follow Snowflake: `from_id` and `to_id` (`from` and `to` are reserved in SQL). API code maps them back to the shared `from` and `to`.
- All times are `timestamptz`. Fixtures use `-04:00`; Postgres stores UTC. `pg` returns JS `Date`, so API code formats it back to ISO 8601.
- Averages are cast to `numeric` before `round()`. Checkout times average to exactly 42.5 and 232.5 minutes, so the rounding mode decides whether the stats show 43 and 233.
- Every Insights number comes from these queries on seeded history. Nothing is hardcoded.

## 1. Tables

| Table | Kind | Time column | Chunk | Rows at seed | Written by |
|---|---|---|---|---|---|
| `actors` | plain | | | 35 | C seed only |
| `requests` | plain | | | 84 | C seed, then live (see 2.3) |
| `request_hops` | **hypertable** | `at` | 30 days | 256 | C seed, then live |
| `events` | **hypertable** | `ts` | 7 days | about 340 (backfill) | A live, C seed |
| `org_edges` | plain | | | 35 | C seed, A live |
| `bookings` | plain | | | 5 | C seed, A live |

`requests`, `org_edges`, and `bookings` stay plain tables. They are small, they are updated in place (status, confidence, end time), and other tables reference them. Timescale requires a hypertable's unique keys to include the time column, which would make `requests.id` a two-column key.

```sql
-- Tiger Cloud services ship with timescaledb. btree_gist is for the booking overlap rule.
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Id-to-name and department lookup for Insights joins. A copy of a subset of the Snowflake directory
-- (departments + people id, name, department). No email, role, or HR data. 'agent' is a row so edges can reference it.
CREATE TABLE actors (
  id            text PRIMARY KEY,                       -- dept_*, p_*, or 'agent'
  kind          text NOT NULL CHECK (kind IN ('department', 'person', 'agent')),
  name          text NOT NULL,
  department_id text                                    -- self for departments, null for 'agent'
);

CREATE TABLE requests (
  id            text PRIMARY KEY,
  task_type     text NOT NULL,
  title         text NOT NULL,
  requester_id  text NOT NULL REFERENCES actors (id),
  created_at    timestamptz NOT NULL,
  status        text NOT NULL CHECK (status IN ('open', 'resolved')),
  resolved_at   timestamptz,
  resolved_by   text REFERENCES actors (id),
  resolution    text,
  severity      text,
  new_hire_name text,
  new_hire_id   text REFERENCES actors (id),
  room_id       text,                                   -- rooms live in Snowflake
  vendor_id     text,                                   -- vendors live in Snowflake
  amount_usd    numeric(12, 2),
  hr_sensitive  boolean NOT NULL DEFAULT false,         -- same rule as Snowflake: leave_request, benefits_question, employee_relations
  origin        text NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed', 'agent')),  -- 'agent' = created live; used by hours saved
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE TABLE request_hops (
  request_id  text NOT NULL REFERENCES requests (id),
  seq         int  NOT NULL,
  from_id     text NOT NULL REFERENCES actors (id),
  to_id       text NOT NULL REFERENCES actors (id),
  at          timestamptz NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('pending', 'forwarded', 'bounced', 'delegated', 'handled')),
  redirect_to text REFERENCES actors (id),
  note        text,
  PRIMARY KEY (request_id, seq, at)
);
SELECT create_hypertable('request_hops', by_range('at', INTERVAL '30 days'));

-- Shared type: Event. Hypertable keys must include ts, so the key is (id, ts). A generates ids (UUID).
CREATE TABLE events (
  id         text NOT NULL DEFAULT gen_random_uuid()::text,
  ts         timestamptz NOT NULL DEFAULT now(),
  type       text NOT NULL,
  actor      text NOT NULL,                             -- person, team, or 'agent'; no FK so A can log anything
  request_id text,
  tool       text CHECK (tool IN ('plan', 'route', 'check_permission', 'draft', 'pay', 'call', 'match')),  -- ToolName
  payload    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('events', by_range('ts', INTERVAL '7 days'));
CREATE INDEX ON events (request_id, ts DESC);
CREATE INDEX ON events (type, ts DESC);

-- Shared type: OrgEdge. Natural key (from, to, task_type); OrgEdge has no id.
CREATE TABLE org_edges (
  from_id        text NOT NULL REFERENCES actors (id),  -- 'agent' = agent's first route for this task type
  to_id          text NOT NULL REFERENCES actors (id),
  task_type      text NOT NULL,
  confidence     real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source         text NOT NULL CHECK (source IN ('chart', 'learned')),
  delegate_until timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),    -- not in OrgEdge (proposal P1)
  learned_from   text REFERENCES requests (id),         -- not in OrgEdge (proposal P1)
  PRIMARY KEY (from_id, to_id, task_type)
);

-- No shared Booking type yet (proposal P4). start/end are reserved-ish, so start_at/end_at.
CREATE TABLE bookings (
  id                 text PRIMARY KEY,
  room_id            text NOT NULL,
  booked_by          text NOT NULL REFERENCES actors (id),
  title              text NOT NULL,
  start_at           timestamptz NOT NULL,
  end_at             timestamptz NOT NULL,
  attendees_expected int,
  status             text NOT NULL CHECK (status IN ('confirmed', 'partially_used', 'released', 'cancelled')),
  used_until         timestamptz,
  note               text,
  released_at        timestamptz,                       -- set when the unused part is given back
  CHECK (end_at > start_at),
  EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status <> 'cancelled')
);
```

The overlap rule makes the Sam demo honest: a 12:00 to 13:00 Commons booking fails until Sam's booking is released (`UPDATE bookings SET end_at = used_until, status = 'released', released_at = now()`).

Views (for Insights and for lane B, see section 6):

```sql
-- Every hop with how long the receiver held it (until the next hop, or until resolved).
CREATE VIEW hop_steps AS
SELECT h.request_id, r.task_type, r.status, r.hr_sensitive, h.seq, h.from_id, h.to_id, h.at, h.outcome, h.redirect_to,
       t.department_id AS to_department_id,
       extract(epoch FROM coalesce(lead(h.at) OVER w, r.resolved_at) - h.at)::numeric / 3600 AS hours
FROM request_hops h
JOIN requests r ON r.id = h.request_id
JOIN actors t ON t.id = h.to_id
WINDOW w AS (PARTITION BY h.request_id ORDER BY h.seq);

-- Edges in force now: expired delegate edges drop out.
CREATE VIEW org_edges_current AS
SELECT * FROM org_edges WHERE delegate_until IS NULL OR delegate_until > now();
```

Open requests have `hours = null` on their last hop. Insights below use resolved requests only, which is what the demo stats use.

## 2. Org map edges

**Unconfirmed with lanes A and B.** STATE.md lists edge storage as an open issue. This section is the proposal to confirm.

### 2.1 Key

`(from_id, to_id, task_type)`, the natural key `check.ts` already enforces on `edges.json`. One row per edge. Its current state is in `org_edges`. Its history is the `edge_updated` events.

### 2.2 How lane A writes a learned edge

A calls one SQL function in one transaction. It never writes `org_edges` directly.

```sql
-- "Not us, try Analytics Engineering": lower the wrong edge, add or raise the right one, log both as events.
SELECT learn_edge(
  p_from       => 'agent',
  p_wrong_to   => 'dept_data_platform',   -- null when only adding (e.g. a delegate)
  p_right_to   => 'dept_analytics_eng',
  p_task_type  => 'data_access',
  p_request_id => 'req_demo_leo',
  p_until      => null                    -- set for "Priya's out, ask Tom" (delegate_until)
);
```

`learn_edge` does:

1. `UPDATE org_edges SET confidence = greatest(confidence - 0.3, 0), updated_at = now()` on the wrong edge.
2. `INSERT ... ON CONFLICT (from_id, to_id, task_type) DO UPDATE SET confidence = least(org_edges.confidence + 0.2, 1), source = 'learned', delegate_until = EXCLUDED.delegate_until, learned_from = EXCLUDED.learned_from, updated_at = now()`. New edges start at 0.8.
3. Inserts one `edge_updated` event per changed edge, with `payload` = the full OrgEdge after the change plus `previous_confidence`.

The step sizes (−0.3, +0.2, start 0.8) are placeholders. Darwin (S5) may tune them. To confirm with A: whether A wants to send the final confidence itself instead.

For Leo's request, `agent → dept_data_platform` (data_access, 0.7) drops to 0.4 and `agent → dept_analytics_eng` (data_access, learned, 0.8) is created. The existing chain `dept_analytics_eng → p_priya → p_tom` (delegate until 10-16) then gets the request to Tom.

### 2.3 Live updates to the website

Every insert into `events` fires a trigger that sends `pg_notify('live_update', <LiveUpdate JSON>)`. That is `{kind: 'event', ...}`, or `{kind: 'edge', ...}` for `edge_updated` events. How B receives them is **unconfirmed**:

- (a) A pushes the LiveUpdate to B over its own SSE or websocket after the write commits. Recommended: it works with a serverless Next.js deploy.
- (b) B runs `LISTEN live_update`. This needs a long-lived direct connection, which the transaction pooler and serverless functions do not support.
- (c) B polls `events WHERE ts > $last_seen` every 1 to 2 s. This is the fallback, and the backfill path for (a).

### 2.4 Live requests and hops (proposal, needs A)

So that A only writes `events`, a trigger on `events` keeps `requests` and `request_hops` in sync. This needs a fixed payload per event type (proposal P2):

| Event `type` | Required `payload` | Effect |
|---|---|---|
| `request_created` | `task_type`, `title`, `requester_id` | insert `requests` row (`origin = 'agent'`, `status = 'open'`) |
| `routed` | `to` | insert hop: `seq` = last + 1, `from` = last hop's `to` (or requester), `outcome = 'pending'` |
| `forwarded` | `to`, `note?` | close last hop as `forwarded`, insert the next pending hop to `to` |
| `bounced` / `delegated` | `redirect_to`, `note?` | set last hop's `outcome`, `redirect_to`, `note` |
| `resolved` | `resolution?` | last hop `handled`; request `resolved`, `resolved_at = ts`, `resolved_by` = last hop's `to` |

Other types (`approved`, `edge_updated`, `booking_released`, `paid`, ...) are stored and broadcast only. The alternative is that A inserts and updates `requests` and `request_hops` itself, which needs write grants on both (section 6).

## 3. Insights queries

Expected values were computed from `data/fixtures` with the same logic, in a scratch Node script that matches `check.ts` and the Snowflake `vp_new_hire_setup` view. S4 must check that each query returns these values.

### 3.1 New-hire stat (matches demo: 4.01 days, 6.00 hops)

```sql
WITH last10 AS (
  SELECT r.id, r.created_at, r.resolved_at,
         (SELECT count(*) FROM request_hops h WHERE h.request_id = r.id) AS hops
  FROM requests r
  WHERE r.task_type = 'onboarding' AND r.status = 'resolved'
  ORDER BY r.created_at DESC
  LIMIT 10
)
SELECT count(*) AS requests,
       round(avg(extract(epoch FROM resolved_at - created_at)::numeric) / 86400, 2) AS avg_days,
       round(avg(hops)::numeric, 2) AS avg_hops
FROM last10;
```

Expected: `10 | 4.01 | 6.00`.

### 3.2 Checkout incidents (matches demo: 43 min direct vs 233 min routed)

"Direct" means the first hop went to Platform Engineering, either the department or one of its people. This is the same rule as `check.ts`.

```sql
SELECT CASE WHEN a.department_id = 'dept_platform' THEN 'direct' ELSE 'routed' END AS path,
       count(*) AS incidents,
       round(avg(extract(epoch FROM r.resolved_at - r.created_at)::numeric) / 60) AS avg_minutes,
       round(avg((SELECT count(*) FROM request_hops x WHERE x.request_id = r.id))::numeric, 1) AS avg_hops
FROM requests r
JOIN request_hops h ON h.request_id = r.id AND h.seq = 1
JOIN actors a ON a.id = h.to_id
WHERE r.task_type = 'checkout_incident' AND r.status = 'resolved'
GROUP BY 1
ORDER BY 1;
```

Expected: `direct | 2 | 43 | 2.0` (req_0017 48 min, req_0066 37 min) and `routed | 4 | 233 | 3.8` (req_0004 190, req_0029 265, req_0043 170, req_0055 305).

### 3.3 Bottlenecks by department

Hours each department (including its people) held requests, and how much of that time ended in a bounce. All resolved history.

```sql
SELECT d.name AS department,
       count(*)                                                  AS hops_received,
       round(sum(s.hours), 1)                                    AS total_hours,
       round(avg(s.hours), 1)                                    AS avg_hours,
       count(*) FILTER (WHERE s.outcome = 'bounced')             AS bounces,
       round(coalesce(sum(s.hours) FILTER (WHERE s.outcome = 'bounced'), 0), 1) AS bounce_hours
FROM hop_steps s
JOIN actors d ON d.id = s.to_department_id
WHERE s.status = 'resolved'
GROUP BY d.name
ORDER BY total_hours DESC;
```

Expected (from fixtures):

| department | hops_received | total_hours | avg_hours | bounces | bounce_hours |
|---|---|---|---|---|---|
| Analytics Engineering | 58 | 829.7 | 14.3 | 0 | 0.0 |
| Finance & Procurement | 31 | 526.4 | 17.0 | 2 | 43.7 |
| People Ops | 33 | 417.7 | 12.7 | 11 | 128.8 |
| IT | 25 | 367.9 | 14.7 | 0 | 0.0 |
| Data Platform | 22 | 341.3 | 15.5 | 22 | 341.3 |
| Workplace | 46 | 242.4 | 5.3 | 0 | 0.0 |
| HR | 8 | 125.0 | 15.6 | 0 | 0.0 |
| Legal | 9 | 115.1 | 12.8 | 1 | 23.8 |
| Platform Engineering | 18 | 14.4 | 0.8 | 0 | 0.0 |
| Commerce Engineering | 5 | 6.1 | 1.2 | 0 | 0.0 |

Data Platform holds requests only to bounce them (22 of 22). That is the story the demo tells.

### 3.4 Slowest handoffs

Same definition as the Snowflake VP view: the average hours from a handoff until the receiver passed the request on or resolved it. The first hop's sender is shown as `Requester`. The default scope is the last 10 resolved onboarding requests.

```sql
WITH scope AS (
  SELECT id FROM requests
  WHERE task_type = 'onboarding' AND status = 'resolved'
  ORDER BY created_at DESC LIMIT 10
)
SELECT CASE WHEN s.seq = 1 THEN 'Requester' ELSE f.name END AS from_name,
       t.name AS to_name,
       count(*) AS handoffs,
       round(avg(s.hours), 1) AS avg_hours,
       round(sum(s.hours), 1) AS total_hours
FROM hop_steps s
JOIN scope ON scope.id = s.request_id
JOIN actors f ON f.id = s.from_id
JOIN actors t ON t.id = s.to_id
GROUP BY 1, 2
ORDER BY avg(s.hours) DESC, count(*) DESC, 1, 2;
```

Expected top 4 (same as `vp_new_hire_setup`): IT → Analytics Engineering 4 handoffs, 19.0 h; People Ops → IT 10, 18.5 h; Requester → People Ops 10, 18.1 h; Analytics Engineering → Priya Raman 10, 17.9 h. The margins are thin (known open issue).

All-history variant: replace `scope` with every resolved request and add `HAVING count(*) >= 3`. Expected top: Requester → Finance & Procurement 17 handoffs, 27.6 h.

### 3.5 Hours saved

Three numbers, each with a clear definition:

```sql
-- (a) Checkout: if every routed incident had paged Platform directly.
WITH t AS (
  SELECT (a.department_id = 'dept_platform') AS direct,
         extract(epoch FROM r.resolved_at - r.created_at)::numeric / 3600 AS hours
  FROM requests r
  JOIN request_hops h ON h.request_id = r.id AND h.seq = 1
  JOIN actors a ON a.id = h.to_id
  WHERE r.task_type = 'checkout_incident' AND r.status = 'resolved'
)
SELECT round(count(*) FILTER (WHERE NOT direct)
             * (avg(hours) FILTER (WHERE NOT direct) - avg(hours) FILTER (WHERE direct)), 1) AS hours_saved
FROM t;
-- Expected: 12.7  (4 x (232.5 - 42.5) min = 760 min)

-- (b) Time lost to wrong routing: hours requests sat with a team that then said "not us".
SELECT count(*) AS bounces, round(sum(hours), 1) AS hours_lost
FROM hop_steps WHERE status = 'resolved' AND outcome = 'bounced';
-- Expected: 36 | 537.6

-- (c) Live: agent-routed requests vs the historical average for the same task type.
WITH baseline AS (
  SELECT task_type, avg(extract(epoch FROM resolved_at - created_at)::numeric) / 3600 AS hours
  FROM requests WHERE origin = 'seed' AND status = 'resolved' GROUP BY task_type
)
SELECT round(coalesce(sum(b.hours - extract(epoch FROM r.resolved_at - r.created_at)::numeric / 3600), 0), 1) AS hours_saved
FROM requests r JOIN baseline b USING (task_type)
WHERE r.origin = 'agent' AND r.status = 'resolved';
-- Expected at seed: 0.0 (no agent requests yet). Grows during the demo.
```

The dashboard headline is (b) + (c). (a) backs the Darwin rule "page Platform directly for checkout incidents".

## 4. Seed plan

Script: `data/tiger/seed.ts` (`npm --prefix data run tiger:seed`). Same style as `snowflake/load.ts`: it is re-runnable. It runs `schema.sql` (drop and recreate), loads the fixtures in one transaction, prints counts against the fixtures, then runs 3.1 and 3.2 and fails if they do not match.

| Fixture | Table | Rows | Notes |
|---|---|---|---|
| `departments.json` + `people.json` | `actors` | 10 + 24 + 1 (`agent`) | id, kind, name, department_id only |
| `requests.json` | `requests` | 84 | `hr_sensitive` from task type; `origin = 'seed'` |
| `requests.json` `.hops[]` | `request_hops` | 256 | `from`/`to` → `from_id`/`to_id` |
| `edges.json` | `org_edges` | 35 | `updated_at` = seed time |
| `bookings.json` | `bookings` | 5 | `start`/`end` → `start_at`/`end_at` |
| derived from requests + hops | `events` | 84 `request_created` + 256 hop events (about 340) | backfill so the feed and charts have history; `payload.seeded = true`; the 2.4 trigger skips seeded rows |

Demo rows the seed must assert (fail if missing):

- `req_demo_leo`: `open`, `data_access`, requester `p_leo`, created 2026-10-10 09:20. One hop, `p_leo → dept_data_platform`, `bounced`, `redirect_to = dept_analytics_eng`.
- Priya out: edges `p_priya → p_tom` for `data_access` and `purchase_approval`, `delegate_until = 2026-10-16T17:00-04:00`. Both appear in `org_edges_current` on the demo date. (Priya's `status`/`out_until` live in Snowflake `people`; Tiger only needs the edges.)
- `bk_sam_commons`: `rm_commons`, 11:00 to 13:00, `partially_used`, `used_until` 12:00.
- Six `checkout_incident` requests, all resolved: 2 direct (req_0017, req_0066) and 4 routed (req_0004, req_0029, req_0043, req_0055).

Caterer (`v_greenleaf`) is Snowflake only. Tiger stores just `vendor_id` on requests.

Dependency (not installed): `pg` (node-postgres) in `data/package.json`. No Postgres client is a dependency anywhere in `/data` today.

## 5. Shared type proposals

Proposals only. No shared file has been edited.

- **P1 OrgEdge.** Add optional `updated_at?: string` and `learned_from?: string` (request id) so B can show "learned from Leo's request, 2 min ago". Keep the natural key `from|to|task_type` and no `id`. `from: "agent"` still needs A and B to agree.
- **P2 Event.type.** It is a free `string` today. Make it a union: `request_created | routed | forwarded | bounced | delegated | approved | resolved | edge_updated | booking_released | paid | call_placed`. Also document the per-type `payload` in 2.4. Without that shape, C cannot derive hops from events.
- **P3 Event.id.** State that A generates it as a UUID. The DB key is `(id, ts)` because of the hypertable, so the DB cannot enforce uniqueness of `id` alone.
- **P4 Missing types.** Add `Request`, `Hop`, `HopOutcome` (with `pending` for a hop awaiting a reply), and `Booking`. Today they exist only as local types in `data/check.ts`.
- **P5 LiveUpdate.** No change needed if booking changes travel as `booking_released` events. A `{kind: "booking"}` variant is the alternative.
- **P6 Python mirror.** Whatever is accepted from P1 to P4 also goes into `services/darwin/models.py`.

## 6. Access model

Tiger roles apply to a whole service, not to individual users. Per-person filtering, such as "an employee sees only their own open requests" (the S3 decision), stays in lane A's query tools, as with Snowflake managers.

| Login role | Who | Env var (proposed) | Access |
|---|---|---|---|
| `tsdbadmin` (service owner) | Lane C: schema, seed | `TIGER_DATABASE_URL` (already in `.env.example`) | owner; never given to A or B |
| `wayfinder_agent` | Lane A agent server | `TIGER_AGENT_DATABASE_URL` | **write, limited**: `SELECT` on all tables and views; `INSERT` on `events`; `EXECUTE` on `learn_edge`; `INSERT, UPDATE` on `bookings`. With 2.4 there are no direct writes to `requests` or `request_hops` (the trigger is `SECURITY DEFINER`). Without 2.4, also `INSERT, UPDATE` on both. No `DELETE`, no DDL. |
| `wayfinder_web` | Lane B website, Darwin (S5) | `TIGER_WEB_DATABASE_URL` | **read-only**: `SELECT` on the views `insights_*` (sections 3.1 to 3.5 as views), `org_edges_current`, `hop_steps`, `requests_public`, `events_feed`, and on `bookings`, `actors`. No base `requests` or `events` access. |

`requests_public` and `events_feed` null out `title`, `resolution`, hop `note`, and event `payload` text when `hr_sensitive`. This matches the Snowflake HR masking, so the website cannot show HR request text.

Both roles get `ALTER ROLE ... SET statement_timeout = '5s'`. B on serverless uses the pooler URL. A, if it uses LISTEN (2.3 b), needs the direct URL.

To check at S4 step 2: that `tsdbadmin` on this service can `CREATE ROLE` and create `btree_gist`. If it cannot, B and Darwin share a read-only role created in the console, and the overlap rule moves to a check inside `learn_edge`-style booking functions.

## 7. Open questions for A and B

1. Edge storage in Tiger as above (2.1, 2.2): yes or no.
2. A sends deltas through `learn_edge`, or sends final confidence itself.
3. Live delivery: (a) A pushes, (b) B LISTENs, or (c) B polls.
4. A writes only `events` (2.4 trigger) or writes `requests` and `request_hops` directly.
5. `req_demo_leo` pre-seeded (this plan) or created live by A.
6. P1 to P5.
