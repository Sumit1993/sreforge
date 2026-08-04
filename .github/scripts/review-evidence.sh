#!/usr/bin/env bash
# Publish a `review-evidence` commit status for one or more pull requests.
#
# WHY THIS EXISTS
# ---------------
# CodeRabbit is not a required check on this repo, and its own rate-limit check
# "passes by design so it never blocks merging on protected branches". So a PR
# that was never reviewed is indistinguishable, at the merge gate, from one that
# was reviewed and found clean. This status makes that distinction, and it is
# keyed to the CURRENT head SHA so a review of an earlier commit does not vouch
# for later pushes.
#
# Ported from prismalens/prismalens (which ported it from Sumit1993/mage-memory,
# where it has run since 2026-08-02). The repo-specific deltas are marked
# `SREFORGE:` below. Tracked in prismalens/prismalens#301.
#
# Usage:
#   REPO=owner/name ./review-evidence.sh 318 34      # specific PRs
#   REPO=owner/name ./review-evidence.sh --all-open  # sweeper
#   DRY_RUN=1 ...                                    # evaluate, publish nothing
set -uo pipefail

REPO="${REPO:?REPO must be set (owner/name)}"
STATUS_CONTEXT="${STATUS_CONTEXT:-review-evidence}"
DRY_RUN="${DRY_RUN:-0}"

# ---------------------------------------------------------------------------
# Policy constants.
#
# These live here, not in .github/governance.json or .coderabbit.yaml: the gate
# must not have to parse another tool's config format to learn its own policy.
#
# SREFORGE: this is the THIRD consumer — the point at which prismalens/prismalens#301
# said extracting a reusable workflow would finally be earned by three call sites
# rather than assumed. It is still not done here, deliberately: the three copies
# have now diverged in exactly one axis (the machine-generated-PR branch, below),
# and that divergence is the input the extraction needs. Extract from three known
# copies, not from two plus a guess. Tracked on prismalens/prismalens#301.
# ---------------------------------------------------------------------------

# Whose formal review counts as evidence. EXACT logins, never a substring match.
#
# This was `contains("coderabbit")`. On a public repo anyone can register an
# account whose name contains that string — `coderabbit-fan` — and a review from
# it would have satisfied the gate. An allowlist of exact bot logins closes that.
# `coderabbitai[bot]` is the real login, confirmed from live review payloads.
REVIEWER_LOGINS="${REVIEWER_LOGINS:-coderabbitai[bot]}"

# PR authors exempt from needing review evidence.
#
# This is not a hole: `CI gate` is separately a required check, so exempting these
# authors does not let unreviewed *code* merge. It lets machine-generated
# dependency bumps merge, which is the intent — nobody reviews them, and without
# this branch .github/workflows/dependabot-auto-merge.yml would be permanently
# blocked by a gate that can never go green.
#
# SREFORGE: this repo has no CLA workflow and no Renovate, so the list stays at
# the two logins that actually open PRs here. `dependabot[bot]` is load-bearing:
# .github/workflows/dependabot-auto-merge.yml queues auto-merge for safe bumps,
# and once `review-evidence` is required that queue would never drain without
# this branch. An exemption that is not needed is just a hole, so nothing else
# is added.
BOT_AUTHORS="${BOT_AUTHORS:-dependabot[bot] github-actions[bot]}"

# SREFORGE: the machine-generated-release-PR branch (branch B2 upstream) is
# DELIBERATELY OMITTED, not forgotten.
#
# Both upstream copies carry it because they publish releases from a bot-opened
# PR that no human reviews: mage-memory via release-please (matched on branch
# `^release-please--` plus an `autorelease:` label), prismalens via changesets
# (matched on same-repo + branch `^changeset-release/` + title
# `^chore: version packages$`). Without an exemption those PRs would sit red
# forever, because nobody reviews them.
#
# This repo has no such mechanism — there is no release-please, no changesets,
# no semantic-release, and no release workflow of any kind (verified against
# .github/workflows and package.json at port time). Carrying the branch anyway
# would add a permanently dead code path whose match conditions are partly
# attacker-settable strings, in a gate whose whole purpose is to not hand out
# unearned `success`. Upstream's own rule applies: an exemption that is not
# needed is just a hole.
#
# IF sreforge ever gains automated release PRs, restore the branch from the
# prismalens copy — and restore the same-repo check with it. That check is the
# load-bearing factor (pushing a branch to this repo requires write access);
# branch name and title alone are settable by anyone opening a PR from a fork.

# Marker left by a local CodeRabbit CLI review.
#
# Written by claude-kit's `cr-evidence.sh`, which `cr-preview.sh` calls after a
# successful CLI review (Sumit1993/claude-kit#6). Keyed to the head SHA, so
# evidence vouches for one commit and not for the PR: push again and it stops
# matching, and this gate goes red until the branch is re-previewed.
# Format:  <!-- cr-cli-review: <full head sha> -->
CLI_MARKER_PREFIX="${CLI_MARKER_PREFIX:-<!-- cr-cli-review:}"

# Comment authors whose CLI marker is trusted. An unauthenticated "evidence"
# comment from an arbitrary account must not satisfy the gate.
CLI_MARKER_AUTHORS="${CLI_MARKER_AUTHORS:-Sumit1993}"

# ---------------------------------------------------------------------------

