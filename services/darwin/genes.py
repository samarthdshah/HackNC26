# The gene pool: candidate rules built from the loaded history (PLAN.md section 3.1).
# No rule is named here except the frozen list, which protects the live demo.

from dataclasses import dataclass

from replay import Data, Gene, Replayer
from schemas import Confirmed

MIN_SUPPORT = 2  # entry: requests that already went to that department first
MIN_BOUNCES = 2  # skip: times that bounce happened

# Left for the agent to learn live from Leo's reply (PLAN.md section 4). Darwin
# never proposes these, never approves them, and never hints them.
FROZEN_TASK_TYPES = {"data_access"}
FROZEN_REDIRECTS = {("onboarding", "dept_data_platform", "dept_analytics_eng")}  # onboarding's data_access step


def is_frozen(g: Gene) -> bool:
    if g.task_type in FROZEN_TASK_TYPES:
        return True
    redirect = (g.task_type, g.avoid, g.use) if g.kind == "skip" else None
    return redirect in FROZEN_REDIRECTS


@dataclass
class Pool:
    searchable: list[Gene]
    frozen: list[Gene]
    confirmed: list[Confirmed]
    support: dict[str, int]  # gene id -> direct requests (entry)
    bounces: dict[str, int]  # gene id -> bounces targeted (skip, or merged entry)


def build(data: Data, rp: Replayer) -> Pool:
    d = data.dept
    genes: dict[str, Gene] = {}
    support: dict[str, int] = {}
    bounces: dict[str, int] = {}

    # Who bounced which task type, and where to.
    pairs: dict[tuple[str, str, str], dict] = {}
    bouncers: set[tuple[str, str]] = set()
    for r in data.requests:
        for h in r.hops:
            if h.outcome != "bounced" or not h.redirect_to:
                continue
            a, b = d(h.to_id), d(h.redirect_to)
            bouncers.add((r.task_type, a))
            p = pairs.setdefault((r.task_type, a, b), {"n": 0, "hours": 0.0, "seqs": set()})
            p["n"] += 1
            p["hours"] += h.hold
            p["seqs"].add(h.seq)

    # Entry genes: departments that already took this task type first, never bounced it,
    # and are not the agent's current route.
    for t, rs in data.by_type.items():
        firsts: dict[str, int] = {}
        for r in rs:
            firsts[d(r.hops[0].to_id)] = firsts.get(d(r.hops[0].to_id), 0) + 1
        severities = sorted({r.severity for r in rs if r.severity})
        for dept, n in sorted(firsts.items()):
            if n < MIN_SUPPORT or dept == data.top_routes.get(t) or (t, dept) in bouncers:
                continue
            for sev in [None] + [(s,) for s in severities]:
                g = Gene("entry", t, to=dept, severity=sev)
                genes[g.id] = g
                support[g.id] = n

    # Skip genes from bounce pairs.
    confirmed: list[Confirmed] = []
    for (t, a, b), p in sorted(pairs.items()):
        if a == b:
            continue
        if b == data.top_routes.get(t):
            confirmed.append(
                Confirmed(task_type=t, bounced_by=a, route=b, route_name=data.name(b),
                          bounces_avoided=p["n"], hours=round(p["hours"], 1))
            )
            continue
        if p["n"] < MIN_BOUNCES:
            continue
        if p["seqs"] == {1}:  # always the first hop: same effect as sending it to b first
            g = Gene("entry", t, to=b)
        else:
            g = Gene("skip", t, avoid=a, use=b)
        genes.setdefault(g.id, g)
        bounces[g.id] = bounces.get(g.id, 0) + p["n"]

    ordered = sorted(genes.values(), key=lambda g: g.id)
    return Pool(
        searchable=[g for g in ordered if not is_frozen(g)],
        frozen=[g for g in ordered if is_frozen(g) and g.severity is None],
        confirmed=confirmed,
        support=support,
        bounces=bounces,
    )


def type_label(task_type: str) -> str:
    words = task_type.replace("_", " ")
    return words + (" requests" if words.endswith("s") else "s")


def describe(g: Gene, data: Data) -> str:
    """Plain-English rule text from a template."""
    if g.kind == "entry":
        sev = f" ({', '.join(g.severity)} only)" if g.severity else ""
        if g.task_type.endswith("incident"):
            return f"Page {data.name(g.to)} directly for {type_label(g.task_type)}{sev}"
        return f"Send {type_label(g.task_type)} to {data.name(g.to)} first{sev}"
    return f"{g.task_type.replace('_', ' ').capitalize()}: skip {data.name(g.avoid)}, go straight to {data.name(g.use)}"
