# Darwin API (PLAN.md section 5). Reads Tiger as wayfinder_web, evolves routing
# rules once at startup, caches the result, and keeps approvals in memory.
# Writes nothing to Tiger.

import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import db
import evolve
import genes as gene_pool
from replay import WEIGHTS, Data, Gene, Replayer
from schemas import (
    Baseline,
    Best,
    Delta,
    Evidence,
    EvolveParams,
    EvolveResult,
    ExhaustiveCheck,
    Generation,
    Health,
    ReplayIn,
    ReplayOut,
    RouteHint,
    Rule,
    RuleSpec,
    TaskTypeTotals,
)

state: dict = {"data": {}, "latest": None, "approvals": {}}


def loaded(origin: str) -> tuple[Data, Replayer]:
    if origin not in state["data"]:
        data = db.load(origin)
        state["data"][origin] = (data, Replayer(data))
    return state["data"][origin]


def to_rule(g: Gene, data: Data, rp: Replayer, pool: gene_pool.Pool, status: str) -> Rule:
    before, after, per_request = rp.compare(g.task_type, [g])
    changed = [p.id for p in per_request if (p.before_hours, p.before_hops, p.before_bounces) != (p.after_hours, p.after_hops, p.after_bounces)]
    return Rule(
        id=g.id,
        kind=g.kind,
        task_type=g.task_type,
        to=g.to,
        avoid=g.avoid,
        use=g.use,
        when={"severity": list(g.severity)} if g.severity else None,
        text=gene_pool.describe(g, data),
        status=status,
        evidence=Evidence(
            requests=before.requests,
            support=pool.support.get(g.id),
            bounces_seen=pool.bounces.get(g.id),
            request_ids=[p.id for p in per_request],
            changed_request_ids=changed,
            before=before,
            after=after,
            hours_saved=round(before.hours - after.hours, 1),
            hops_saved=before.hops - after.hops,
            bounces_avoided=before.bounces - after.bounces,
            per_request=per_request,
        ),
    )


def delta(rp: Replayer, after) -> Delta:
    base = rp.base
    return Delta(
        hours=round(round(base.hours, 1) - round(after.hours, 1), 1),  # difference of the shown totals
        pct_hours=round(100 * (base.hours - after.hours) / base.hours, 1) if base.hours else 0.0,
        hops=base.hops - after.hops,
        bounces=base.bounces - after.bounces,
    )


def run_evolution(params: EvolveParams, reload: bool) -> EvolveResult:
    started = time.perf_counter()
    if reload:
        state["data"].pop(params.origin, None)
    data, rp = loaded(params.origin)
    pool = gene_pool.build(data, rp)
    if not pool.searchable:
        raise HTTPException(409, "No candidate rules in the loaded history")
    best, best_fit, stats = evolve.run(rp, pool.searchable, params.seed, params.population, params.generations, params.max_rules)
    exhaustive_best, sets = evolve.exhaustive(rp, pool.searchable, params.max_rules)
    n = len(data.requests)
    best_ids = sorted(g.id for g in best)
    result = EvolveResult(
        run_id=f"run_{params.seed}_{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        params=params,
        weights=WEIGHTS,
        replayed=n,
        gene_pool=[g.id for g in pool.searchable],
        baseline=rp.totals(rp.base, n, rp.fitness([])),
        best=Best(
            fitness=round(best_fit, 1),
            score=rp.totals(rp.score(best), n, best_fit),
            rules=[to_rule(g, data, rp, pool, "proposed") for g in sorted(best, key=lambda g: g.id)],
        ),
        delta=delta(rp, rp.score(best)),
        generations=[Generation(**s) for s in stats],
        left_for_live_learning=[to_rule(g, data, rp, pool, "frozen") for g in pool.frozen],
        confirmed_by_history=pool.confirmed,
        exhaustive_check=ExhaustiveCheck(
            sets=sets,
            best_rule_ids=sorted(g.id for g in exhaustive_best),
            matches=sorted(g.id for g in exhaustive_best) == best_ids,
        ),
        runtime_ms=0,
    )
    result.runtime_ms = int((time.perf_counter() - started) * 1000)
    state["latest"] = result
    return result


def with_status(result: EvolveResult) -> EvolveResult:
    out = result.model_copy(deep=True)
    for r in out.best.rules:
        r.status = state["approvals"].get(r.id, "proposed")
    return out


@asynccontextmanager
async def lifespan(_: FastAPI):
    run_evolution(EvolveParams(), reload=True)  # once at startup, cached
    yield


