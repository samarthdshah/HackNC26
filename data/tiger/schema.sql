-- Tiger Data schema for Wayfinder OS (S4). See PLAN.md.
-- Safe to rerun: drops and recreates every object. Applied by seed.ts inside the seed transaction.
-- Columns use from_id/to_id (from and to are reserved); API code maps them back to the shared OrgEdge/Event names.

CREATE EXTENSION IF NOT EXISTS timescaledb;

DROP FUNCTION IF EXISTS learn_edge(text, text, text, text, text, timestamptz); -- dropped: A writes org_edges itself
DROP TABLE IF EXISTS events, request_hops, bookings, org_edge_changes, org_edges, requests, actors CASCADE;

-- Id-to-name and department lookup for Insights joins. Subset copy of the Snowflake directory; 'agent' is a row.
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
  -- Same rule as HR_TYPES in snowflake/load.ts. Generated, so requests A creates live are masked too.
  hr_sensitive  boolean GENERATED ALWAYS AS (task_type IN ('leave_request', 'benefits_question', 'employee_relations')) STORED,
  origin        text NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed', 'agent')),
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
  tool       text CHECK (tool IN ('plan', 'route', 'check_permission', 'draft', 'pay', 'call', 'match')),
  payload    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('events', by_range('ts', INTERVAL '7 days'));
CREATE INDEX ON events (request_id, ts DESC);
CREATE INDEX ON events (type, ts DESC);

-- Shared type: OrgEdge. Natural key (from, to, task_type). A computes the final confidence and upserts rows itself.
-- Agent routes use from_id 'agent'; delegations are person to person with delegate_until.
CREATE TABLE org_edges (
  from_id        text NOT NULL REFERENCES actors (id),  -- 'agent' = agent's first route for this task type
  to_id          text NOT NULL REFERENCES actors (id),
  task_type      text NOT NULL,
  confidence     real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source         text NOT NULL CHECK (source IN ('chart', 'learned')),
  delegate_until timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  learned_from   text,                                  -- request id; no FK so A can pass a request not stored yet
  PRIMARY KEY (from_id, to_id, task_type)
);

-- History of org_edges writes: A inserts one row per edge it creates or changes. previous_confidence is null for a new
-- edge. No FK to org_edges (history outlives edges); reason and request_id are optional.
CREATE TABLE org_edge_changes (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at          timestamptz NOT NULL DEFAULT now(),
  from_id             text NOT NULL REFERENCES actors (id),
  to_id               text NOT NULL REFERENCES actors (id),
  task_type           text NOT NULL,
  previous_confidence real CHECK (previous_confidence BETWEEN 0 AND 1),
  confidence          real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source              text NOT NULL CHECK (source IN ('chart', 'learned')),
  delegate_until      timestamptz,
  reason              text,                                  -- e.g. redirected, delegated, reinforced
  request_id          text                                   -- no FK: live requests exist only as events
);
CREATE INDEX ON org_edge_changes (from_id, to_id, task_type, changed_at DESC);

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
  released_at        timestamptz,
  CHECK (end_at > start_at)
);

-- No two live bookings of one room may overlap. Needs btree_gist; skipped (with a notice) where it is unavailable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status <> 'cancelled');
  ELSE
    RAISE NOTICE 'btree_gist unavailable: bookings_no_overlap skipped';
  END IF;
END $$;

-- Every hop with how long the receiver held it (until the next hop, or until resolved; null while open).
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

-- HR masking for lanes B and Darwin: same columns and placeholder as the Snowflake hr_text policy.
CREATE VIEW requests_public AS
SELECT id, task_type,
       CASE WHEN hr_sensitive THEN '[visible to HR only]' ELSE title END AS title,
       requester_id, created_at, status, resolved_at, resolved_by,
       CASE WHEN hr_sensitive THEN '[visible to HR only]' ELSE resolution END AS resolution,
       severity, new_hire_name, new_hire_id, room_id, vendor_id, amount_usd, hr_sensitive, origin
