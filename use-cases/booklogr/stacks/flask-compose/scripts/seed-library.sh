#!/usr/bin/env bash
# Seed the demo user's library with COUNT rows directly in Postgres — the
# per-scenario "book count" tuning dial (query cost scales with library size).
# Idempotent: only inserts the shortfall to reach COUNT. Requires booklogr-db up
# and migrated (i.e. `up.sh` has run at least once in this session).
set -euo pipefail
COUNT="${1:?usage: seed-library.sh <count>}"

psql_exec() { docker exec -i booklogr-db psql -U booklogr -d booklogr -v ON_ERROR_STOP=1 "$@"; }

current="$(psql_exec -tAc "SELECT count(*) FROM books WHERE owner_id=1;" | tr -d '[:space:]')"
current="${current:-0}"
need=$(( COUNT - current ))
if [ "$need" -le 0 ]; then
  echo "seed-library: already have $current/$COUNT books for owner_id=1"
  exit 0
fi
echo "seed-library: inserting $need books (have $current, target $COUNT)…"
psql_exec -c "
INSERT INTO books (title, subtitle, isbn, description, author, reading_status, current_page, total_pages, rating, owner_id, created_on)
SELECT 'Library Title ' || (g + ${current}),
       NULL,
       lpad((g + ${current})::text, 13, '0'),
       NULL,
       'Author ' || ((g + ${current}) % 250),
       'to_read', 0, 300, NULL, 1, now()
FROM generate_series(1, ${need}) AS g;
"
echo "seed-library: library now has $(psql_exec -tAc "SELECT count(*) FROM books WHERE owner_id=1;" | tr -d '[:space:]') books"
