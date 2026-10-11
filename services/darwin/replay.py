# Replay: re-route past requests under a set of rules and score the result.
# Definitions match the Tiger Insights views (PLAN.md section 2).

import statistics
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from schemas import RequestDelta, Side, Totals

WEIGHTS = {"hour": 1.0, "hop": 1.0, "bounce": 2.0, "rule": 2.0}


@dataclass(frozen=True)
class Gene:
    """One routing rule. entry: first hop goes to `to`. skip: never ask `avoid`, go to `use`."""

    kind: str
    task_type: str
    to: Optional[str] = None
    avoid: Optional[str] = None
    use: Optional[str] = None
    severity: Optional[tuple[str, ...]] = None  # entry only

    @property
    def id(self) -> str:
        if self.kind == "entry":
            sev = f"@{'+'.join(self.severity)}" if self.severity else ""
            return f"entry:{self.task_type}:{self.to}{sev}"
        return f"skip:{self.task_type}:{self.avoid}>{self.use}"


@dataclass
class Hop:
    seq: int
    from_id: str
    to_id: str
    at: datetime
    outcome: str
    redirect_to: Optional[str]
    hold: float = 0.0  # hours until the receiver acted


@dataclass
class Request:
    id: str
    task_type: str
    severity: Optional[str]
    created_at: datetime
    resolved_at: datetime
    origin: str
    hops: list[Hop]


@dataclass
class Actor:
    id: str
    kind: str
    name: str
    department_id: Optional[str]


@dataclass
class Data:
    requests: list[Request]
    actors: dict[str, Actor]
    top_routes: dict[str, str]  # task_type -> agent's highest-confidence live route
    origin: str = "all"
    by_type: dict[str, list[Request]] = field(default_factory=dict)

    def dept(self, actor_id: Optional[str]) -> Optional[str]:
        a = self.actors.get(actor_id) if actor_id else None
        return (a.department_id or a.id) if a else actor_id

    def name(self, actor_id: Optional[str]) -> str:
        a = self.actors.get(actor_id) if actor_id else None
        return a.name if a else str(actor_id)


@dataclass(frozen=True)
class Outcome:
    hours: float
    hops: int
    bounces: int


