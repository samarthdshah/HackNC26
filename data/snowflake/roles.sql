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

-- 6. Service user for lane A. No password; Lane C's owner creates its PAT in Snowsight.
CREATE USER IF NOT EXISTS WAYFINDER_AGENT TYPE = SERVICE COMMENT = 'Lane A agent server (Wayfinder OS)';
ALTER USER WAYFINDER_AGENT SET
  TYPE = SERVICE
  DEFAULT_ROLE = PHOTON_APP
  DEFAULT_WAREHOUSE = {{WAREHOUSE}}
  DEFAULT_NAMESPACE = '{{DATABASE}}.{{SCHEMA}}'
  NETWORK_POLICY = hacknc_open;
GRANT ROLE PHOTON_APP TO USER WAYFINDER_AGENT;
