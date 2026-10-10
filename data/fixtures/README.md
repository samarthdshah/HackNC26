# data/fixtures

Owner: **Lane C**

Simulated company "Photon" as JSON. Static org data goes to Snowflake; requests and edges go to Tiger Data.
Times are ISO 8601 in America/New_York (`-04:00`). History runs 2026-05-01 to 2026-10-09; the demo date is 2026-10-10.

| File | Contents |
|---|---|
| `company.json` | Name, timezone, demo date |
| `departments.json` | 10 departments with `head_id` (HR and Legal are 9 and 10) |
| `people.json` | 24 people: `department_id`, `role`, `manager_id`, `status` (`active`/`out`), `out_until`, `delegate_id`, `access_role`, `skills` |
| `rooms.json`, `bookings.json` | Rooms and today's bookings |
| `vendors.json`, `budgets.json` | Vendors and Q4 budget lines |
| `policies.json` | Handbook sections (`id`, `title`, `text`) for Cortex |
| `edges.json` | Starting org map as `OrgEdge` records. `from: "agent"` means the agent's first route for that task type |
| `requests.json` | Past requests with hop chains (`from`, `to`, `at`, `outcome`, `redirect_to`), plus Leo's open demo request. `req_0076`-`req_0083` are the HR and Legal requests, added later, so ids are not in date order |

Hop outcomes: `forwarded` (did their part, passed it on), `bounced` (not theirs, see `redirect_to`), `delegated` (out, see `redirect_to`), `handled` (closed it).

## Demo moments

- **Leo's first day:** `req_demo_leo` (open). Leo asks Data Platform for warehouse access; it bounces to Analytics Engineering.
- **Priya out:** `p_priya` is `out` until 2026-10-16 with `delegate_id: p_tom`; edges `p_priya -> p_tom` carry `delegate_until`.
- **Sam's Commons booking:** `bk_sam_commons`, 11:00-13:00, used until 12:00.
- **Caterer:** `v_greenleaf` (Greenleaf Catering).
- **Checkout incidents:** six `checkout_incident` requests; the ones paged straight to Platform resolve faster.
- **New-hire stat:** computed from the last 10 resolved `onboarding` requests.

Run `npm --prefix data run check` (Node 22.6+) to validate and print the computed numbers.
