// k6 load — the browse-mixed storm driver for booklogr.
//
// Two constant-arrival-rate (open-model) streams that together model a realistic
// reader browsing session:
//
//   1. library_reads   — the DOMINANT stream: uncached GET /v1/books library-list
//      reads over the seeded library. This is the hot read path; when the list
//      route materializes and re-orders the whole library per request, this
//      stream pins every request worker and drives service-wide p99 latency.
//
//   2. metadata_lookups — a LOW-rate stream of book-detail opens
//      (GET /v1/books/<isbn>) for ISBNs that are NOT in the local library, so
//      each one misses the local DB and falls through to the book-metadata
//      provider. This keeps a steady, uncached trickle of downstream traffic to
//      that provider so its consumption pattern is observable. It is deliberately
//      kept well under ~1% of total request volume: the provider's responses are
//      slow by design (a fixed ~1.1-1.3s upstream), so at >1% of traffic these
//      requests would dominate the service-wide p99 histogram and raise the
//      latency alert on the HEALTHY baseline. Below the p99 percentile they do
//      not move the baseline alert, but they still give the downstream provider
//      real traffic to lose when the API is saturated.
//
// This script is harness-side load only (compose project booklogr-edge); it is
// never part of the deployment an agent enumerates. Tune via env: RATE (req/s for
// the library stream), RATE_META / META_UNIT (the book-detail trickle), DURATION,
// PRE_VUS, MAX_VUS, API_URL. In single-user mode booklogr's book endpoints need
// no auth.
import http from "k6/http";
import exec from "k6/execution";

const BASE = __ENV.API_URL || "http://booklogr-api:5000";
const RATE = Number(__ENV.RATE || 50);
const RATE_META = Number(__ENV.RATE_META || 1);
const META_UNIT = __ENV.META_UNIT || "3s"; // 1 per 3s ~= 0.33 req/s (<1% of RATE)

// NOTE: "rating" is intentionally excluded — the app's sort_by=rating path
// (routes/books.py get_books) calls lower() on a Numeric column, which Postgres
// rejects (UndefinedFunction: function lower(numeric) does not exist). That is a
// pre-existing app bug unrelated to this scenario; the storm avoids it.
const SORTS = ["title", "author"];
const ORDERS = ["asc", "desc"];

// ISBN-13s that are NOT in the seeded library (the seed uses 13-digit
// zero-padded sequential numbers 1..SEED_COUNT). A book-detail lookup for any of
// these misses the local DB and resolves against the book-metadata provider —
// steady, uncached downstream traffic. Small deterministic set.
const DETAIL_ISBNS = [
  "9780441013593", "9780261102217", "9780451524935", "9780062316097",
  "9780553213713", "9780765311788", "9780553283686", "9780441569595",
];

export const options = {
  scenarios: {
    library_reads: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: __ENV.DURATION || "720h", // effectively "until stopped"
      preAllocatedVUs: Number(__ENV.PRE_VUS || 80),
      maxVUs: Number(__ENV.MAX_VUS || 500),
      exec: "libraryReads",
    },
    metadata_lookups: {
      executor: "constant-arrival-rate",
      rate: RATE_META,
      timeUnit: META_UNIT,
      duration: __ENV.DURATION || "720h",
      preAllocatedVUs: Number(__ENV.PRE_VUS_META || 8),
      maxVUs: Number(__ENV.MAX_VUS_META || 40),
      exec: "metadataLookups",
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

export function metadataLookups() {
  const isbn = DETAIL_ISBNS[exec.scenario.iterationInTest % DETAIL_ISBNS.length];
  http.get(`${BASE}/v1/books/${isbn}`, { timeout: "120s" });
}
