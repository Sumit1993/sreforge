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
  GIT_AUTHOR_NAME="$author_name" GIT_AUTHOR_EMAIL="$author_email" \
  GIT_COMMITTER_NAME="$author_name" GIT_COMMITTER_EMAIL="$author_email" \
    git -C "$work" commit -am "$msg" >/dev/null
  git -C "$work" push -f origin HEAD:main
}

# fault_delivery_arm_runtime_notrace — NOT YET IMPLEMENTED (a later scenario needs
# it: deploy an innocent recent commit via fault_delivery_arm_deploy_recent, then
# apply the real fault as compose-level runtime env state with zero forge trace,
# force-recreate). No caller wires this yet — leave as a documented comment only,
# do not write a function body / do not guess the signature further than this.
