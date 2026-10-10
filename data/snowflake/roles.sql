-- Roles, grants, and policies that enforce POL-ACCESS-1 on {{DATABASE}}.{{SCHEMA}}.
-- Re-runnable. Run with: npm --prefix data run snowflake:roles (as ACCOUNTADMIN).
-- snowflake:load replaces the tables, which drops grants and policy attachments: rerun this after every load.
-- {{DATABASE}}, {{SCHEMA}}, {{WAREHOUSE}} are filled in from .env by roles.ts.
--
-- Per-person rows (own requests, team requests, own budget lines) are filtered by lane A's query tools.
-- Snowflake enforces which tables each tier can read, which request rows HR-only roles see, and HR masking.

-- 1. Roles and hierarchy.
--    EMPLOYEE -> MANAGER, FINANCE, HR.  MANAGER + HR -> HR_HEAD.  MANAGER + FINANCE -> VP.
--    All six -> PHOTON_APP -> SYSADMIN. Never run user queries as PHOTON_APP: it contains PHOTON_HR.
CREATE ROLE IF NOT EXISTS PHOTON_EMPLOYEE COMMENT = 'Directory, rooms, policies, vendors';
CREATE ROLE IF NOT EXISTS PHOTON_MANAGER COMMENT = 'Employee + budgets + request history';
CREATE ROLE IF NOT EXISTS PHOTON_FINANCE COMMENT = 'Employee + all budget lines';
CREATE ROLE IF NOT EXISTS PHOTON_HR COMMENT = 'Employee + HR request history, unmasked';
CREATE ROLE IF NOT EXISTS PHOTON_HR_HEAD COMMENT = 'Manager + HR';
CREATE ROLE IF NOT EXISTS PHOTON_VP COMMENT = 'Manager + Finance: all requests and spend, HR text masked';
CREATE ROLE IF NOT EXISTS PHOTON_APP COMMENT = 'Lane A service role; switches to a tier role per statement';

GRANT ROLE PHOTON_EMPLOYEE TO ROLE PHOTON_MANAGER;
GRANT ROLE PHOTON_EMPLOYEE TO ROLE PHOTON_FINANCE;
GRANT ROLE PHOTON_EMPLOYEE TO ROLE PHOTON_HR;
GRANT ROLE PHOTON_MANAGER TO ROLE PHOTON_HR_HEAD;
GRANT ROLE PHOTON_HR TO ROLE PHOTON_HR_HEAD;
GRANT ROLE PHOTON_MANAGER TO ROLE PHOTON_VP;
GRANT ROLE PHOTON_FINANCE TO ROLE PHOTON_VP;
GRANT ROLE PHOTON_EMPLOYEE TO ROLE PHOTON_APP;
GRANT ROLE PHOTON_MANAGER TO ROLE PHOTON_APP;
GRANT ROLE PHOTON_FINANCE TO ROLE PHOTON_APP;
GRANT ROLE PHOTON_HR TO ROLE PHOTON_APP;
GRANT ROLE PHOTON_HR_HEAD TO ROLE PHOTON_APP;
GRANT ROLE PHOTON_VP TO ROLE PHOTON_APP;
GRANT ROLE PHOTON_APP TO ROLE SYSADMIN;

-- 2. Table grants.
GRANT USAGE ON WAREHOUSE {{WAREHOUSE}} TO ROLE PHOTON_EMPLOYEE;
GRANT USAGE ON DATABASE {{DATABASE}} TO ROLE PHOTON_EMPLOYEE;
GRANT USAGE ON SCHEMA {{DATABASE}}.{{SCHEMA}} TO ROLE PHOTON_EMPLOYEE;
GRANT SELECT ON TABLE company TO ROLE PHOTON_EMPLOYEE;
GRANT SELECT ON TABLE departments TO ROLE PHOTON_EMPLOYEE;
GRANT SELECT ON TABLE people TO ROLE PHOTON_EMPLOYEE;
GRANT SELECT ON TABLE rooms TO ROLE PHOTON_EMPLOYEE;
GRANT SELECT ON TABLE policies TO ROLE PHOTON_EMPLOYEE;
GRANT SELECT ON TABLE vendors TO ROLE PHOTON_EMPLOYEE;
-- Request history is not granted to EMPLOYEE, so Snowflake refuses an employee's history questions outright.
-- An employee's own open requests are live data in Tiger Data.
GRANT SELECT ON TABLE budgets TO ROLE PHOTON_MANAGER;
GRANT SELECT ON TABLE requests TO ROLE PHOTON_MANAGER;
GRANT SELECT ON TABLE request_hops TO ROLE PHOTON_MANAGER;
GRANT SELECT ON TABLE budgets TO ROLE PHOTON_FINANCE;
GRANT SELECT ON TABLE requests TO ROLE PHOTON_HR;
GRANT SELECT ON TABLE request_hops TO ROLE PHOTON_HR;

