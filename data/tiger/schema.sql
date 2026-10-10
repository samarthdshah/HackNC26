-- Tiger Data schema for Wayfinder OS (S4). See PLAN.md.
-- Safe to rerun: drops and recreates every object. Applied by seed.ts inside the seed transaction.
-- Columns use from_id/to_id (from and to are reserved); API code maps them back to the shared OrgEdge/Event names.

CREATE EXTENSION IF NOT EXISTS timescaledb;

DROP FUNCTION IF EXISTS learn_edge(text, text, text, text, text, timestamptz);
DROP TABLE IF EXISTS events, request_hops, bookings, org_edges, requests, actors CASCADE;

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
  hr_sensitive  boolean NOT NULL DEFAULT false,         -- leave_request, benefits_question, employee_relations
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

-- Shared type: OrgEdge. Natural key (from, to, task_type).
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

-- "Not us, try X": lower the wrong edge, add or raise the right one, and log one edge_updated event per changed edge.
-- Step sizes (-0.3, +0.2, new at 0.8) are placeholders. Returns the changed edges.
CREATE FUNCTION learn_edge(
  p_from       text,
  p_wrong_to   text,                 -- null when only adding (e.g. a delegate)
  p_right_to   text,
  p_task_type  text,
  p_request_id text DEFAULT NULL,
  p_until      timestamptz DEFAULT NULL
) RETURNS SETOF org_edges
LANGUAGE plpgsql AS $$
DECLARE
  e    org_edges;
  prev real;
BEGIN
  IF p_wrong_to IS NOT NULL THEN
    SELECT confidence INTO prev FROM org_edges
    WHERE from_id = p_from AND to_id = p_wrong_to AND task_type = p_task_type FOR UPDATE;
    IF FOUND THEN
      UPDATE org_edges SET confidence = greatest(round((confidence - 0.3)::numeric, 2), 0)::real, updated_at = now()
      WHERE from_id = p_from AND to_id = p_wrong_to AND task_type = p_task_type
      RETURNING * INTO e;
      INSERT INTO events (type, actor, request_id, payload)
      VALUES ('edge_updated', 'agent', p_request_id, jsonb_strip_nulls(jsonb_build_object(
        'from', e.from_id, 'to', e.to_id, 'task_type', e.task_type, 'confidence', e.confidence,
        'source', e.source, 'delegate_until', e.delegate_until)) || jsonb_build_object('previous_confidence', prev));
      RETURN NEXT e;
    END IF;
  END IF;

  prev := NULL;
  SELECT confidence INTO prev FROM org_edges
  WHERE from_id = p_from AND to_id = p_right_to AND task_type = p_task_type FOR UPDATE;
  INSERT INTO org_edges (from_id, to_id, task_type, confidence, source, delegate_until, learned_from)
  VALUES (p_from, p_right_to, p_task_type, 0.8, 'learned', p_until, p_request_id)
  ON CONFLICT (from_id, to_id, task_type) DO UPDATE SET
    confidence     = least(round((org_edges.confidence + 0.2)::numeric, 2), 1)::real,
    source         = 'learned',
    delegate_until = EXCLUDED.delegate_until,
    learned_from   = EXCLUDED.learned_from,
    updated_at     = now()
  RETURNING * INTO e;
  INSERT INTO events (type, actor, request_id, payload)
  VALUES ('edge_updated', 'agent', p_request_id, jsonb_strip_nulls(jsonb_build_object(
    'from', e.from_id, 'to', e.to_id, 'task_type', e.task_type, 'confidence', e.confidence,
    'source', e.source, 'delegate_until', e.delegate_until)) || jsonb_build_object('previous_confidence', prev));
  RETURN NEXT e;
END $$;