FROM requests;

CREATE VIEW request_hops_public AS
SELECT h.request_id, r.task_type, r.hr_sensitive, h.seq, h.from_id, h.to_id, h.at, h.outcome, h.redirect_to,
       CASE WHEN r.hr_sensitive THEN '[visible to HR only]' ELSE h.note END AS note
FROM request_hops h
JOIN requests r ON r.id = h.request_id;

-- events with request text keys in payload (title, note, resolution) masked when the linked request is HR-sensitive.
-- Other keys, and events of non-HR requests or with no request, pass through unchanged.
CREATE VIEW events_public AS
SELECT e.id, e.ts, e.type, e.actor, e.request_id, e.tool,
       CASE WHEN r.hr_sensitive THEN e.payload || (
         SELECT coalesce(jsonb_object_agg(k, to_jsonb('[visible to HR only]'::text)), '{}')
         FROM jsonb_object_keys(e.payload) AS k
         WHERE k IN ('title', 'note', 'resolution')
       ) ELSE e.payload END AS payload
FROM events e
LEFT JOIN requests r ON r.id = e.request_id;

-- Insights. Plain views over the live tables, so every new request, hop, or resolution changes the numbers.
-- History stats use resolved requests only.

-- "Last 10 new hires averaged N days and M hops."
CREATE VIEW insights_new_hires AS
WITH last10 AS (
  SELECT r.id, r.created_at, r.resolved_at,
         (SELECT count(*) FROM request_hops h WHERE h.request_id = r.id) AS hops
  FROM requests r
  WHERE r.task_type = 'onboarding' AND r.status = 'resolved'
  ORDER BY r.created_at DESC
  LIMIT 10
)
SELECT count(*)::int AS requests,
       round(avg(extract(epoch FROM resolved_at - created_at)::numeric) / 86400, 2) AS avg_days,
       round(avg(hops)::numeric, 2) AS avg_hops
FROM last10;

-- Checkout incidents: first hop straight to Platform Engineering (team or one of its people) vs routed via others.
CREATE VIEW insights_checkout AS
SELECT CASE WHEN a.department_id = 'dept_platform' THEN 'direct' ELSE 'routed' END AS path,
       count(*)::int AS incidents,
       round(avg(extract(epoch FROM r.resolved_at - r.created_at)::numeric) / 60) AS avg_minutes,
       round(avg((SELECT count(*) FROM request_hops x WHERE x.request_id = r.id))::numeric, 1) AS avg_hops
FROM requests r
JOIN request_hops h ON h.request_id = r.id AND h.seq = 1
JOIN actors a ON a.id = h.to_id
WHERE r.task_type = 'checkout_incident' AND r.status = 'resolved'
GROUP BY 1
ORDER BY 1;

-- Hours each department (including its people) held requests, and how much of that ended in "not us".
CREATE VIEW insights_bottlenecks AS
SELECT row_number() OVER (ORDER BY sum(s.hours) DESC, d.name)::int AS rank,
       d.id AS department_id,
       d.name AS department,
       count(*)::int AS hops_received,
       round(sum(s.hours), 1) AS total_hours,
       round(avg(s.hours), 1) AS avg_hours,
       (count(*) FILTER (WHERE s.outcome = 'bounced'))::int AS bounces,
       round(coalesce(sum(s.hours) FILTER (WHERE s.outcome = 'bounced'), 0), 1) AS bounce_hours,
       round(100.0 * count(*) FILTER (WHERE s.outcome = 'bounced') / count(*), 1) AS bounce_pct
FROM hop_steps s
JOIN actors d ON d.id = s.to_department_id
WHERE s.status = 'resolved'
GROUP BY d.id, d.name
ORDER BY rank;

