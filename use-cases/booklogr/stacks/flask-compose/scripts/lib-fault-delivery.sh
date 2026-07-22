# One shared lib, delivery modes for how a scenario's fault becomes live in the
# deployed substrate. Each scenario owns a base anchor ref (a LOCAL git branch in
# substrate/booklogr, never pushed to origin).

# fault_delivery_setup_baked <work-dir> <anchor-ref>
#   Mode 1: the fault is already baked into <anchor-ref> at setup time (by a
#   dedicated injector script, e.g. inject-regression.sh). At arm time we just
#   re-regress the forge: force-push the local anchor onto origin/main, then
#   reset the local workspace onto it. This is EXACTLY what arm-incident.sh's
#   current steps 2-3 do for latency-cache-stampede — extract verbatim, change
#   nothing about ordering or flags.
fault_delivery_setup_baked() {
  local work="$1" anchor_ref="$2"
  git -C "$work" fetch origin --prune --quiet
  git -C "$work" push -f origin "${anchor_ref}:main"
  git -C "$work" checkout -B main "$anchor_ref"
  git -C "$work" reset --hard "$anchor_ref"
  git -C "$work" clean -fd
}

# fault_delivery_arm_deploy_recent <work-dir> <anchor-ref> <patch-file> <commit-message> <author-name> <author-email>
#   Mode 2: at arm time, reset origin/main to the scenario's (healthy) anchor,
#   apply the scenario's fault patch on top, commit it under the maintainer
#   identity with a REAL current timestamp (do NOT set GIT_AUTHOR_DATE/
#   GIT_COMMITTER_DATE — a real "just deployed" commit is the point), and push
#   to origin/main so it becomes the live deploy. Re-arm-safe: always resets
#   from the anchor FIRST, so repeated arms never accumulate fault commits —
#   each arm mints exactly one fresh commit on top of the clean anchor.
fault_delivery_arm_deploy_recent() {
  local work="$1" anchor_ref="$2" patch_file="$3" msg="$4" author_name="$5" author_email="$6"
  git -C "$work" fetch origin --prune --quiet
  git -C "$work" push -f origin "${anchor_ref}:main"
  git -C "$work" checkout -B main "$anchor_ref"
  git -C "$work" reset --hard "$anchor_ref"
  git -C "$work" clean -fd
  git -C "$work" apply --whitespace=nowarn "$patch_file"
  # NOTE (cold-arm #66 finding): `commit -am` only stages MODIFIED tracked
  # files, never new files created by `git apply` (e.g. a new migration file).
  # db-pool's config-only fault.patch happened to work with -am by accident;
  # a new-file fault (like #66's drop-migration) silently produced "nothing
  # to commit" and the whole arm failed. `git add -A` first makes this mode
  # correct for both modify-only and new-file patches.
  git -C "$work" add -A
  GIT_AUTHOR_NAME="$author_name" GIT_AUTHOR_EMAIL="$author_email" \
  GIT_COMMITTER_NAME="$author_name" GIT_COMMITTER_EMAIL="$author_email" \
    git -C "$work" commit -m "$msg" >/dev/null
  git -C "$work" push -f origin HEAD:main
}

# fault_delivery_arm_runtime_notrace <work-dir> <anchor-ref> <patch-file> <commit-message> <author-name> <author-email> <env-override-file> <runtime-var> <runtime-value>
#   Mode 3: at arm time, deploy an INNOCENT recent commit via
#   fault_delivery_arm_deploy_recent (same real-timestamp, maintainer-authored,
#   re-arm-safe path scenarios in mode 2 use) — this commit is physically
#   incapable of causing the incident. Then apply the REAL fault as compose-level
#   runtime env state with ZERO forge trace: write a single VAR=VALUE line to
#   <env-override-file> (a compose `.env` the deploy plane resolves on every
#   invocation — see scripts/lib-deploy.sh). Nothing is committed or pushed for
#   the real fault; the substrate git history stays indistinguishable from a
#   genuine innocuous deploy. The caller (arm-incident.sh) is responsible for
#   the force-recreate that picks the override up, and for clearing any leftover
#   override from a PRIOR arm-runtime-notrace scenario before arming a different
#   one (a decoy override must never leak into another scenario's incident).
fault_delivery_arm_runtime_notrace() {
  local work="$1" anchor_ref="$2" patch_file="$3" msg="$4" author_name="$5" author_email="$6"
  local env_file="$7" runtime_var="$8" runtime_value="$9"
  fault_delivery_arm_deploy_recent "$work" "$anchor_ref" "$patch_file" "$msg" "$author_name" "$author_email"
  mkdir -p "$(dirname "$env_file")"
  printf '%s=%s\n' "$runtime_var" "$runtime_value" > "$env_file"
}

# fault_delivery_arm_deploy_recent_compound <work-dir> <anchor-ref> (patch msg author_name author_email date)...
#   Mode for compound deploys: resets origin/main to <anchor-ref>, then applies
#   and commits an ordered list of 5-tuples (patch, message, author-name, author-email, date).
#   Guarantees strictly monotonic commit dates (anchor-parent < commit-1 < commit-2 ...).
fault_delivery_arm_deploy_recent_compound() {
  local work="$1" anchor_ref="$2"
  shift 2
  git -C "$work" fetch origin --prune --quiet
  git -C "$work" push -f origin "${anchor_ref}:main"
  git -C "$work" checkout -B main "$anchor_ref"
  git -C "$work" reset --hard "$anchor_ref"
  git -C "$work" clean -fd

  local prev_ts
  prev_ts=$(git -C "$work" log -1 --format=%ct "$anchor_ref") || {
    echo "FATAL: cannot resolve anchor ref '$anchor_ref' for monotonic date guard" >&2
    return 1
  }

  while [ $# -ge 5 ]; do
    local patch_file="$1" msg="$2" author_name="$3" author_email="$4" date_str="$5"
    shift 5

    local ts
    if [ -z "$date_str" ] || [ "$date_str" = "now" ]; then
      ts=$(date +%s)
    else
      ts=$(date -d "$date_str" +%s 2>/dev/null || echo "")
      if [ -z "$ts" ]; then
        echo "FATAL: Unable to parse commit date '$date_str'" >&2
        return 1
      fi
    fi

    if [ "$ts" -le "$prev_ts" ]; then
      echo "FATAL: Non-monotonic commit dates: commit date '$date_str' ($ts) is not strictly after previous timestamp ($prev_ts)" >&2
      return 1
    fi
    prev_ts="$ts"

    git -C "$work" apply --whitespace=nowarn "$patch_file"
    git -C "$work" add -A

    if [ -n "$date_str" ] && [ "$date_str" != "now" ]; then
      GIT_AUTHOR_NAME="$author_name" GIT_AUTHOR_EMAIL="$author_email" \
      GIT_COMMITTER_NAME="$author_name" GIT_COMMITTER_EMAIL="$author_email" \
      GIT_AUTHOR_DATE="@$ts" GIT_COMMITTER_DATE="@$ts" \
        git -C "$work" commit -m "$msg" >/dev/null
    else
      GIT_AUTHOR_NAME="$author_name" GIT_AUTHOR_EMAIL="$author_email" \
      GIT_COMMITTER_NAME="$author_name" GIT_COMMITTER_EMAIL="$author_email" \
        git -C "$work" commit -m "$msg" >/dev/null
    fi
  done

  git -C "$work" push -f origin HEAD:main
}

