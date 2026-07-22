# Physics Acceptance & Cold-Arm Verification — red-herring-coalert

> [!NOTE]
> This document records physics-acceptance criteria and cold-arm expectations. Graded qualification runs (`ExternalAgentRunner`, campaign soak, decoy-rate qualification) are deferred to orchestrator cold-arm testing.

## Cold-Arm Acceptance Plan (§6)

The orchestrator must verify the following cold-arm checks against live stack execution (`pnpm forge up booklogr`):

1. **Firing determinism (§6 step 3):**
   Upon arming `red-herring-coalert` (`inject-regression.sh` + `SEARCH_STUB_5XX_RATE=0.08` + storm load), poll `GET http://localhost:9090/api/v1/alerts` and assert **both** alerts are firing:
   - `BooklogrApiLatencyP99High` (`service="booklogr-api"`, critical)
   - `BookMetadataProviderErrorsElevated` (`service="book-metadata"`, warning)
   Re-arm twice; both must fire deterministically within 240s every time.

2. **Independence checks (§6 step 4):**
   - **4a. API Error-Rate Leak Check:** `BooklogrApiHighErrorRate` (`service="booklogr-api"`) must **NOT** be firing.
     - *Fallback condition:* If `BooklogrApiHighErrorRate` fires (meaning the API propagates upstream 503s as client-facing 5xx), switch the stub injection mechanism to a dedicated env-gated `book_metadata_provider_errors_total` counter bump on a deterministic timer, decoupled from the HTTP response path.
   - **4b. p99 Delta Check:** Compare `histogram_quantile(0.99, ...)` with `SEARCH_STUB_5XX_RATE=0.08` vs `=0`. The delta must be within normal noise (fast 5xx responses must not elevate p99 latency). If p99 drops materially below 0.3s, adjust rate accordingly.
   - **4c. Scope Check:** Confirm `scenario.toml` declares `services = ["booklogr-api"]` and `BookMetadataProviderErrorsElevated` carries `service="book-metadata"`, ensuring `no_new_alerts` excludes the herring.

3. **Fix-clears-cause-alert (§6 step 5):**
   Apply reference cache fix (`solution/fix.patch`) and redeploy `booklogr-api`. Assert `BooklogrApiLatencyP99High` clears post-fix, having confirmed `BookMetadataProviderErrorsElevated` co-fired pre-fix; note its post-fix subsidence as expected behavior.

4. **Shared Surface Inertness (DoD #4):**
   Arm a different scenario (e.g., `latency-cache-stampede`). `inject-red-herring.sh` clears `SEARCH_STUB_5XX_RATE` back to 0 and force-recreates `book-metadata`, ensuring `BookMetadataProviderErrorsElevated` stays quiet.
