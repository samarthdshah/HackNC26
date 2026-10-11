# Read-only access to Tiger Data as wayfinder_web. Darwin never connects as any
# other login and never writes: the login has no write grants, and every session
# is opened with default_transaction_read_only = on.

import os
from pathlib import Path
from urllib.parse import urlsplit

import certifi
import psycopg
from dotenv import load_dotenv

from replay import Actor, Data, Hop, Request

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", override=False)

LOGIN = "wayfinder_web"


def connect() -> psycopg.Connection:
    url = os.environ.get("TIGER_DATABASE_URL", "").strip()
    password = os.environ.get("TIGER_WEB_PASSWORD", "").strip()
    if not url or not password:
        raise RuntimeError("TIGER_DATABASE_URL and TIGER_WEB_PASSWORD must be set in the root .env")
    u = urlsplit(url)  # host and database only; user and password from the URL are ignored
    conn = psycopg.connect(
        host=u.hostname,
        port=u.port or 5432,
        dbname=u.path.lstrip("/") or "tsdb",
        user=LOGIN,
        password=password,
        sslmode="verify-full",
        sslrootcert=certifi.where(),  # verify-full against Mozilla CAs (bundled libpq has no macOS store)
        options="-c default_transaction_read_only=on",
        connect_timeout=10,
        application_name="darwin",
    )
    user, read_only = conn.execute(
        "select current_user, current_setting('default_transaction_read_only')"
    ).fetchone()
    if user != LOGIN or read_only != "on":
        conn.close()
        raise RuntimeError(f"Darwin must run as {LOGIN} read-only, got {user} read_only={read_only}")
    return conn


def load(origin: str = "all") -> Data:
    """Resolved requests with their hops, actors, and the agent's live top routes."""
    with connect() as conn:
        reqs = conn.execute(
            """select id, task_type, severity, created_at, resolved_at, origin
                 from requests_public
                where status = 'resolved' and (%s = 'all' or origin = %s)
                order by created_at, id""",
            (origin, origin),
        ).fetchall()
        hops = conn.execute(
            """select request_id, seq, from_id, to_id, at, outcome, redirect_to
                 from request_hops_public order by request_id, seq"""
        ).fetchall()
        actors = conn.execute("select id, kind, name, department_id from actors").fetchall()
        edges = conn.execute(
            """select task_type, to_id from org_edges
                where from_id = 'agent' and (delegate_until is null or delegate_until > now())
                order by task_type, confidence desc, to_id"""
        ).fetchall()

    by_req: dict[str, list[Hop]] = {}
    for request_id, seq, from_id, to_id, at, outcome, redirect_to in hops:
        by_req.setdefault(request_id, []).append(Hop(seq, from_id, to_id, at, outcome, redirect_to))
    requests = [
        Request(rid, task_type, severity, created_at, resolved_at, org, by_req[rid])
        for rid, task_type, severity, created_at, resolved_at, org in reqs
        if by_req.get(rid)
    ]
    top_routes: dict[str, str] = {}
    for task_type, to_id in edges:
        top_routes.setdefault(task_type, to_id)
    return Data(
        requests=requests,
        actors={a[0]: Actor(*a) for a in actors},
        top_routes=top_routes,
        origin=origin,
    )


def snapshot() -> dict:
    """What a write would change: row counts, an org_edges digest, and tuple write stats."""
    with connect() as conn:
        counts = conn.execute(
            """select (select count(*) from requests_public), (select count(*) from request_hops_public),
                      (select count(*) from events_public), (select count(*) from org_edges),
                      (select count(*) from org_edge_changes), (select count(*) from actors),
                      (select count(*) from bookings)"""
        ).fetchone()
        digest = conn.execute(
            """select md5(coalesce(string_agg(concat_ws('|', from_id, to_id, task_type, confidence, source,
                                                         delegate_until, updated_at, learned_from), ';'
                                               order by from_id, to_id, task_type), ''))
                 from org_edges"""
        ).fetchone()[0]
        writes = conn.execute(
            """select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint
                 from pg_stat_user_tables where schemaname in ('public', '_timescaledb_internal')"""
        ).fetchone()[0]
    names = ["requests_public", "request_hops_public", "events_public", "org_edges", "org_edge_changes", "actors", "bookings"]
    return {"counts": dict(zip(names, counts)), "org_edges_md5": digest, "tuple_writes": int(writes)}