in_list () { # in_list <needle> <space-separated haystack>
  local needle="$1" hay="$2" item
  for item in $hay; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

publish () { # publish <sha> <state> <description>
  local sha="$1" state="$2" desc="${3:0:140}"
  if [ "$DRY_RUN" = "1" ]; then
    printf '    would publish: %s — %s\n' "$state" "$desc"
    return 0
  fi
  gh api -X POST "repos/$REPO/statuses/$sha" \
    -f state="$state" \
    -f context="$STATUS_CONTEXT" \
    -f description="$desc" \
    --silent || { echo "    ERROR: failed to publish status" >&2; return 1; }
  printf '    published: %s — %s\n' "$state" "$desc"
}

# Ask the API a question whose answer is a string, distinguishing THREE outcomes:
# a match, no match, and "could not tell". Conflating the last two is how a gate
# starts reporting confident answers it did not actually compute — the failure
# class this whole gate exists to prevent.
#   rc 0 = answered (value on stdout, may be empty for "no match")
#   rc 2 = could not determine
api_query () { # api_query <path> <jq filter> [jq args...]
  local path="$1" filter="$2"; shift 2
  local body
  # --paginate matters: a single page caps at 100. A long-lived PR accumulates
  # more than 100 comments, and the CLI evidence marker could fall off page one —
  # which would publish a false `failure` on a genuinely reviewed PR.
  body=$(gh api --paginate "$path" 2>/dev/null) || return 2
  # --paginate emits one array per page on older gh and a single merged array on
  # newer; `-s add` normalises both to one array.
  body=$(jq -s 'add // []' <<<"$body" 2>/dev/null) || return 2
  jq -r "$@" "$filter" <<<"$body" 2>/dev/null || return 2
}

evaluate_pr () { # evaluate_pr <number>
  local n="$1" pr sha author state draft head_ref

  # A fetch failure is not "nothing to do" — it means we cannot evaluate, and the
  # caller must learn about it through the exit code rather than see a clean run.
  pr=$(gh api "repos/$REPO/pulls/$n" 2>/dev/null) || {
    echo "  PR #$n: cannot fetch — NOT evaluated" >&2; return 1; }

  sha=$(jq -r '.head.sha'      <<<"$pr")
  author=$(jq -r '.user.login' <<<"$pr")
  state=$(jq -r '.state'       <<<"$pr")
  draft=$(jq -r '.draft'       <<<"$pr")
  head_ref=$(jq -r '.head.ref' <<<"$pr")

  printf '  PR #%s  head=%s  author=%s  branch=%s  state=%s  draft=%s\n' \
         "$n" "${sha:0:8}" "$author" "$head_ref" "$state" "$draft"

  if [ "$state" != "open" ]; then
    echo "    closed — not evaluated"; return 0
  fi

  # --- branch B1: bot-authored --------------------------------------------
  if in_list "$author" "$BOT_AUTHORS"; then
    publish "$sha" success "Bot-authored ($author); CI gate applies separately"
    return $?
  fi

  # SREFORGE: upstream's branch B2 (machine-generated release PR) is omitted —
  # see the constants section for why, and for how to restore it.

  # --- branch A: a formal review AT THE CURRENT HEAD -----------------------
  # `commit_id` is the commit the review was actually made against, so this is
  # exact: a review of an earlier commit does not satisfy a later head.
  #
  # DISMISSED is excluded because dismissal is the explicit act of withdrawing a
  # review — treating a withdrawn review as evidence would let the gate vouch for
  # a verdict its author retracted. PENDING is an unsubmitted draft and is not a
  # verdict at all. Both are `state` values that survive on the review object, so
  # neither is filtered out by the commit_id match.
  local reviewer q_rc
  reviewer=$(api_query "repos/$REPO/pulls/$n/reviews?per_page=100" '
        ($logins | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.commit_id == $sha)
            | select(.state != "DISMISSED" and .state != "PENDING")
          ] | if length > 0 then .[-1].user.login else empty end' \
      --arg sha "$sha" --arg logins "$REVIEWER_LOGINS")
  q_rc=$?
  if [ $q_rc -eq 2 ]; then
    publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
    return 1
  fi
  if [ -n "$reviewer" ]; then
    publish "$sha" success "Reviewed by $reviewer at ${sha:0:8}"
    return $?
  fi

  # --- branch C: CLI review marker for this head ---------------------------
  local marker_author
  marker_author=$(api_query "repos/$REPO/issues/$n/comments?per_page=100" '
        ($authors | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.body | contains($pre + " " + $sha))
          ] | if length > 0 then .[-1].user.login else empty end' \
      --arg sha "$sha" --arg pre "$CLI_MARKER_PREFIX" --arg authors "$CLI_MARKER_AUTHORS")
  q_rc=$?
  if [ $q_rc -eq 2 ]; then
    publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
    return 1
  fi
  if [ -n "$marker_author" ]; then
    publish "$sha" success "CLI review evidence from $marker_author at ${sha:0:8}"
    return $?
  fi

  # --- no evidence ---------------------------------------------------------
  # Reached only when BOTH lookups answered successfully and neither matched.
  publish "$sha" failure "No review evidence for ${sha:0:8} — silence is not a review"
  return $?
}

main () {
  local targets=()
  if [ "${1:-}" = "--all-open" ]; then
    echo "Sweeper: evaluating all open PRs in $REPO"
    # `mapfile < <(...)` hides the producer's exit status, so an API failure would
    # yield an empty list and report a clean "nothing to do". Capture separately.
    local listing
    listing=$(gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" --jq '.[].number' 2>/dev/null) || {
      echo "ERROR: cannot list open PRs — sweeper evaluated nothing" >&2; return 1; }
    [ -n "$listing" ] && mapfile -t targets <<<"$listing"
  else
    targets=("$@")
  fi

  if [ ${#targets[@]} -eq 0 ]; then echo "No PRs to evaluate."; return 0; fi

  local rc=0
  for n in "${targets[@]}"; do evaluate_pr "$n" || rc=1; done
  return $rc
}

main "$@"
