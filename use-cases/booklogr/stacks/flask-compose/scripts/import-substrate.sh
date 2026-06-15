#!/usr/bin/env bash
# Import the booklogr substrate into the local Gitea forge, preserving FULL git
# history, then commit the baseline observability instrumentation + a local CI
# workflow. The forge repo becomes the run workspace's only `origin` — never the
# public upstream (retrieval isolation, D13/D15). Per D16 it also provisions the
# use case's MAINTAINER identity (derived from the imported app) and routes all
# git pushes + the run loop's token through it, so the shared forge admin never
# appears on the agent-visible push/PR/merge surface.
#
# Prereqs: the forge is up (`docker compose -f infra/forge/forge.yml up -d gitea`),
# the (neutral) Gitea admin user exists, and .env is filled. Idempotent: re-running
# re-pushes the mirror, re-applies the baseline commit if absent, and reuses the
# stored maintainer identity (GITEA_MAINT_USER/PASS) if present.
#
# NOTE: the git mirror + verification + instrumentation steps are the load-bearing
# ones; the Gitea API calls assume API v1 (Gitea 1.26).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
cd "$STACK"

[ -f .env ] || { echo "missing .env — copy .env.example and fill it"; exit 1; }
set -a; . ./.env; set +a

: "${UPSTREAM_REPO:?}"; : "${GITEA_URL:?}"
: "${GITEA_ADMIN_USER:?}"; : "${GITEA_ADMIN_PASSWORD:?}"; : "${GITEA_ADMIN_EMAIL:?}"
: "${GITEA_REPO_OWNER:?}"; : "${GITEA_REPO_NAME:?}"

API="$GITEA_URL/api/v1"
# Admin (GITEA_ADMIN_USER) is used ONLY for setup REST (org/repo/actions/user) via
# api(); every git PUSH and the run workspace origin use the per-use-case
# maintainer remote (MAINT_REMOTE), set once the maintainer is provisioned (D16).
MIRROR_DIR="$STACK/substrate/.mirror"
WORK_DIR="$STACK/substrate/booklogr"
mkdir -p "$STACK/substrate"

api() { curl -fsS -u "$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD" -H 'content-type: application/json' "$@"; }

echo "==> 1. mirror-clone upstream (full history)"
rm -rf "$MIRROR_DIR"
git clone --mirror "$UPSTREAM_REPO" "$MIRROR_DIR"

echo "==> 1a. Git-LFS check (mirror push does NOT carry LFS blobs)"
if git -C "$MIRROR_DIR" show HEAD:.gitattributes 2>/dev/null | grep -q 'filter=lfs'; then
  echo "    WARNING: upstream declares Git-LFS in .gitattributes — LFS blobs will NOT be imported."
else
  echo "    ok: no Git-LFS declared."
fi

echo "==> 2. ensure org + empty repo exist in Gitea"
api -X POST "$API/orgs" -d "{\"username\":\"$GITEA_REPO_OWNER\"}" >/dev/null 2>&1 || true
api -X POST "$API/orgs/$GITEA_REPO_OWNER/repos" \
  -d "{\"name\":\"$GITEA_REPO_NAME\",\"private\":true,\"auto_init\":false}" >/dev/null 2>&1 || true

echo "==> 2b. provision the per-use-case MAINTAINER identity (D16)"
# Agent-visible git activity (push/PR/merge) must look like THIS app's maintainer,
# never the shared forge admin. Derive it from the imported app:
#   login = upstream owner handle; name/email = the repo's real last author.
MAINT_LOGIN="$(printf '%s' "$UPSTREAM_REPO" | sed -E 's#/+$##; s#\.git$##; s#.*[/:]([^/]+)/[^/]+$#\1#')"
MAINT_NAME="$(git -C "$MIRROR_DIR" log -1 --format='%an')"
MAINT_EMAIL="$(git -C "$MIRROR_DIR" log -1 --format='%ae')"
# Reuse a stored password across re-runs (so the token can be re-minted); else mint one.
MAINT_PASS="${GITEA_MAINT_PASS:-$(openssl rand -hex 16)}"
echo "    maintainer: $MAINT_LOGIN <$MAINT_EMAIL> ($MAINT_NAME)"
# Create the user (admin, idempotent) + add as repo collaborator with write so it
# can push and open/merge PRs.
api -X POST "$API/admin/users" \
  -d "{\"username\":\"$MAINT_LOGIN\",\"email\":\"$MAINT_EMAIL\",\"full_name\":\"$MAINT_NAME\",\"password\":\"$MAINT_PASS\",\"must_change_password\":false,\"visibility\":\"public\"}" >/dev/null 2>&1 || true
api -X PUT "$API/repos/$GITEA_REPO_OWNER/$GITEA_REPO_NAME/collaborators/$MAINT_LOGIN" \
  -d '{"permission":"write"}' >/dev/null 2>&1 || true
# Mint the run-ops token AS the maintainer (basic auth, its own password). Delete
# any prior one first so re-runs are idempotent.
curl -fsS -u "$MAINT_LOGIN:$MAINT_PASS" -X DELETE "$API/users/$MAINT_LOGIN/tokens/run-ops" >/dev/null 2>&1 || true
MAINT_TOKEN="$(curl -fsS -u "$MAINT_LOGIN:$MAINT_PASS" -H 'content-type: application/json' \
  -X POST "$API/users/$MAINT_LOGIN/tokens" \
  -d '{"name":"run-ops","scopes":["write:repository","read:repository"]}' \
  | grep -o '"sha1":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
