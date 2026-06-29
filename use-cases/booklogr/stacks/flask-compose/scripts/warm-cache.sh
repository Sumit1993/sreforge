#!/usr/bin/env sh
# warm-cache.sh — prime booklogr's response cache for the storm's fixed query set
# so a freshly (re)deployed instance meets a WARM cache when load resumes. A real
# rolling deploy warms/smokes an instance before it takes full traffic; for this
# cache-dependent service, "ready" includes a warm cache (otherwise the first
# post-resume wave stampedes the cold upstream and can trip the error-rate alarm).
#
# The query set MUST mirror load/booklogr-storm.js — a cached service then answers
# every storm request from cache after this one priming pass. IMPORTANT (ADR-0004): a
# no-op fix (cache still disabled) gains nothing here, so warming does NOT mask a
# bad fix — it still fails the oracle under the resumed storm.
#
# Best-effort by design: individual failures are tolerated (the deployer treats
# warm-up as non-fatal). Hits the host-published API ingress.
set -u

API_URL="${API_URL:-http://localhost:5000}"
# Pre-encoded to EXACTLY match the storm's encodeURIComponent (load/booklogr-storm.js):
# the cache key is the query string, so "the hobbit" must be "the%20hobbit" (not "+")
# or that query stays uncached and 1/8 of storm traffic keeps hitting the slow
# upstream — enough to hold p99 over the alert threshold. Single-word queries are
# unchanged. Keep this list in sync with the storm's QUERIES.
QUERIES="dune the%20hobbit 1984 sapiens dracula mistborn hyperion neuromancer"

n=0
for qenc in $QUERIES; do
  curl -s -o /dev/null --max-time 20 "$API_URL/v1/books/search?q=$qenc" || true
  n=$((n + 1))
done
echo "warm-cache: primed $n queries against $API_URL"
