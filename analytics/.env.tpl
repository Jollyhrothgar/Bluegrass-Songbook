# 1Password secret-reference template for analytics/.env
#
# This file is SAFE to commit: it contains 1Password secret references,
# NOT real values. scripts/bootstrap runs "op inject" to materialize the
# real analytics/.env from these references (requires the 1Password CLI,
# signed in).
#
# Manual regenerate:  op inject -i analytics/.env.tpl -o analytics/.env
# Item lives in the 1Password "API Keys" vault as "Bluegrass analytics".

SUPABASE_URL=op://API Keys/Bluegrass analytics/SUPABASE_URL
SUPABASE_SERVICE_KEY=op://API Keys/Bluegrass analytics/SUPABASE_SERVICE_KEY
