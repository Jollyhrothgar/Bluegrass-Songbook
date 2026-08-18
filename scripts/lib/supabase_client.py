#!/usr/bin/env python3
"""Shared Supabase connection for the sync scripts.

These scripts exist to *fetch* — the caller has asked for fresh data. So a
failure to reach Supabase must be an error, not a warning. They used to print
one and fall back to the on-disk cache, which meant a broken sync looked like a
successful one and the build shipped stale data: a promotion made in the UI
could silently never reach the site.

`except ImportError` around `from supabase import ...` was its own trap. It
catches anything raised while importing the package *or its dependencies*, so a
broken sub-dependency was reported as "supabase-py not installed" — sending you
to reinstall a package that was already there. `ModuleNotFoundError.name` tells
the two apart.
"""

import os
import sys


def connect(what: str):
    """Return a Supabase client, or exit non-zero explaining why not.

    `what` names the thing being fetched, for the error message.
    """
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')

    if not url or not key:
        print(f"Error: cannot fetch {what} — Supabase credentials are not set.")
        print("  Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        print("  Locally these are injected from 1Password; if that is failing:")
        print("    op signin")
        print("  or fall back to a file:  op inject -i .env.tpl -o .env")
        sys.exit(1)

    try:
        from supabase import create_client
    except ImportError as exc:
        missing = getattr(exc, 'name', None)
        if missing in (None, 'supabase'):
            print(f"Error: cannot fetch {what} — the supabase package is not installed.")
            print("  Run: uv sync")
        else:
            # The package is present; something it imports is not. Saying "not
            # installed" here would send you to reinstall the wrong thing.
            print(f"Error: cannot fetch {what} — supabase is installed but "
                  f"'{missing}' failed to import ({exc}).")
            print("  The dependency tree is broken, not the package. Try: uv sync --reinstall")
        sys.exit(1)

    try:
        return create_client(url, key)
    except Exception as exc:                       # noqa: BLE001
        print(f"Error: cannot fetch {what} — could not connect to Supabase: {exc}")
        sys.exit(1)


def fetch_failed(what: str, exc: Exception):
    """Report a failed query and exit. Never falls back to the cache."""
    print(f"Error: failed to fetch {what} from Supabase: {exc}")
    print("  Refusing to fall back to the cached copy — that would let a build")
    print("  ship stale data while reporting success.")
    sys.exit(1)
