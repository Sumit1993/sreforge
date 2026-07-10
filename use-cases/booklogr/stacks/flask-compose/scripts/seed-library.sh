#!/usr/bin/env bash
# Seed the demo user's library with COUNT rows directly in Postgres — the
# per-scenario "book count" tuning dial (query cost scales with library size).
# Idempotent: only inserts the shortfall to reach COUNT. Requires booklogr-db up
# and migrated (i.e. `up.sh` has run at least once in this session).
set -euo pipefail
COUNT="${1:?usage: seed-library.sh <count>}"

psql_exec() { docker exec -i booklogr-db psql -U booklogr -d booklogr -v ON_ERROR_STOP=1 "$@"; }

# Pin planner behavior for the (large, by design) `books` table: with parallel
# workers enabled, a query's cost depends on how many OTHER concurrent queries
# are also competing for the shared parallel-worker pool (max_worker_processes),
# so identical queries get FASTER when run alone and SLOWER under concurrent
# storm load than an isolated EXPLAIN ANALYZE predicts — a confound that makes
# the "book count" tuning dial unreliable (empirically: healthy p99 was fine in
# isolation but crossed the alert threshold once real concurrent load hit the
# same table). Disabling per-query parallelism makes cost scale predictably
# with row count alone, independent of concurrent query count. Idempotent;
# instance-wide (affects the whole booklogr-db instance, not just this table),
# but harmless to other scenarios (nothing else on this stack queries a table
# large enough for the planner to consider parallelism anyway).
psql_exec -c "ALTER SYSTEM SET max_parallel_workers_per_gather = 0;" >/dev/null
psql_exec -c "SELECT pg_reload_conf();" >/dev/null

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
# Refresh planner stats after the bulk insert — without this, the planner's
# row-count estimate for `books` is stale (from before the insert) and can
# choose a different plan than it will settle on later, making the query-cost
# tuning dial (COUNT) unreliable run-to-run. Real bulk imports get this from
# autovacuum eventually; do it explicitly so the dial is deterministic sooner.
psql_exec -c "ANALYZE books;"
echo "seed-library: library now has $(psql_exec -tAc "SELECT count(*) FROM books WHERE owner_id=1;" | tr -d '[:space:]') books"