-- 3. Row access: HR-only roles see only HR request types; MANAGER and above see all rows.
CREATE ROW ACCESS POLICY IF NOT EXISTS hr_rows AS (task_type STRING) RETURNS BOOLEAN -> TRUE;
ALTER ROW ACCESS POLICY hr_rows SET BODY ->
  IS_ROLE_IN_SESSION('PHOTON_MANAGER')
  OR (IS_ROLE_IN_SESSION('PHOTON_HR') AND task_type IN ('leave_request', 'benefits_question', 'employee_relations'));
ALTER TABLE requests DROP ALL ROW ACCESS POLICIES;
ALTER TABLE requests ADD ROW ACCESS POLICY hr_rows ON (task_type);
ALTER TABLE request_hops DROP ALL ROW ACCESS POLICIES;
ALTER TABLE request_hops ADD ROW ACCESS POLICY hr_rows ON (task_type);

-- 4. Masking: HR request text is visible only when PHOTON_HR is in the session's role hierarchy.
--    Keyed on hr_sensitive (set by load.ts), because a column cannot be in both a masking and a row access policy signature.
CREATE MASKING POLICY IF NOT EXISTS hr_text AS (val STRING, hr_sensitive BOOLEAN) RETURNS STRING -> val;
ALTER MASKING POLICY hr_text SET BODY ->
  CASE
    WHEN hr_sensitive AND NOT IS_ROLE_IN_SESSION('PHOTON_HR') THEN '[visible to HR only]'
    ELSE val
  END;
ALTER TABLE requests MODIFY COLUMN title SET MASKING POLICY hr_text USING (title, hr_sensitive) FORCE;
ALTER TABLE requests MODIFY COLUMN resolution SET MASKING POLICY hr_text USING (resolution, hr_sensitive) FORCE;
ALTER TABLE request_hops MODIFY COLUMN note SET MASKING POLICY hr_text USING (note, hr_sensitive) FORCE;

-- 5. person_roles: which tier role lane A's query tools use for each person.
CREATE OR REPLACE TABLE person_roles AS
SELECT
  id AS person_id,
  CASE
    WHEN access_role = 'vp' THEN 'PHOTON_VP'
    WHEN access_role = 'finance' THEN 'PHOTON_FINANCE'
    WHEN access_role = 'manager' AND department_id = 'dept_hr' THEN 'PHOTON_HR_HEAD'
    WHEN access_role = 'manager' THEN 'PHOTON_MANAGER'
    WHEN department_id = 'dept_hr' THEN 'PHOTON_HR'
    ELSE 'PHOTON_EMPLOYEE'
  END AS role_name
FROM people;
GRANT SELECT ON TABLE person_roles TO ROLE PHOTON_APP;

