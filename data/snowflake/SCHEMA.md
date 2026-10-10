# PHOTON.ORG schema reference

- **Database:** `PHOTON` · **Schema:** `ORG`
- All data is simulated (the fictional company Photon). Loaded from `data/fixtures` by `npm --prefix data run snowflake:load`.
- Bookings and org map edges are live data and live in Tiger Data, not Snowflake.
- The SQL API returns `DATE` as days since 1970 and `TIMESTAMP_TZ` as epoch seconds plus an offset code. Wrap them in `TO_VARCHAR(...)` in queries to get readable text.
- Sample rows below are the first 5 by the listed sort key. Dates are shown as text and long text is cut to 60 characters.

| Table | Rows |
|---|---|
| [company](#company) | 1 |
| [departments](#departments) | 10 |
| [people](#people) | 24 |
| [rooms](#rooms) | 6 |
| [vendors](#vendors) | 6 |
| [budgets](#budgets) | 8 |
| [policies](#policies) | 11 |
| [requests](#requests) | 84 |
| [request_hops](#request_hops) | 256 |

Views: [vp_new_hire_setup](#vp_new_hire_setup) (VP only).

## company

One row: company name, email domain, timezone, demo date, and start of the request history. **1 rows.** Sample sorted by `name`.

| Column | Type | Nullable |
|---|---|---|
| `name` | VARCHAR(16777216) | yes |
| `domain` | VARCHAR(16777216) | yes |
| `timezone` | VARCHAR(16777216) | yes |
| `demo_date` | DATE | yes |
| `history_start` | DATE | yes |
| `note` | VARCHAR(16777216) | yes |

| name | domain | timezone | demo_date | history_start | note |
|---|---|---|---|---|---|
| Photon | photon.example | America/New_York | 2026-10-10 | 2026-05-01 | Simulated company for HackNC 2026. All people, vendors, a... |

## departments

Departments with their head and charter (what each one handles). **10 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `name` | VARCHAR(16777216) | yes |
| `head_id` | VARCHAR(16777216) | yes |
| `cost_center` | VARCHAR(16777216) | yes |
| `charter` | VARCHAR(16777216) | yes |

| id | name | head_id | cost_center | charter |
|---|---|---|---|---|
| dept_analytics_eng | Analytics Engineering | p_priya | CC-220 | Curated data marts, dashboards, and analyst warehouse acc... |
| dept_commerce | Commerce Engineering | p_nina | CC-230 | Storefront, cart, and checkout product code. |
| dept_data_platform | Data Platform | p_raj | CC-210 | Raw data ingestion, pipelines, and warehouse infrastructure. |
| dept_finance | Finance & Procurement | p_hannah | CC-130 | Budgets, purchase approvals, vendor onboarding, vendor pa... |
| dept_hr | HR | p_teresa | CC-140 | Benefits, leave and time off, payroll questions, employee... |

## people

Directory: department, title, manager, out-of-office status and delegate, access tier, skills. **24 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `name` | VARCHAR(16777216) | yes |
| `email` | VARCHAR(16777216) | yes |
| `department_id` | VARCHAR(16777216) | yes |
| `role` | VARCHAR(16777216) | yes |
| `manager_id` | VARCHAR(16777216) | yes |
| `status` | VARCHAR(16777216) | yes |
| `out_until` | DATE | yes |
| `delegate_id` | VARCHAR(16777216) | yes |
| `start_date` | DATE | yes |
| `location` | VARCHAR(16777216) | yes |
| `access_role` | VARCHAR(16777216) | yes |
| `skills` | ARRAY | yes |

| id | name | email | department_id | role | manager_id | status | out_until | delegate_id | start_date | location | access_role | skills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p_aisha | Aisha Khan | aisha@photon.example | dept_platform | Site Reliability Engineer (on-call) | p_marcus | active |  |  | 2023-01-09 | Remote | employee | sre, observability, postgres |
| p_andre | Andre Wallace | andre@photon.example | dept_hr | HR Generalist | p_teresa | active |  |  | 2024-08-19 | Durham HQ | employee | benefits, leave administration, payroll |
| p_ben | Ben Carter | ben@photon.example | dept_finance | Procurement Specialist | p_hannah | active |  |  | 2023-04-03 | Remote | finance | procurement, vendor contracts, payments |
| p_dana | Dana Whitfield | dana@photon.example | dept_platform | VP Engineering & Operations |  | active |  |  | 2021-03-01 | Durham HQ | vp | strategy, budgeting, hiring |
| p_elena | Elena Petrova | elena@photon.example | dept_data_platform | Data Engineer | p_raj | active |  |  | 2024-07-15 | Remote | employee | python, kafka, dbt |

## rooms

Bookable rooms with floor, capacity, and features. Bookings themselves are in Tiger Data. **6 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `name` | VARCHAR(16777216) | yes |
| `floor` | NUMBER(38,0) | yes |
| `capacity` | NUMBER(38,0) | yes |
| `features` | ARRAY | yes |

| id | name | floor | capacity | features |
|---|---|---|---|---|
| rm_atlas | Atlas | 3 | 8 | video conferencing |
| rm_commons | The Commons | 1 | 30 | catering allowed, projector, whiteboard, kitchen access |
| rm_harbor | Harbor | 2 | 12 | video conferencing, whiteboard |
| rm_nook | The Nook | 3 | 4 | phone booth |
| rm_studio | Studio | 2 | 16 | projector, video conferencing |

## vendors

External vendors: owning department, approval status, lead time, pricing, payment methods. **6 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `name` | VARCHAR(16777216) | yes |
| `category` | VARCHAR(16777216) | yes |
| `contact_name` | VARCHAR(16777216) | yes |
| `contact_email` | VARCHAR(16777216) | yes |
| `approved` | BOOLEAN | yes |
| `preferred` | BOOLEAN | yes |
| `owner_department_id` | VARCHAR(16777216) | yes |
| `lead_time_hours` | NUMBER(38,0) | yes |
| `pricing` | VARCHAR(16777216) | yes |
| `payment_methods` | ARRAY | yes |

| id | name | category | contact_name | contact_email | approved | preferred | owner_department_id | lead_time_hours | pricing | payment_methods |
|---|---|---|---|---|---|---|---|---|---|---|
| v_badgeworks | BadgeWorks | badges and swag | Ellie Grant | hello@badgeworks.example | true | false | dept_workplace | 48 | Badge plus welcome kit $65. | invoice, card |
| v_greenleaf | Greenleaf Catering | catering | Rosa Delgado | orders@greenleaf.example | true | true | dept_workplace | 24 | Boxed lunches $22 per person, 6 person minimum. Same-day ... | invoice, solana_devnet |
| v_northwind | Northwind Devices | hardware | Carla Moss | sales@northwind.example | true | true | dept_it | 72 | Standard laptop bundle $1,850. | invoice |
| v_pagerline | PagerLine | incident paging software | Support | billing@pagerline.example | true | true | dept_platform | 0 | $29 per seat per month. | card |
| v_paperleaf | Paperleaf Office Supply | office supplies | Accounts | accounts@paperleaf.example | false | false | dept_finance | 48 | Catalog pricing. Procurement review pending. | invoice |

## budgets

2026-Q4 budget lines per department: amount, spent, owner. **8 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `department_id` | VARCHAR(16777216) | yes |
| `category` | VARCHAR(16777216) | yes |
| `period` | VARCHAR(16777216) | yes |
| `amount_usd` | NUMBER(12,2) | yes |
| `spent_usd` | NUMBER(12,2) | yes |
| `owner_id` | VARCHAR(16777216) | yes |

| id | department_id | category | period | amount_usd | spent_usd | owner_id |
|---|---|---|---|---|---|---|
| b_analytics_tools | dept_analytics_eng | BI tooling | 2026-Q4 | 8000.00 | 3100.00 | p_priya |
| b_commerce_events | dept_commerce | team events | 2026-Q4 | 2000.00 | 640.00 | p_nina |
| b_data_platform_tools | dept_data_platform | warehouse and pipelines | 2026-Q4 | 18000.00 | 9900.00 | p_raj |
| b_finance_ops | dept_finance | finance operations | 2026-Q4 | 5000.00 | 1200.00 | p_hannah |
| b_it_hardware | dept_it | hardware | 2026-Q4 | 25000.00 | 14200.00 | p_jess |

## policies

Policy handbook sections. Gemini answers policy questions from this text. **11 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `title` | VARCHAR(16777216) | yes |
| `owner_department_id` | VARCHAR(16777216) | yes |
| `updated` | DATE | yes |
| `text` | VARCHAR(16777216) | yes |

| id | title | owner_department_id | updated | text |
|---|---|---|---|---|
| POL-ACCESS-1 | Who can see what | dept_legal | 2026-03-30 | Every employee can see the directory, room availability, ... |
| POL-DATA-1 | Data access tiers | dept_analytics_eng | 2026-03-02 | Tier 1 is curated marts and dashboards. Analytics Enginee... |
| POL-INC-1 | Checkout and payments incidents | dept_commerce | 2025-11-12 | Report checkout or payment problems to Commerce Engineeri... |
| POL-INC-2 | Infrastructure incidents | dept_platform | 2025-11-12 | Page Platform Engineering on-call directly through PagerL... |
| POL-IT-1 | Laptops and accounts | dept_it | 2026-01-20 | IT provides one standard laptop from Northwind Devices to... |

## requests

Past requests (warehouse copy of history): who asked, status, timing, resolver, hop count, HR flag. Includes Leo's open demo request. **84 rows.** Sample sorted by `id`.

| Column | Type | Nullable |
|---|---|---|
| `id` | VARCHAR(16777216) | yes |
| `task_type` | VARCHAR(16777216) | yes |
| `title` | VARCHAR(16777216) | yes |
| `requester_id` | VARCHAR(16777216) | yes |
| `created_at` | TIMESTAMP_TZ(9) | yes |
| `status` | VARCHAR(16777216) | yes |
| `resolved_at` | TIMESTAMP_TZ(9) | yes |
| `resolved_by` | VARCHAR(16777216) | yes |
| `resolution` | VARCHAR(16777216) | yes |
| `severity` | VARCHAR(16777216) | yes |
| `new_hire_name` | VARCHAR(16777216) | yes |
| `new_hire_id` | VARCHAR(16777216) | yes |
| `room_id` | VARCHAR(16777216) | yes |
| `vendor_id` | VARCHAR(16777216) | yes |
| `amount_usd` | NUMBER(12,2) | yes |
| `hop_count` | NUMBER(38,0) | yes |
| `hr_sensitive` | BOOLEAN | yes |

| id | task_type | title | requester_id | created_at | status | resolved_at | resolved_by | resolution | severity | new_hire_name | new_hire_id | room_id | vendor_id | amount_usd | hop_count | hr_sensitive |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| req_0001 | onboarding | Onboard Jordan Blake | p_marcus | 2026-05-04 10:25 -04:00 | resolved | 2026-05-09 20:25 -04:00 | dept_workplace | Desk assigned and badge printed. New hire fully set up. |  | Jordan Blake |  |  |  |  | 7 | false |
| req_0002 | room_booking | Book room for team sync | p_elena | 2026-05-05 14:05 -04:00 | resolved | 2026-05-05 15:51 -04:00 | p_luis | Room booked. |  |  |  | rm_studio |  |  | 2 | false |
| req_0003 | catering | Catering for all-hands | p_nina | 2026-05-12 11:05 -04:00 | resolved | 2026-05-12 22:21 -04:00 | p_maya | Ordered from Greenleaf Catering. |  |  |  |  | v_greenleaf | 220.00 | 2 | false |
| req_0004 | checkout_incident | Checkout latency spike on card payments | p_victor | 2026-05-14 14:10 -04:00 | resolved | 2026-05-14 17:20 -04:00 | p_aisha | Rolled back the bad config on the payments gateway. Check... | sev2 |  |  |  |  |  | 4 | false |
| req_0005 | onboarding | Onboard Ken Watanabe | p_jess | 2026-05-18 14:56 -04:00 | resolved | 2026-05-24 12:56 -04:00 | dept_workplace | Desk assigned and badge printed. New hire fully set up. |  | Ken Watanabe | p_ken |  |  |  | 8 | false |

## request_hops

One row per hop in each request's routing chain, in seq order. Join to requests on request_id. **256 rows.** Sample sorted by `request_id, seq`.

| Column | Type | Nullable |
|---|---|---|
| `request_id` | VARCHAR(16777216) | yes |
| `task_type` | VARCHAR(16777216) | yes |
| `hr_sensitive` | BOOLEAN | yes |
| `seq` | NUMBER(38,0) | yes |
| `from_id` | VARCHAR(16777216) | yes |
| `to_id` | VARCHAR(16777216) | yes |
| `at` | TIMESTAMP_TZ(9) | yes |
| `outcome` | VARCHAR(16777216) | yes |
| `redirect_to` | VARCHAR(16777216) | yes |
| `note` | VARCHAR(16777216) | yes |

| request_id | task_type | hr_sensitive | seq | from_id | to_id | at | outcome | redirect_to | note |
|---|---|---|---|---|---|---|---|---|---|
| req_0001 | onboarding | false | 1 | p_marcus | dept_people | 2026-05-04 10:25 -04:00 | forwarded |  | Onboarding ticket opened. Laptop and accounts go to IT. |
| req_0001 | onboarding | false | 2 | dept_people | dept_it | 2026-05-04 22:15 -04:00 | forwarded |  | Laptop imaged, SSO and email live. Sending data access on... |
| req_0001 | onboarding | false | 3 | dept_it | dept_data_platform | 2026-05-05 20:22 -04:00 | bounced | dept_analytics_eng | Not us. Analyst warehouse access is Analytics Engineering. |
| req_0001 | onboarding | false | 4 | dept_data_platform | dept_analytics_eng | 2026-05-06 14:04 -04:00 | forwarded |  | Needs lead approval. |
| req_0001 | onboarding | false | 5 | dept_analytics_eng | p_priya | 2026-05-07 11:13 -04:00 | forwarded |  | ANALYST role approved. Sending back to People Ops for des... |

## vp_new_hire_setup

Secure view (defined in `roles.sql`) that answers Dana's question "Why do new hires take so long to get set up?". It covers the 10 most recent resolved onboarding requests and returns one row per finding, keyed by `section`:

- `summary`: one row with the average days to set up and the average hops.
- `slowest_handoff`: one row per handoff (sender to receiver), ranked by average hours from the handoff until the receiver passed the request on or resolved it. The first hop's sender is shown as `Requester`. Handoff hours add up to the requests' total time, so `pct_of_time` shows where the time goes.
- `bouncing_department`: one row per department that bounced a request ("not us, try X"), ranked by bounce count. Hours are the time the department held the request before bouncing it.

Ids are resolved to department and person names. The view has no request text (titles, resolutions, hop notes), so HR masking never applies. Columns that do not apply to a section are null.

| Column | Type | Sections | Meaning |
|---|---|---|---|
| `section` | VARCHAR | all | `summary`, `slowest_handoff`, or `bouncing_department` |
| `rank` | NUMBER | all | 1 = slowest handoff or most bounces; always 1 for `summary` |
| `requests` | NUMBER | summary, bouncing_department | Requests in the sample (10), or requests the department bounced |
| `avg_days` | NUMBER(10,2) | summary | Average days from created to resolved |
| `avg_hops` | NUMBER(10,2) | summary | Average hops per request |
| `from_name` | VARCHAR | slowest_handoff | Sender: department or person name, or `Requester` |
| `from_department` | VARCHAR | slowest_handoff | Sender's department (null for `Requester`) |
| `to_name` | VARCHAR | slowest_handoff | Receiver: department or person name |
| `to_department` | VARCHAR | slowest_handoff | Receiver's department |
| `department` | VARCHAR | bouncing_department | Department that bounced the request |
| `bounced_to` | VARCHAR | bouncing_department | Where it said to go instead (comma-separated names) |
| `handoffs` | NUMBER | slowest_handoff | Times this handoff happened in the sample |
| `bounces` | NUMBER | bouncing_department | Bounces by this department in the sample |
| `avg_hours` | NUMBER(38,1) | slowest_handoff, bouncing_department | Average hours the receiver held the request |
| `total_hours` | NUMBER(37,1) | slowest_handoff, bouncing_department | Total hours across the sample |
| `pct_of_time` | NUMBER(38,1) | slowest_handoff, bouncing_department | Share of the sample's total setup time, in percent |

**Who can read it:** `PHOTON_VP` only (Dana), plus `PHOTON_APP`, which contains every tier role and must not run user queries. `PHOTON_MANAGER`, `PHOTON_HR_HEAD`, `PHOTON_HR`, `PHOTON_FINANCE`, and `PHOTON_EMPLOYEE` are refused (002003). `snowflake:load` does not drop the view, but rerun `snowflake:roles` after every load as usual.
