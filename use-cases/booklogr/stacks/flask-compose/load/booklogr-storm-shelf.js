// k6 load — the title-sorted library read storm driver for booklogr.
//
// A constant-arrival-rate (open-model) stream of traffic against the UNCACHED,
// title-sorted GET /v1/books library-list route. The healthy baseline serves
// these from an index (index-ordered stop-at-25),
// while the faulted deploy reverts to a full seq-scan + top-N sort
// of the whole library per request. RATE and SEED_COUNT are the tuning dials and
// both are provisional (// TUNE-ON-CERT).
import http from "k6/http";
import exec from "k6/execution";

const BASE = __ENV.API_URL || "http://booklogr-api:5000";
const RATE = Number(__ENV.RATE || 50); // TUNE-ON-CERT

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
  const offset = (iter % 20) + 1;   // page 1..20, keeps offsets shallow but non-trivial
  http.get(`${BASE}/v1/books?offset=${offset}&sort_by=title&order=asc`, { timeout: "120s" });
}
