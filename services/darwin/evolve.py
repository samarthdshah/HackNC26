# Evolution: a small genetic algorithm over rule sets (PLAN.md section 3.2),
# plus an exhaustive search that proves the GA's answer.

import itertools
import random

from replay import Gene, Replayer

ELITES = 2
TOURNAMENT = 3


def valid(genome, max_rules: int) -> bool:
    entries = [g.task_type for g in genome if g.kind == "entry"]
    return 1 <= len(genome) <= max_rules and len(entries) == len(set(entries))


def _key(genome) -> tuple[str, ...]:
    return tuple(sorted(g.id for g in genome))


def _repair(genes: list[Gene], rng: random.Random, max_rules: int) -> frozenset:
    out: list[Gene] = []
    seen_entry: set[str] = set()
    for g in sorted(set(genes), key=lambda g: g.id):
        if g.kind == "entry":
            if g.task_type in seen_entry:
                continue
            seen_entry.add(g.task_type)
        out.append(g)
    if len(out) > max_rules:
        out = rng.sample(out, max_rules)
    return frozenset(out)


def run(rp: Replayer, pool: list[Gene], seed: int, population: int, generations: int, max_rules: int):
    """Returns (best genome, its fitness, per-generation stats)."""
    rng = random.Random(seed)
    cache: dict[tuple[str, ...], float] = {}

    def fit(genome) -> float:
        k = _key(genome)
        if k not in cache:
            cache[k] = rp.fitness(genome)
        return cache[k]

    def rank(pop):
        return sorted(pop, key=lambda gn: (fit(gn), _key(gn)))

    def tournament(pop):
        return min(rng.sample(pop, min(TOURNAMENT, len(pop))), key=lambda gn: (fit(gn), _key(gn)))

    def mutate(genes: list[Gene]) -> list[Gene]:
        op = rng.choice(["add", "drop", "swap"])
        if op == "drop" and len(genes) > 1:
            genes.remove(rng.choice(sorted(genes, key=lambda g: g.id)))
        elif op == "swap" and genes:
            old = rng.choice(sorted(genes, key=lambda g: g.id))
            same = [g for g in pool if g.task_type == old.task_type and g != old]
            if same:
                genes[genes.index(old)] = rng.choice(same)
        else:
            missing = [g for g in pool if g not in genes]
            if missing:
                genes.append(rng.choice(missing))
        return genes

    # Start from single rules, so the curve shows rules combining over generations.
    pop = [frozenset([rng.choice(pool)]) for _ in range(population)]
    stats = []
    for gen in range(generations):
        pop = rank(pop)
        fits = [fit(gn) for gn in pop]
        stats.append(
            {"gen": gen, "best_fitness": round(fits[0], 1), "mean_fitness": round(sum(fits) / len(fits), 1),
             "best_rule_ids": list(_key(pop[0]))}
        )
        if gen == generations - 1:
            break
        nxt = pop[:ELITES]
        while len(nxt) < population:
            a, b = tournament(pop), tournament(pop)
            union = sorted(a | b, key=lambda g: g.id)
            child = [g for g in union if rng.random() < 0.5] or [rng.choice(union)]
            nxt.append(_repair(mutate(child), rng, max_rules))
        pop = nxt
    best = rank(pop)[0]
    return best, fit(best), stats


def exhaustive(rp: Replayer, pool: list[Gene], max_rules: int):
    """Every valid rule set up to max_rules. Returns (best genome, number of sets)."""
    sets = [
        frozenset(c)
        for k in range(1, max_rules + 1)
        for c in itertools.combinations(pool, k)
        if valid(c, max_rules)
    ]
    best = min(sets, key=lambda gn: (rp.fitness(gn), _key(gn)))
    return best, len(sets)