app = FastAPI(title="Darwin", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("DARWIN_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", response_model=Health)
def health():
    data, _ = loaded("all")
    latest = state["latest"]
    tiger = db.tiger_configured()
    return Health(ok=latest is not None, tiger=tiger, login=db.LOGIN if tiger else "fixtures (no Tiger configured)", requests=len(data.requests),
                  run_id=latest.run_id if latest else None)


@app.get("/baseline", response_model=Baseline)
def baseline(origin: str = "all"):
    if origin not in ("all", "seed"):
        raise HTTPException(422, "origin must be all or seed")
    data, rp = loaded(origin)
    by_type = [
        TaskTypeTotals(task_type=t, top_route=data.top_routes.get(t),
                       **rp.totals(o, len(data.by_type[t])).model_dump())
        for t, o in sorted(rp.base_by_type.items(), key=lambda kv: -kv[1].hours)
    ]
    return Baseline(origin=origin, history=rp.totals(rp.base, len(data.requests), rp.fitness([])), by_task_type=by_type)


@app.post("/evolve", response_model=EvolveResult)
def evolve_now(params: Optional[EvolveParams] = None):
    return with_status(run_evolution(params or EvolveParams(), reload=True))


@app.get("/runs/latest", response_model=EvolveResult)
def runs_latest():
    if not state["latest"]:
        raise HTTPException(404, "No run yet")
    return with_status(state["latest"])


def to_gene(spec: RuleSpec, data: Data) -> Gene:
    if spec.kind == "entry":
        if not spec.to or spec.to not in data.actors:
            raise HTTPException(422, f"entry rule needs a known `to`: {spec.to}")
        sev = tuple(sorted(spec.when.get("severity", []))) if spec.when else None
        return Gene("entry", spec.task_type, to=spec.to, severity=sev or None)
    if not spec.avoid or not spec.use or spec.avoid not in data.actors or spec.use not in data.actors:
        raise HTTPException(422, "skip rule needs known `avoid` and `use`")
    return Gene("skip", spec.task_type, avoid=spec.avoid, use=spec.use)


@app.post("/replay", response_model=ReplayOut)
def replay(body: ReplayIn, origin: str = "all"):
    if origin not in ("all", "seed"):
        raise HTTPException(422, "origin must be all or seed")
    data, rp = loaded(origin)
    gs = [to_gene(s, data) for s in body.rules]
    if not evolve.valid(gs, max_rules=max(1, len(gs))) and gs:
        raise HTTPException(422, "At most one entry rule per task type")
    pool = gene_pool.build(data, rp)
    after = rp.score(gs)
    n = len(data.requests)
    return ReplayOut(
        baseline=rp.totals(rp.base, n, rp.fitness([])),
        score=rp.totals(after, n, rp.fitness(gs)),
        delta=delta(rp, after),
        rules=[to_rule(g, data, rp, pool, "frozen" if gene_pool.is_frozen(g) else "proposed") for g in gs],
    )


def _decide(rule_id: str, status: str) -> Rule:
    latest = state["latest"]
    if latest and any(r.id == rule_id for r in latest.left_for_live_learning):
        raise HTTPException(409, "Left for live learning: this rule cannot be approved or rejected")
    rule = next((r for r in latest.best.rules if r.id == rule_id), None) if latest else None
    if not rule:
        raise HTTPException(404, f"No proposed rule {rule_id} in the latest run")
    state["approvals"][rule_id] = status
    return rule.model_copy(update={"status": status})


@app.post("/rules/{rule_id}/approve", response_model=Rule)
def approve(rule_id: str):
    return _decide(rule_id, "approved")


@app.post("/rules/{rule_id}/reject", response_model=Rule)
def reject(rule_id: str):
    return _decide(rule_id, "rejected")


@app.get("/route-hint", response_model=RouteHint)
def route_hint(task_type: str, severity: Optional[str] = None):
    if task_type in gene_pool.FROZEN_TASK_TYPES:
        return RouteHint(task_type=task_type, reason="Left for live learning: Darwin never hints this task type")
    latest = state["latest"]
    rules = [
        r for r in (latest.best.rules if latest else [])
        if r.task_type == task_type and state["approvals"].get(r.id) == "approved"
    ]
    hint = RouteHint(task_type=task_type, reason="No approved Darwin rule for this task type")
    for r in rules:
        if r.kind == "entry" and (not r.when or severity in r.when.get("severity", [])):
            hint.prefer = r.to
            hint.rule_ids.append(r.id)
        elif r.kind == "skip":
            hint.redirects.append({"avoid": r.avoid, "use": r.use})
            hint.rule_ids.append(r.id)
    if hint.rule_ids:
        hint.reason = "; ".join(r.text for r in rules if r.id in hint.rule_ids)
    return hint


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("DARWIN_PORT") or 8100))