def _hours(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600


class Replayer:
    def __init__(self, data: Data):
        self.data = data
        for r in data.requests:
            for i, h in enumerate(r.hops):
                end = r.hops[i + 1].at if i + 1 < len(r.hops) else r.resolved_at
                h.hold = _hours(h.at, end)
            data.by_type.setdefault(r.task_type, []).append(r)
        bounced = {}
        for r in data.requests:
            for h in r.hops:
                if h.outcome == "bounced":
                    bounced.setdefault(r.task_type, []).append(h.hold)
        every = [x for xs in bounced.values() for x in xs]
        self.global_penalty = statistics.median(every) if every else 0.0
        self.penalty = {t: statistics.median(xs) for t, xs in bounced.items()}
        self.actual = {r.id: self._actual(r) for r in data.requests}
        self.base_by_type = {t: self._sum(self.actual[r.id] for r in rs) for t, rs in data.by_type.items()}
        self.base = self._sum(self.base_by_type.values())
        self._type_cache: dict[tuple[str, frozenset], Outcome] = {}

    @staticmethod
    def _actual(r: Request) -> Outcome:
        return Outcome(_hours(r.created_at, r.resolved_at), len(r.hops), sum(h.outcome == "bounced" for h in r.hops))

    @staticmethod
    def _sum(outcomes) -> Outcome:
        h = n = b = 0
        for o in outcomes:
            h, n, b = h + o.hours, n + o.hops, b + o.bounces
        return Outcome(h, n, b)

    def request(self, r: Request, genes) -> Outcome:
        """Counterfactual for one request under the rules that apply to its task type."""
        genes = [g for g in genes if g.task_type == r.task_type]
        if not genes:
            return self.actual[r.id]
        d = self.data.dept
        start, hops = r.created_at, r.hops
        extra_hours = extra_hops = extra_bounces = 0
        entry = next(
            (g for g in genes if g.kind == "entry" and (not g.severity or r.severity in g.severity)), None
        )
        if entry and d(hops[0].to_id) != entry.to:
            k = next((i for i, h in enumerate(hops) if d(h.to_id) == entry.to), None)
            if k is None:  # misroute: entry.to would have bounced it
                extra_hours = self.penalty.get(r.task_type, self.global_penalty)
                extra_hops = extra_bounces = 1
            else:
                start, hops = hops[k].at, hops[k:]
                if self.data.actors[hops[0].to_id].kind == "person":
                    extra_hops = 1  # agent pages the team, the team hands it to this person
        removed = [
            h
            for h in hops
            if h.outcome == "bounced"
            and any(
                g.kind == "skip" and d(h.to_id) == g.avoid and d(h.redirect_to) == g.use for g in genes
            )
        ]
        kept = [h for h in hops if h not in removed]
        return Outcome(
            _hours(start, r.resolved_at) - sum(h.hold for h in removed) + extra_hours,
            len(kept) + extra_hops,
            sum(h.outcome == "bounced" for h in kept) + extra_bounces,
        )

    def type_outcome(self, task_type: str, genes) -> Outcome:
        genes = frozenset(g for g in genes if g.task_type == task_type)
        if not genes:
            return self.base_by_type[task_type]
        key = (task_type, genes)
        if key not in self._type_cache:
            self._type_cache[key] = self._sum(self.request(r, genes) for r in self.data.by_type[task_type])
        return self._type_cache[key]

    def score(self, genes) -> Outcome:
        types = {g.task_type for g in genes if g.task_type in self.data.by_type}
        h, n, b = self.base.hours, self.base.hops, self.base.bounces
        for t in types:
            before, after = self.base_by_type[t], self.type_outcome(t, genes)
            h, n, b = h - before.hours + after.hours, n - before.hops + after.hops, b - before.bounces + after.bounces
        return Outcome(h, n, b)

    def fitness(self, genes, w=WEIGHTS) -> float:
        s = self.score(genes)
        return w["hour"] * s.hours + w["hop"] * s.hops + w["bounce"] * s.bounces + w["rule"] * len(genes)

    def totals(self, o: Outcome, requests: int, fitness: Optional[float] = None) -> Totals:
        return Totals(
            requests=requests,
            hours=round(o.hours, 1),
            avg_hours=round(o.hours / requests, 2) if requests else 0.0,
            hops=o.hops,
            avg_hops=round(o.hops / requests, 2) if requests else 0.0,
            bounces=o.bounces,
            fitness=None if fitness is None else round(fitness, 1),
        )

    def side(self, outcomes: list[Outcome]) -> Side:
        n = len(outcomes)
        s = self._sum(outcomes)
        return Side(
            requests=n,
            hours=round(s.hours, 1),
            avg_hours=round(s.hours / n, 2) if n else 0.0,
            avg_minutes=round(s.hours * 60 / n, 1) if n else 0.0,
            hops=s.hops,
            avg_hops=round(s.hops / n, 2) if n else 0.0,
            bounces=s.bounces,
        )

    def compare(self, task_type: str, genes) -> tuple[Side, Side, list[RequestDelta]]:
        rs = self.data.by_type.get(task_type, [])
        before = [self.actual[r.id] for r in rs]
        after = [self.request(r, genes) for r in rs]
        deltas = [
            RequestDelta(
                id=r.id,
                before_hours=round(b.hours, 2),
                after_hours=round(a.hours, 2),
                before_hops=b.hops,
                after_hops=a.hops,
                before_bounces=b.bounces,
                after_bounces=a.bounces,
            )
            for r, b, a in zip(rs, before, after)
        ]
        return self.side(before), self.side(after), deltas