-- 6. VP metrics: Dana's "Why do new hires take so long to get set up?" from the last 10 resolved onboarding requests.
--    One row per finding, keyed by section: 'summary' (avg days, avg hops), 'slowest_handoff' (ranked by avg hours
--    until the receiver passed the request on or resolved it), 'bouncing_department' (ranked by bounces).
--    Ids are resolved to department and person names; no request text, so HR masking never applies.
--    Secure, so the definition is hidden from readers. Only PHOTON_VP (and PHOTON_APP above it) can read it.
CREATE OR REPLACE SECURE VIEW vp_new_hire_setup AS
  WITH last10 AS (
    SELECT id, created_at, resolved_at, hop_count
    FROM requests
    WHERE task_type = 'onboarding' AND status = 'resolved'
    ORDER BY created_at DESC
    LIMIT 10
  ),
  actors AS (
    SELECT id, name, name AS department FROM departments
    UNION ALL
    SELECT p.id, p.name, d.name FROM people p LEFT JOIN departments d ON d.id = p.department_id
  ),
  steps AS (
    SELECT
      h.request_id, h.seq, h.from_id, h.to_id, h.outcome, h.redirect_to,
      DATEDIFF('second', h.at, COALESCE(LEAD(h.at) OVER (PARTITION BY h.request_id ORDER BY h.seq), l.resolved_at)) / 3600 AS hours
    FROM request_hops h
    JOIN last10 l ON l.id = h.request_id
  ),
  total AS (SELECT SUM(hours) AS hours FROM steps),
  handoffs AS (
    SELECT
      IFF(s.seq = 1, 'Requester', f.name) AS from_name,
      IFF(s.seq = 1, NULL, f.department) AS from_department,
      t.name AS to_name,
      t.department AS to_department,
      COUNT(*) AS n,
      AVG(s.hours) AS avg_hours,
      SUM(s.hours) AS sum_hours
    FROM steps s
    JOIN actors f ON f.id = s.from_id
    JOIN actors t ON t.id = s.to_id
    GROUP BY 1, 2, 3, 4
  ),
  bounces AS (
    SELECT
      t.department,
      COUNT(*) AS n,
      COUNT(DISTINCT s.request_id) AS requests,
      AVG(s.hours) AS avg_hours,
      SUM(s.hours) AS sum_hours,
      LISTAGG(DISTINCT r.name, ', ') WITHIN GROUP (ORDER BY r.name) AS bounced_to
    FROM steps s
    JOIN actors t ON t.id = s.to_id
    LEFT JOIN actors r ON r.id = s.redirect_to
    WHERE s.outcome = 'bounced'
    GROUP BY 1
  )
  SELECT
    'summary' AS section, 1 AS rank,
    COUNT(*) AS requests,
    ROUND(AVG(DATEDIFF('second', created_at, resolved_at)) / 86400, 2)::NUMBER(10, 2) AS avg_days,
    ROUND(AVG(hop_count), 2)::NUMBER(10, 2) AS avg_hops,
    NULL AS from_name, NULL AS from_department, NULL AS to_name, NULL AS to_department, NULL AS department, NULL AS bounced_to,
    NULL AS handoffs, NULL AS bounces, NULL AS avg_hours, NULL AS total_hours, NULL AS pct_of_time
  FROM last10
  UNION ALL
  SELECT
    'slowest_handoff', ROW_NUMBER() OVER (ORDER BY h.avg_hours DESC, h.n DESC, h.from_name, h.to_name),
    NULL, NULL, NULL,
    h.from_name, h.from_department, h.to_name, h.to_department, NULL, NULL,
    h.n, NULL, ROUND(h.avg_hours, 1), ROUND(h.sum_hours, 1), ROUND(100 * h.sum_hours / total.hours, 1)
  FROM handoffs h, total
  UNION ALL
  SELECT
    'bouncing_department', ROW_NUMBER() OVER (ORDER BY b.n DESC, b.sum_hours DESC, b.department),
    b.requests, NULL, NULL,
    NULL, NULL, NULL, NULL, b.department, b.bounced_to,
    NULL, b.n, ROUND(b.avg_hours, 1), ROUND(b.sum_hours, 1), ROUND(100 * b.sum_hours / total.hours, 1)
  FROM bounces b, total
  ORDER BY 1 DESC, 2;
GRANT SELECT ON VIEW vp_new_hire_setup TO ROLE PHOTON_VP;

-- 7. Lane A metrics: resolution hours and hops by task type, resolved requests only. No dates and no request text
--    (titles, resolutions, notes), so HR masking never applies. hr_rows still filters by the reader's roles: PHOTON_APP
--    holds MANAGER, so it sees every task type, including the HR ones, as aggregates only.
CREATE OR REPLACE SECURE VIEW resolution_by_task_type AS
  SELECT
    task_type,
    COUNT(*) AS request_count,
    ROUND(AVG(DATEDIFF('second', created_at, resolved_at)) / 3600, 1)::NUMBER(10, 1) AS avg_resolution_hours,
    ROUND(MEDIAN(DATEDIFF('second', created_at, resolved_at)) / 3600, 1)::NUMBER(10, 1) AS median_resolution_hours,
    ROUND(AVG(hop_count), 2)::NUMBER(10, 2) AS avg_hops
  FROM requests
  WHERE status = 'resolved'
  GROUP BY task_type
  ORDER BY task_type;
GRANT SELECT ON VIEW resolution_by_task_type TO ROLE PHOTON_APP;

-- 8. Service user for lane A. No password; Lane C's owner creates its PAT in Snowsight.
--    DEFAULT_ROLE is PHOTON_APP; DEFAULT_SECONDARY_ROLES is left as is. Every tier role is also granted directly,
--    so lane A can name any of them as the SQL API "role" per statement.
CREATE USER IF NOT EXISTS WAYFINDER_AGENT TYPE = SERVICE COMMENT = 'Lane A agent server (Wayfinder OS)';
ALTER USER WAYFINDER_AGENT SET
  TYPE = SERVICE
  DEFAULT_ROLE = PHOTON_APP
  DEFAULT_WAREHOUSE = {{WAREHOUSE}}
  DEFAULT_NAMESPACE = '{{DATABASE}}.{{SCHEMA}}'
  NETWORK_POLICY = hacknc_open;
GRANT ROLE PHOTON_APP TO USER WAYFINDER_AGENT;
GRANT ROLE PHOTON_EMPLOYEE TO USER WAYFINDER_AGENT;
GRANT ROLE PHOTON_MANAGER TO USER WAYFINDER_AGENT;
GRANT ROLE PHOTON_FINANCE TO USER WAYFINDER_AGENT;
GRANT ROLE PHOTON_HR TO USER WAYFINDER_AGENT;
GRANT ROLE PHOTON_HR_HEAD TO USER WAYFINDER_AGENT;
GRANT ROLE PHOTON_VP TO USER WAYFINDER_AGENT;
