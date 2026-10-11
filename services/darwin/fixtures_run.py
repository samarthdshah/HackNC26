# Darwin on the fixtures: for the web snapshot while Tiger is offline.
#
# Builds the same `Data` that db.load() returns, but from data/fixtures/*.json instead of
# Tiger (actors = departments + people + agent, resolved seed requests with their hops,
# the agent's top route per task type from the chart edges), then runs the exact pipeline
# behind POST /evolve (app.run_evolution with the default EvolveParams) and prints the
# EvolveResult JSON, the same body GET /runs/latest returns. Read-only: writes nothing.
#
#   .venv/bin/python fixtures_run.py > ../../apps/web/lib/wf/fallback/darwin-run.json

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import app  # imports db (and psycopg) but never connects: the cache is filled below
from replay import Actor, Data, Hop, Replayer, Request
from schemas import EvolveParams

FIXTURES = Path(__file__).resolve().parents[2] / "data" / "fixtures"


def _json(name: str):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def load(origin: str = "all") -> Data:
    """Mirror of db.load() over the fixtures. Every fixture request has origin 'seed'."""
    departments, people = _json("departments"), _json("people")
    actors = {d["id"]: Actor(d["id"], "department", d["name"], d["id"]) for d in departments}
    actors.update({p["id"]: Actor(p["id"], "person", p["name"], p["department_id"]) for p in people})
    actors["agent"] = Actor("agent", "agent", "Wayfinder", None)

    rows = [r for r in _json("requests") if r["status"] == "resolved" and origin in ("all", "seed")]
    rows.sort(key=lambda r: (_ts(r["created_at"]), r["id"]))
    requests = []
    for r in rows:
        hops = [
            Hop(h["seq"], h["from"], h["to"], _ts(h["at"]), h["outcome"], h.get("redirect_to"))
            for h in sorted(r.get("hops", []), key=lambda h: h["seq"])
        ]
        if hops:
            requests.append(Request(r["id"], r["task_type"], r.get("severity"), _ts(r["created_at"]), _ts(r["resolved_at"]), "seed", hops))

    now = datetime.now(timezone.utc)
    edges = [
        e for e in _json("edges")
        if e["from"] == "agent" and (not e.get("delegate_until") or _ts(e["delegate_until"]) > now)
    ]
    edges.sort(key=lambda e: (e["task_type"], -e["confidence"], e["to"]))
    top_routes: dict[str, str] = {}
    for e in edges:
        top_routes.setdefault(e["task_type"], e["to"])
    return Data(requests=requests, actors=actors, top_routes=top_routes, origin=origin)


def main() -> None:
    params = EvolveParams()  # same defaults as POST /evolve with no body (seed 42)
    data = load(params.origin)
    app.state["data"][params.origin] = (data, Replayer(data))
    result = app.with_status(app.run_evolution(params, reload=False))
    sys.stdout.write(result.model_dump_json(indent=2) + "\n")


if __name__ == "__main__":
    main()
