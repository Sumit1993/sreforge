# Reference fix — decoy-deploy-control

## The fix

`solution/fix.patch` pins `CACHE_TYPE` back to the literal `"SimpleCache"` in
`api/config.py`, removing the `os.environ.get("CACHE_TYPE", ...)` read
entirely. This is a legitimate emergency mitigation: it makes the application
ignore whatever the deploy environment sets for `CACHE_TYPE`, so the runtime
override that caused the incident (`CACHE_TYPE=NullCache` in the compose `.env`)
can no longer reach the effective config.

## Acceptable fix families

Any change that stops the runtime `CACHE_TYPE` override from reaching the
effective cache backend:

- Pin the value in `api/config.py` (the reference fix above).
- Remove the `os.environ.get("CACHE_TYPE", ...)` read and hardcode
  `"SimpleCache"` (equivalent to the above).
- Any other change to the application or its deploy config that results in
  the search-response cache being active again under the deployed
  environment.

**NOT acceptable — the mandatory negative test:** reverting `inject/fault.patch`
(the innocent settings.py HTTP-status fix) does **not** touch `CACHE_TYPE` or
`api/config.py` at all, so it cannot and does not clear the incident. A run
that submits this revert as its fix must score below `pass_threshold` — see
`verify/negative-fixture.patch` and `verify/oracle.md`'s mandatory negative
test section. This is the discriminating property this scenario is built to
check: a fix that only reverts "whatever changed most recently in git",
without addressing the actual mechanism, must fail.

## Why persistence of the runtime override matters

If the fault were instead a one-off in-container hot-patch (e.g. `docker exec`
flipping an env var on the running container only), ANY deploy — including a
wrong fix like the settings.py revert — would rebuild the container from git
and incidentally clear the override, producing a false pass. Because the
override lives in a compose `.env` that every `docker compose up` (including
CI's redeploy, and even cleanup's reset) resolves from the same project
directory, it survives an unrelated redeploy. Only a fix that neutralizes the
override in application config (or removes the override itself) clears the
alert. See `use-cases/booklogr/stacks/flask-compose/scripts/lib-fault-delivery.sh`
(`fault_delivery_arm_runtime_notrace`) and `arm-incident.sh`'s override-clearing
step for the mechanics.
