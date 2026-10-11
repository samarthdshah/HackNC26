# Quick check (PLAN.md section 6).
#   .venv/bin/python check.py snapshot > before.json   Tiger state Darwin could change (it cannot)
#   .venv/bin/python check.py endpoints                 call every endpoint of a running service
#   .venv/bin/python check.py compare before.json       snapshot again and diff

import json
import os
import sys
import urllib.error
import urllib.request

from dotenv import load_dotenv

from db import ROOT

load_dotenv(ROOT / ".env", override=False)
BASE = (os.environ.get("DARWIN_URL") or f"http://localhost:{os.environ.get('DARWIN_PORT') or 8100}").rstrip("/")

RULES = {
    "entry:checkout_incident:dept_platform",
    "entry:dashboard_request:dept_analytics_eng",
    "skip:onboarding:dept_people>dept_workplace",
}
FROZEN = {"entry:data_access:dept_analytics_eng", "skip:onboarding:dept_data_platform>dept_analytics_eng"}

failures = 0


def ok(label: str, cond: bool, detail: object = "") -> None:
    global failures
    failures += not cond
    print(f"{'PASS' if cond else 'FAIL'}  {label}{f'  ({detail})' if detail != '' else ''}")


def call(method: str, path: str, body: object = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def endpoints() -> None:
    s, h = call("GET", "/health")
    ok("GET /health", s == 200 and h["ok"] and h["login"] == "wayfinder_web" and h["requests"] == 83, h)

    s, b = call("GET", "/baseline")
    hist = b.get("history", {})
    ok("GET /baseline history 83 / 2986.1 h / 255 hops / 36 bounces",
       s == 200 and (hist["requests"], hist["hours"], hist["hops"], hist["bounces"]) == (83, 2986.1, 255, 36), hist)

    s, latest = call("GET", "/runs/latest")
    ok("GET /runs/latest (startup run cached)", s == 200 and latest.get("run_id", "").startswith("run_42_"), latest.get("run_id"))

    s, r = call("POST", "/evolve", {})
    ok("POST /evolve", s == 200, s)
    rules = {x["id"]: x for x in r["best"]["rules"]}
    ok("3 rules found", set(rules) == RULES, sorted(rules))
    ok("same rules as the startup run", {x["id"] for x in latest["best"]["rules"]} == set(rules))
    sc, d = r["best"]["score"], r["delta"]
    ok("best 2768.9 h / 239 hops / 24 bounces", (sc["hours"], sc["hops"], sc["bounces"]) == (2768.9, 239, 24), sc)
    ok("delta 217.2 h / 16 hops / 12 bounces", (d["hours"], d["hops"], d["bounces"]) == (217.2, 16, 12), d)
    ok("GA = exhaustive", r["exhaustive_check"]["matches"], r["exhaustive_check"])
    co = rules["entry:checkout_incident:dept_platform"]["evidence"]
    ok("checkout 169.2 -> 71.7 min, 3.17 -> 2.0 hops, 3 -> 0 bounces",
       (co["before"]["avg_minutes"], co["after"]["avg_minutes"], co["before"]["avg_hops"], co["after"]["avg_hops"],
        co["before"]["bounces"], co["after"]["bounces"]) == (169.2, 71.7, 3.17, 2.0, 3, 0), co["before"] | {"after": co["after"]})
    da = rules["entry:dashboard_request:dept_analytics_eng"]["evidence"]
    ok("dashboard 50.28 -> 28.8 h avg, 107.4 h saved, 3 -> 0 bounces",
       (da["before"]["avg_hours"], da["after"]["avg_hours"], da["hours_saved"], da["bounces_avoided"]) == (50.28, 28.8, 107.4, 3))
    on = rules["skip:onboarding:dept_people>dept_workplace"]["evidence"]
    ok("onboarding 100.1 h saved, 16 -> 10 bounces, 6.43 -> 6.0 hops",
       (on["hours_saved"], on["before"]["bounces"], on["after"]["bounces"], on["before"]["avg_hops"], on["after"]["avg_hops"])
       == (100.1, 16, 10, 6.43, 6.0))
    frozen = {x["id"]: x for x in r["left_for_live_learning"]}
    ok("left_for_live_learning holds the 2 frozen rules", set(frozen) == FROZEN, sorted(frozen))
    ok("frozen rules carry numbers",
       all(x["status"] == "frozen" and x["evidence"]["hours_saved"] > 0 for x in frozen.values()),
       {k: (v["evidence"]["hours_saved"], v["evidence"]["bounces_avoided"]) for k, v in frozen.items()})
    ok("no frozen rule proposed", not (set(rules) & FROZEN))

    s, rp = call("POST", "/replay", {"rules": [
        {"kind": "entry", "task_type": "checkout_incident", "to": "dept_platform"},
        {"kind": "entry", "task_type": "dashboard_request", "to": "dept_analytics_eng"},
        {"kind": "skip", "task_type": "onboarding", "avoid": "dept_people", "use": "dept_workplace"},
    ]})
    ok("POST /replay matches /evolve", s == 200 and rp["delta"] == d, rp.get("delta"))

    s, a = call("POST", "/rules/entry:checkout_incident:dept_platform/approve")
    ok("POST /rules/{id}/approve", s == 200 and a["status"] == "approved", a.get("status"))
    s, j = call("POST", "/rules/entry:dashboard_request:dept_analytics_eng/reject")
    ok("POST /rules/{id}/reject", s == 200 and j["status"] == "rejected", j.get("status"))
    s, _ = call("POST", "/rules/entry:data_access:dept_analytics_eng/approve")
    ok("frozen rule cannot be approved (409)", s == 409, s)

    s, hint = call("GET", "/route-hint?task_type=checkout_incident&severity=sev1")
    ok("GET /route-hint checkout -> prefer dept_platform", s == 200 and hint["prefer"] == "dept_platform", hint)
    s, hint = call("GET", "/route-hint?task_type=dashboard_request")
    ok("rejected rule gives no hint", s == 200 and hint["prefer"] is None and not hint["rule_ids"], hint)
    s, hint = call("GET", "/route-hint?task_type=data_access")
    ok("data_access never hinted", s == 200 and hint["prefer"] is None and not hint["redirects"] and not hint["rule_ids"], hint)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "endpoints"
    if cmd == "snapshot":
        import db

        print(json.dumps(db.snapshot()))
        return
    if cmd == "compare":
        import db

        before, after = json.load(open(sys.argv[2])), db.snapshot()
        ok("Tiger unchanged (row counts, org_edges digest, tuple writes)", before == after, {"before": before, "after": after})
    else:
        endpoints()
    print(f"\n{'PASS' if not failures else f'FAIL ({failures})'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
