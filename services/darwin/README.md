# services/darwin

Owner: **Lane C**

Python service that replays past requests and evolves routing rules, exposed as a small API.
Read-only on Tiger Data (login `wayfinder_web`). Design, numbers and API shapes: [PLAN.md](PLAN.md).
Shared contract mirrors are in `models.py`; Darwin's own API types are in `schemas.py`.

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py                 # http://localhost:8100 (DARWIN_PORT)
.venv/bin/python check.py endpoints     # with the service running
```

Env (root `.env`): `TIGER_DATABASE_URL` (host and database only), `TIGER_WEB_PASSWORD`, optional `DARWIN_PORT`, `DARWIN_CORS_ORIGINS`.
