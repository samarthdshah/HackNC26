# Darwin's own API types. Not shared: the shared mirrors are in models.py
# (see PLAN.md section 7 for the proposal to share these).

from typing import Literal, Optional

from pydantic import BaseModel, Field

NOTE = "Simulated company data (Photon)."


class Totals(BaseModel):
    requests: int
    hours: float
    avg_hours: float
    hops: int
    avg_hops: float
    bounces: int
    fitness: Optional[float] = None


class Side(BaseModel):
    """One side of a before/after comparison for a rule's task type."""

    requests: int
    hours: float
    avg_hours: float
    avg_minutes: float
    hops: int
    avg_hops: float
    bounces: int


class RequestDelta(BaseModel):
    id: str
    before_hours: float
    after_hours: float
    before_hops: int
    after_hops: int
    before_bounces: int
    after_bounces: int


class Evidence(BaseModel):
    requests: int  # resolved requests of this task type
    support: Optional[int] = None  # entry: requests that already went to `to` first
    bounces_seen: Optional[int] = None  # bounces this rule targets
    request_ids: list[str]
    changed_request_ids: list[str]
    before: Side
    after: Side
    hours_saved: float
    hops_saved: int
    bounces_avoided: int
    per_request: list[RequestDelta]


class RuleSpec(BaseModel):
    """A rule as a caller sends it (POST /replay)."""

    kind: Literal["entry", "skip"]
    task_type: str
    to: Optional[str] = None  # entry
    avoid: Optional[str] = None  # skip
    use: Optional[str] = None  # skip
    when: Optional[dict[str, list[str]]] = None  # entry only: {"severity": ["sev1"]}


class Rule(RuleSpec):
    id: str
    text: str
    status: Literal["proposed", "approved", "rejected", "frozen"] = "proposed"
    evidence: Optional[Evidence] = None


class Generation(BaseModel):
    gen: int
    best_fitness: float
    mean_fitness: float
    best_rule_ids: list[str]


class Confirmed(BaseModel):
    """A bounce the org map already avoids: the agent routes this task type to `route` today."""

    task_type: str
    bounced_by: str
    route: str
    route_name: str
    bounces_avoided: int
    hours: float


class ExhaustiveCheck(BaseModel):
    sets: int
    best_rule_ids: list[str]
    matches: bool


class EvolveParams(BaseModel):
    seed: int = 42
    population: int = Field(30, ge=4, le=500)
    generations: int = Field(10, ge=1, le=500)  # the best set is found by generation 2
    max_rules: int = Field(3, ge=1, le=5)
    origin: Literal["all", "seed"] = "all"


class Best(BaseModel):
    fitness: float
    score: Totals
    rules: list[Rule]


class Delta(BaseModel):
    hours: float
    pct_hours: float
    hops: int
    bounces: int


class EvolveResult(BaseModel):
    run_id: str
    params: EvolveParams
    weights: dict[str, float]
    replayed: int
    gene_pool: list[str]
    baseline: Totals
    best: Best
    delta: Delta
    generations: list[Generation]
    left_for_live_learning: list[Rule]
    confirmed_by_history: list[Confirmed]
    exhaustive_check: ExhaustiveCheck
    runtime_ms: int
    note: str = NOTE


class TaskTypeTotals(Totals):
    task_type: str
    top_route: Optional[str] = None


class Baseline(BaseModel):
    origin: Literal["all", "seed"]
    history: Totals
    by_task_type: list[TaskTypeTotals]
    note: str = NOTE


class ReplayIn(BaseModel):
    rules: list[RuleSpec]


class ReplayOut(BaseModel):
    baseline: Totals
    score: Totals
    delta: Delta
    rules: list[Rule]
    note: str = NOTE


class RouteHint(BaseModel):
    task_type: str
    prefer: Optional[str] = None
    # skip rules: if the route lands on `avoid`, send it to `use` instead
    redirects: list[dict[str, str]] = Field(default_factory=list)
    rule_ids: list[str] = Field(default_factory=list)
    reason: str


class Health(BaseModel):
    ok: bool
    tiger: bool
    login: str
    requests: int
    run_id: Optional[str] = None
