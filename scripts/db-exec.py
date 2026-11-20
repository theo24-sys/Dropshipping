#!/usr/bin/env python3
"""Execute SQL against the project database.

Used because this environment has no psql/supabase CLI. Reads DATABASE_URL
from the environment or from the gitignored .env file at the repository root.

    python scripts/db-exec.py supabase/migrations/20261120000100_init.sql
    python scripts/db-exec.py --sql "select count(*) from public.products"

Requires: pip install "psycopg[binary]"
"""
import os
import pathlib
import sys

try:
    import psycopg
except ImportError:  # pragma: no cover
    sys.exit('Missing driver. Run: python -m pip install "psycopg[binary]"')

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    load_env()
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)

    if args[0] == "--sql":
        sql = args[1]
        label = "--sql"
    else:
        path = pathlib.Path(args[0])
        sql = path.read_text(encoding="utf-8")
        label = path.name

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (checked environment and .env)")

    with psycopg.connect(url, sslmode="require", connect_timeout=25) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description:
                columns = [c.name for c in cur.description]
                print("\t".join(columns))
                for row in cur.fetchall():
                    print("\t".join("" if v is None else str(v) for v in row))
        conn.commit()

    print(f"OK: applied {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
