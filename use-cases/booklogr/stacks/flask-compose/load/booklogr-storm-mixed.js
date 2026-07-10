// k6 load — the mixed latency storm driver for booklogr.
//
// A constant-arrival-rate (open-model) stream of traffic running two concurrent
// scenarios.
// 1. `library_reads`: Hits the uncached GET /v1/books endpoint. This exposes DB 
//    connection pool starvation when workers get blocked on serializing connections.
// 2. `search_light`: A lighter, ambient background load of search traffic against 
//    GET /v1/books/search (which is cached and healthy). When DB connections 
//    are exhausted by the library reads, these cached requests also queue up and 
//    fail as workers are starved.
//
// In single-user mode booklogr's book endpoints need no auth. Tune via env:
//   RATE (req/s), RATE_SEARCH (req/s), DURATION, PRE_VUS, MAX_VUS, API_URL.
import http from "k6/http";
import exec from "k6/execution";

const BASE = __ENV.API_URL || "http://booklogr-api:5000";
const RATE = Number(__ENV.RATE || 9);
const RATE_SEARCH = Number(__ENV.RATE_SEARCH || 2);

// A small fixed working set for search queries.
const QUERIES = [
  "dune", "the hobbit", "1984", "sapiens", "dracula",
  "mistborn", "hyperion", "neuromancer",
];

const SORTS = ["title", "author", "rating"];
const ORDERS = ["asc", "desc"];

export const options = {
  scenarios: {
    library_reads: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: __ENV.DURATION || "720h", // effectively "until stopped"
      preAllocatedVUs: Number(__ENV.PRE_VUS || 40),
      maxVUs: Number(__ENV.MAX_VUS || 200),
      exec: "libraryReads",
    },
    search_light: {
      executor: "constant-arrival-rate",
      rate: RATE_SEARCH,
      timeUnit: "1s",
      duration: __ENV.DURATION || "720h", // effectively "until stopped"
      preAllocatedVUs: Number(__ENV.PRE_VUS_SEARCH || 10),
      maxVUs: Number(__ENV.MAX_VUS_SEARCH || 50),
      exec: "searchLight",
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

export function searchLight() {
  const q = QUERIES[exec.scenario.iterationInTest % QUERIES.length];
  http.get(`${BASE}/v1/books/search?q=${encodeURIComponent(q)}`, { timeout: "120s" });
}
