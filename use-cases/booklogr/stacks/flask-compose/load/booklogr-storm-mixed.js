// k6 load — the mixed latency storm driver for booklogr.
//
// A constant-arrival-rate (open-model) stream of traffic against the UNCACHED
// GET /v1/books library-list route. This exposes DB connection pool
// starvation: the healthy baseline runs gunicorn sync workers (1 request per
// process, so the pool is never contended), while the faulted deploy switches
// to threaded (gthread) workers whose 8 threads share one undersized
// (pool_size=1) per-process pool — requests queue on the pool and slow ALL
// traffic the worker serves (even cached routes).
//
// An earlier version of this script also mixed in a light ambient stream of
// cached GET /v1/books/search requests "for realism". That was REMOVED after
// empirical tuning: Flask-Caching's SimpleCache sets each key's TTL at WRITE
// time and never refreshes it on a cache HIT, so with a fixed rate hitting a
// closed set of search terms, every key's first write happens within the
// storm's first few seconds and all of them expire together
// ~CACHE_DEFAULT_TIMEOUT (300s) later — a synchronized cache-miss burst
// against the slow book-metadata upstream that recreates a stampede-like
// echo every 5 minutes EVEN in the healthy (cache-on) baseline (confirmed
// live: p99 spiked to 1.6-2.2s and fired BooklogrApiLatencyP99High on a
// ~5-minute cadence purely from this side effect, with zero contribution
// from the pool-exhaustion mechanism this scenario actually tests). Neither
// widening the query set nor forcing non-keep-alive connections eliminated
// it (the write-time-TTL behavior is unconditional), so the ambient search
// stream was dropped rather than shipping a storm with a built-in, unrelated
// false-positive source. The scenario's fault-triggering mechanism (uncached
// library reads exhausting a pool_size=1 connection) does not need it.
//
// Contention relies on a COMBINATION of the fault's switch to gthread workers
// (threads=8) and a deliberately higher RATE than a naive "8-10 req/s". Under
// baseline sync workers, concurrency caps at 1 request/process, so pool_size=1
// never contends regardless of arrival rate. The fault's threaded workers
// allow overlapping demand to share a single DB connection, and matching
// latency-cache-stampede's rate (25 req/s) reliably forces that overlap while
// keeping single-query cost (the book-count dial, tuned in scenario.env's
// SEED_COUNT) low enough that the healthy baseline (pool_size=5, 4 sync workers)
// stays well under threshold. In single-user mode booklogr's book endpoints
// need no auth. Tune via env: RATE (req/s), DURATION, PRE_VUS, MAX_VUS, API_URL.
import http from "k6/http";
import exec from "k6/execution";

const BASE = __ENV.API_URL || "http://booklogr-api:5000";
const RATE = Number(__ENV.RATE || 25);

// NOTE: "rating" is intentionally excluded — the app's sort_by=rating path
// (routes/books.py get_books: func.lower(getattr(Books, sort_by))) calls
// lower() on a Numeric column, which Postgres rejects
// (UndefinedFunction: function lower(numeric) does not exist). That is a
// pre-existing app bug unrelated to this scenario; the storm avoids it rather
// than papering over app code.
const SORTS = ["title", "author"];
const ORDERS = ["asc", "desc"];

export const options = {
  scenarios: {
    library_reads: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: __ENV.DURATION || "720h", // effectively "until stopped"
      preAllocatedVUs: Number(__ENV.PRE_VUS || 60),
      maxVUs: Number(__ENV.MAX_VUS || 400),
      exec: "libraryReads",
    },
  },
};

export function libraryReads() {
  const iter = exec.scenario.iterationInTest;
  const offset = (iter % 20) + 1;
  const sort = SORTS[iter % SORTS.length];
  const order = ORDERS[iter % ORDERS.length];
  http.get(`${BASE}/v1/books?offset=${offset}&sort_by=${sort}&order=${order}`, { timeout: "120s" });
}