[ -n "$MAINT_TOKEN" ] || { echo "ERROR: failed to mint maintainer run-ops token" >&2; exit 1; }
MAINT_REMOTE="http://$MAINT_LOGIN:$MAINT_PASS@${GITEA_URL#http://}/$GITEA_REPO_OWNER/$GITEA_REPO_NAME.git"

echo "==> 3. push full history into Gitea — branches + tags (as the maintainer)"
# Push heads + tags only (force, for idempotent re-runs). NOT --mirror: a GitHub
# mirror clone carries refs/pull/* (PR snapshots) that Gitea rejects by policy
# and that we don't want in the substrate anyway (they'd be a forge-specific tell).
git -C "$MIRROR_DIR" push "$MAINT_REMOTE" "+refs/heads/*:refs/heads/*" "+refs/tags/*:refs/tags/*"

echo "==> 4. verify every upstream branch + tag is present in Gitea with matching SHA"
# Subset check, not equality: Gitea legitimately carries extra refs we add later
# (e.g. the `baseline` branch). We only require that each UPSTREAM head/tag is
# present in Gitea at the same SHA (excludes refs/pull/* and peeled ^{} tags).
local_refs="$(git -C "$MIRROR_DIR" show-ref --heads --tags | awk '{print $2" "$1}' | sort)"
remote_refs="$(git ls-remote --heads --tags "$MAINT_REMOTE" | grep -v '\^{}' | awk '{print $2" "$1}' | sort)"
missing="$(comm -23 <(printf '%s\n' "$local_refs") <(printf '%s\n' "$remote_refs"))"
if [ -z "$missing" ]; then
  echo "    ok: all $(printf '%s\n' "$local_refs" | wc -l) upstream heads+tags present in Gitea with matching SHAs."
else
  echo "    MISSING/mismatched in Gitea:"; printf '%s\n' "$missing"
  exit 1
fi

echo "==> 5. working checkout + baseline instrumentation + local CI (two commits)"
rm -rf "$WORK_DIR"
git clone "$MAINT_REMOTE" "$WORK_DIR"
# Baseline commits are authored as the maintainer (MAINT_NAME/MAINT_EMAIL from
# step 2b) — consistent with the imported project's existing history.
commit() {
  GIT_AUTHOR_NAME="$MAINT_NAME" GIT_AUTHOR_EMAIL="$MAINT_EMAIL" \
  GIT_COMMITTER_NAME="$MAINT_NAME" GIT_COMMITTER_EMAIL="$MAINT_EMAIL" \
  git -C "$WORK_DIR" commit "$@"
}

# commit 1 — observability instrumentation (a separate concern from CI, so a
# separate commit, the way a real team would land two PRs).
python3 instrumentation/apply.py "$WORK_DIR"
git -C "$WORK_DIR" add -A
git -C "$WORK_DIR" diff --cached --quiet || commit -m "Add Prometheus metrics (prometheus-flask-exporter, multiprocess mode)" >/dev/null

# commit 2 — self-hosted CI. A self-hosted fork also drops the upstream's
# GitHub-only publish/docs automation (Docker Hub / Pages — upstream infra).
mkdir -p "$WORK_DIR/.gitea/workflows"
cp gitea/ci.yml "$WORK_DIR/.gitea/workflows/ci.yml"
rm -f "$WORK_DIR/.github/workflows/build-docker-image.yml" \
      "$WORK_DIR/.github/workflows/build-docker-image-web.yml" \
      "$WORK_DIR/.github/workflows/deploy-docs.yml" \
      "$WORK_DIR/.github/workflows/sponsors.yml"
git -C "$WORK_DIR" add -A
git -C "$WORK_DIR" diff --cached --quiet || commit -m "Add self-hosted CI (build + smoke)" >/dev/null

git -C "$WORK_DIR" push origin HEAD

# The immutable baseline ref the harness resets the deployment to between runs.
# Auto-merge lands agent fixes on main; `baseline` is never advanced by a merge,
# so cleanup always restores the intended deployed state. (M2 advances baseline
# exactly once, when it commits the authored regression.)
git -C "$WORK_DIR" branch -f baseline HEAD
git -C "$WORK_DIR" push -f origin baseline
echo "    pushed baseline branch (cleanup resets the deployment to origin/baseline)"

echo "==> 6. enable Actions on the repo"
api -X PATCH "$API/repos/$GITEA_REPO_OWNER/$GITEA_REPO_NAME" -d '{"has_actions":true}' >/dev/null 2>&1 || true

echo "==> 7. record the maintainer identity for the run loop (.env)"
# run-incident.mjs reads GITEA_TOKEN; the workspace origin already carries the
# maintainer creds. Persist the maintainer login/password too so re-runs reuse
# the same identity (and can re-mint the token) instead of drifting.
upsert_env() { # KEY VALUE
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
upsert_env GITEA_TOKEN "$MAINT_TOKEN"
upsert_env GITEA_MAINT_USER "$MAINT_LOGIN"
upsert_env GITEA_MAINT_PASS "$MAINT_PASS"
echo "    GITEA_TOKEN -> maintainer ($MAINT_LOGIN) run-ops token"

rm -rf "$MIRROR_DIR"
echo "==> done. Substrate imported to $GITEA_URL/$GITEA_REPO_OWNER/$GITEA_REPO_NAME"
echo "    Build context for compose: $WORK_DIR"
echo "    Maintainer ($MAINT_LOGIN) provisioned; GITEA_TOKEN + workspace origin route through it (D16)."
echo "    Ensure the runner is up: docker compose -f infra/forge/forge.yml up -d act_runner"
