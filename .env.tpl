# 1Password secret-reference template for the repo-root .env
#
# This file is SAFE to commit: it contains 1Password secret references,
# NOT real values. scripts/bootstrap runs "op inject" to materialize the
# real .env from these references (requires the 1Password CLI, signed in).
#
# These are the secrets the CLI/maintenance scripts read from the
# environment (Strum Machine matching, LLM tagging, Supabase sync).
# The analytics dashboard has its own analytics/.env (see analytics/.env.tpl).
#
# Manual regenerate:  op inject -i .env.tpl -o .env
# Items live in the 1Password "API Keys" vault.

SUPABASE_URL=op://API Keys/Bluegrass analytics/SUPABASE_URL
SUPABASE_SERVICE_KEY=op://API Keys/Bluegrass analytics/SUPABASE_SERVICE_KEY
STRUM_MACHINE_API_KEY=op://API Keys/Bluegrass Songbook/STRUM_MACHINE_API_KEY
ANTHROPIC_API_KEY=op://API Keys/Bluegrass Songbook/ANTHROPIC_API_KEY
