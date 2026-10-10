-- Tiger Data logins for lanes A, B and Darwin. Grants only: no passwords here.
-- Applied by seed.ts after schema.sql (so grants survive a reseed) and by roles.ts (npm run tiger:roles), which also
-- sets LOGIN and the passwords from .env. Safe to rerun: creates missing roles, then revokes and re-grants everything.

-- Created without LOGIN; tiger:roles turns LOGIN on once it has set a password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wayfinder_agent') THEN
    CREATE ROLE wayfinder_agent NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wayfinder_web') THEN
    CREATE ROLE wayfinder_web NOLOGIN;
  END IF;
END $$;

-- Start from nothing so a rerun leaves exactly the grants below.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wayfinder_agent, wayfinder_web;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM wayfinder_agent, wayfinder_web;
REVOKE ALL ON SCHEMA public FROM wayfinder_agent, wayfinder_web;

-- Lane A: writes events, edges and edge history; reads and updates bookings. No reads of requests, hops or events.
GRANT USAGE ON SCHEMA public TO wayfinder_agent;
GRANT INSERT ON events TO wayfinder_agent;
GRANT SELECT, INSERT, UPDATE ON org_edges TO wayfinder_agent;
GRANT INSERT ON org_edge_changes TO wayfinder_agent;
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SEQUENCE %s TO wayfinder_agent', pg_get_serial_sequence('org_edge_changes', 'id'));
END $$;
GRANT SELECT, UPDATE ON bookings TO wayfinder_agent;

-- Lanes B and Darwin: read-only. HR text only through the *_public views; never the base requests, hops or events.
GRANT USAGE ON SCHEMA public TO wayfinder_web;
GRANT SELECT ON
  requests_public, request_hops_public, events_public,
  insights_new_hires, insights_checkout, insights_bottlenecks, insights_slowest_handoffs, insights_hours_saved,
  org_edges, org_edge_changes, actors, bookings
TO wayfinder_web;
