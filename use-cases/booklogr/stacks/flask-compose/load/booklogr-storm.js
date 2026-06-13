// k6 load — the latency storm driver for booklogr's book-search path.
//
// A constant-arrival-rate (open-model) stream of searches over a SMALL, fixed
// set of queries. The search route is normally cached, so a healthy service
// serves all but the first request per query from cache (fast) and easily
// absorbs the load. When the cache is disabled, every request stampedes the
// slow book-metadata upstream; with a fixed arrival rate the request workers
// back up and p99 latency climbs into the alert.
//
// In single-user mode booklogr's book endpoints need no auth. Tune via env:
//   RATE (req/s), DURATION, PRE_VUS, MAX_VUS, API_URL.
import http from "k6/http";
import exec from "k6/execution";

const BASE = __ENV.API_URL || "http://booklogr-api:5000";
const RATE = Number(__ENV.RATE || 12);

// A small fixed working set — a healthy (cached) service answers these from
// cache after the first miss each; an uncached service hits the slow upstream
// every time.
const QUERIES = [
  "dune", "the hobbit", "1984", "sapiens", "dracula",
  "mistborn", "hyperion", "neuromancer",
];

export const options = {
  scenarios: {
    search_storm: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: __ENV.DURATION || "720h", // effectively "until stopped"
      preAllocatedVUs: Number(__ENV.PRE_VUS || 40),
      maxVUs: Number(__ENV.MAX_VUS || 300),
    },
  },
};

export default function () {
  const q = QUERIES[exec.scenario.iterationInTest % QUERIES.length];
  http.get(`${BASE}/v1/books/search?q=${encodeURIComponent(q)}`, { timeout: "120s" });
}