-- Average hours from a handoff until the receiver passed it on or resolved it (same definition as the Snowflake
-- vp_new_hire_setup view). scope 'new_hires' = last 10 resolved onboarding requests; 'all' = all resolved, 3+ handoffs.
CREATE VIEW insights_slowest_handoffs AS
WITH new_hires AS (
  SELECT id FROM requests
  WHERE task_type = 'onboarding' AND status = 'resolved'
  ORDER BY created_at DESC
  LIMIT 10
),
scoped AS (
  SELECT 'new_hires' AS scope, s.* FROM hop_steps s JOIN new_hires n ON n.id = s.request_id
  UNION ALL
  SELECT 'all', s.* FROM hop_steps s WHERE s.status = 'resolved'
),
grouped AS (
  SELECT s.scope,
         CASE WHEN s.seq = 1 THEN 'Requester' ELSE f.name END AS from_name,
         CASE WHEN s.seq = 1 THEN NULL ELSE fd.name END AS from_department,
         t.name AS to_name,
         td.name AS to_department,
         count(*)::int AS handoffs,
         avg(s.hours) AS avg_hours,
         sum(s.hours) AS total_hours
  FROM scoped s
  JOIN actors f ON f.id = s.from_id
  LEFT JOIN actors fd ON fd.id = f.department_id
  JOIN actors t ON t.id = s.to_id
  LEFT JOIN actors td ON td.id = t.department_id
  GROUP BY 1, 2, 3, 4, 5
)
SELECT scope,
       row_number() OVER (PARTITION BY scope ORDER BY avg_hours DESC, handoffs DESC, from_name, to_name)::int AS rank,
       from_name, from_department, to_name, to_department, handoffs,
       round(avg_hours, 1) AS avg_hours,
       round(total_hours, 1) AS total_hours
FROM grouped
WHERE scope = 'new_hires' OR handoffs >= 3
ORDER BY scope DESC, rank;

-- Hours saved (or lost), one row per metric.
--   checkout_direct_paging: routed checkout incidents x (routed avg - direct avg). Backs the Darwin rule.
--   bounces: hours requests sat with a team that then said "not us".
--   agent_routing: requests the agent created live, vs the seeded average for the same task type.
CREATE VIEW insights_hours_saved AS
WITH checkout AS (
  SELECT (a.department_id = 'dept_platform') AS direct,
         extract(epoch FROM r.resolved_at - r.created_at)::numeric / 3600 AS hours
  FROM requests r
  JOIN request_hops h ON h.request_id = r.id AND h.seq = 1
  JOIN actors a ON a.id = h.to_id
  WHERE r.task_type = 'checkout_incident' AND r.status = 'resolved'
),
baseline AS (
  SELECT task_type, avg(extract(epoch FROM resolved_at - created_at)::numeric) / 3600 AS hours
  FROM requests
  WHERE origin = 'seed' AND status = 'resolved'
  GROUP BY task_type
),
agent AS (
  SELECT r.id, b.hours - extract(epoch FROM r.resolved_at - r.created_at)::numeric / 3600 AS saved
  FROM requests r
  JOIN baseline b USING (task_type)
  WHERE r.origin = 'agent' AND r.status = 'resolved'
)
SELECT 'checkout_direct_paging' AS metric, 'saved' AS kind,
       (count(*) FILTER (WHERE NOT direct))::int AS basis_count, 'routed checkout incidents' AS basis,
       round(count(*) FILTER (WHERE NOT direct)
             * (avg(hours) FILTER (WHERE NOT direct) - avg(hours) FILTER (WHERE direct)), 1) AS hours
FROM checkout
UNION ALL
SELECT 'bounces', 'lost', count(*)::int, 'bounced hops', round(coalesce(sum(hours), 0), 1)
FROM hop_steps
WHERE status = 'resolved' AND outcome = 'bounced'
UNION ALL
SELECT 'agent_routing', 'saved', count(*)::int, 'resolved agent requests', round(coalesce(sum(saved), 0), 1)
FROM agent;
