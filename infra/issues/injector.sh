#!/usr/bin/env bash
# injector.sh — Apply or validate a scenario injection.
#
# Usage:
#   injector.sh inject  <scenario.yaml> <workspace-root>
#   injector.sh validate <scenario.yaml>
#
# The inject command:
#   1. Reads target_repo, target_file, patch, commit_message, commit_author from the YAML
#   2. Applies the patch to workspace/<target_repo>/<target_file>
#   3. Commits with the specified author and message (looks like a real developer commit)
#
# Requires: git, python3 (for YAML parsing via stdin)

set -euo pipefail

# ── YAML field extraction (pure bash + python3) ───────────────────────────────

yaml_field() {
  local file="$1" field="$2"
  python3 - "$file" "$field" <<'PYEOF'
import sys, re

def get_nested(text, key_path):
    # Simple dot-notation lookup for scalar values in YAML
    # Handles top-level and one level of nesting under injection:
    parts = key_path.split('.')
    if len(parts) == 1:
        m = re.search(r'^' + re.escape(parts[0]) + r':\s*(.+)$', text, re.MULTILINE)
        return m.group(1).strip().strip('"').strip("'") if m else ""
    elif len(parts) == 2 and parts[0] == 'injection':
        # Find injection block, then find field within it
        m = re.search(r'^injection:\s*\n((?:[ \t]+.+\n?)*)', text, re.MULTILINE)
        if not m:
            return ""
        block = m.group(1)
        # unindent
        lines = block.splitlines()
        for line in lines:
            stripped = line.strip()
            fm = re.match(r'^' + re.escape(parts[1]) + r':\s*(.+)$', stripped)
            if fm:
                return fm.group(1).strip().strip('"').strip("'")
        return ""
    return ""

file_path, field = sys.argv[1], sys.argv[2]
text = open(file_path).read()
print(get_nested(text, field))
PYEOF
}

yaml_patch() {
  local file="$1"
  python3 - "$file" <<'PYEOF'
import sys, re

file_path = sys.argv[1]
text = open(file_path).read()

# Extract the multiline patch block under injection.patch
m = re.search(r'^  patch:\s*\|\n((?:    .+\n?)*)', text, re.MULTILINE)
if m:
    # strip 4-space indent
    lines = m.group(1).splitlines()
    print('\n'.join(line[4:] for line in lines))
PYEOF
}

# ── apply patch ───────────────────────────────────────────────────────────────

apply_patch() {
  local target_file="$1"   # absolute path to file in workspace
  local patch_content="$2" # patch text (YAML fragment to inject)
  local patch_type="${3:-yaml-merge}"

  if [[ ! -f "$target_file" ]]; then
    echo "ERROR: target file not found: $target_file" >&2
    exit 1
  fi

  case "$patch_type" in
    yaml-merge)
      # For values.yaml: find the first matching top-level key and replace its block.
      # For simple cases (replicaCount, resources), overwrite the key line directly.
      python3 - "$target_file" <<PYEOF
import sys, re

target = sys.argv[1]
patch = """$patch_content"""

text = open(target).read()

# Apply each top-level key from the patch
lines = patch.strip().splitlines()
i = 0
while i < len(lines):
    line = lines[i]
    m = re.match(r'^(\w[\w-]*):\s*(.*)', line)
    if m:
        key = m.group(1)
        # Collect the full patch block for this key
        block_lines = [line]
        j = i + 1
        while j < len(lines) and (lines[j].startswith(' ') or lines[j].startswith('\t')):
            block_lines.append(lines[j])
            j += 1
        patch_block = '\n'.join(block_lines)
        # Find and replace the existing key block in the file
        pattern = r'^' + re.escape(key) + r':.*?(?=\n\w|\Z)'
        replacement = patch_block
        new_text, n = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL | re.MULTILINE)
        if n > 0:
            text = new_text
        else:
            # Key not found: append to end of file
            text = text.rstrip('\n') + '\n\n' + patch_block + '\n'
        i = j
    else:
        i += 1

open(target, 'w').write(text)
print("Patched: " + target)
PYEOF
      ;;

    line-delete)
      # Remove specific lines from the file (used for removing index directives etc.)
      python3 - "$target_file" <<PYEOF
import sys, re

target = sys.argv[1]
patch = """$patch_content"""

lines_to_delete = [l.strip() for l in patch.strip().splitlines() if l.strip() and not l.strip().startswith('#')]
text = open(target).read()
result = '\n'.join(
    line for line in text.splitlines()
    if line.strip() not in lines_to_delete
)
open(target, 'w').write(result + '\n')
print("Removed " + str(len(lines_to_delete)) + " line(s) from: " + target)
PYEOF
      ;;

    *)
      echo "ERROR: Unknown patch_type: $patch_type" >&2
      exit 1
      ;;
  esac
}

# ── commands ──────────────────────────────────────────────────────────────────

do_inject() {
  local scenario_file="$1"
  local workspace="$2"

  local id target_repo target_file commit_message commit_author patch_type
  id=$(yaml_field "$scenario_file" "id")
  target_repo=$(yaml_field "$scenario_file" "injection.target_repo")
  target_file=$(yaml_field "$scenario_file" "injection.target_file")
  commit_message=$(yaml_field "$scenario_file" "injection.commit_message")
  commit_author=$(yaml_field "$scenario_file" "injection.commit_author")
  patch_type=$(yaml_field "$scenario_file" "injection.patch_type")
  patch_type="${patch_type:-yaml-merge}"

  local patch_content
  patch_content=$(yaml_patch "$scenario_file")

  local repo_dir="$workspace/$target_repo"
  if [[ ! -d "$repo_dir/.git" ]]; then
    echo "ERROR: $target_repo not found in workspace. Run scripts/clone-workspace.sh first." >&2
    exit 1
  fi

  local abs_target="$repo_dir/$target_file"

  echo "[inject] scenario: $id"
  echo "[inject] repo:     $target_repo"
  echo "[inject] file:     $target_file"
  echo "[inject] author:   $commit_author"
  echo "[inject] message:  $commit_message"
  echo ""

  apply_patch "$abs_target" "$patch_content" "$patch_type"

  # Commit with realistic metadata
  # Use a plausible timestamp slightly in the past (2 hours ago)
  local commit_date
  commit_date=$(date -d '2 hours ago' --iso-8601=seconds 2>/dev/null \
    || date -v-2H '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null \
    || date '+%Y-%m-%dT%H:%M:%S%z')

  git -C "$repo_dir" add "$target_file"
  GIT_AUTHOR_NAME="${commit_author%% *}" \
  GIT_AUTHOR_EMAIL="${commit_author##*<}" \
  GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL%>}" \
  GIT_AUTHOR_DATE="$commit_date" \
  GIT_COMMITTER_NAME="${commit_author%% *}" \
  GIT_COMMITTER_EMAIL="${commit_author##*<}" \
  GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL%>}" \
  GIT_COMMITTER_DATE="$commit_date" \
  git -C "$repo_dir" commit -m "$commit_message"

  echo ""
  echo "[inject] committed to $target_repo:"
  git -C "$repo_dir" log --oneline -1
  echo ""
  echo "[inject] done. Push to GitHub to make it visible to the agent:"
  echo "         git -C workspace/$target_repo push origin main"
}

do_validate() {
  local scenario_file="$1"

  local id check expect_value
  id=$(yaml_field "$scenario_file" "id")
  check=$(yaml_field "$scenario_file" "validation.check")
  expect_value=$(yaml_field "$scenario_file" "validation.expect_value" 2>/dev/null || echo "")
  local expect_status
  expect_status=$(yaml_field "$scenario_file" "validation.expect_status" 2>/dev/null || echo "")

  echo "[validate] scenario: $id"
  echo "[validate] check:    $check"
  echo ""

  if [[ -n "$expect_status" ]]; then
    echo "Expected pod status: $expect_status"
    actual=$(eval "$check" 2>&1 || true)
    echo "Result: $actual"
    if echo "$actual" | grep -q "$expect_status"; then
      echo "[validate] PASS"
    else
      echo "[validate] FAIL — expected '$expect_status' in output"
      exit 1
    fi
  elif [[ -n "$expect_value" ]]; then
    actual=$(eval "$check" 2>&1 || true)
    echo "Expected: $expect_value"
    echo "Actual:   $actual"
    if [[ "$actual" == "$expect_value" ]]; then
      echo "[validate] PASS"
    else
      echo "[validate] FAIL"
      exit 1
    fi
  else
    echo "No validation criteria defined for scenario: $id"
  fi
}

# ── dispatch ──────────────────────────────────────────────────────────────────

[[ $# -lt 2 ]] && { echo "Usage: injector.sh <inject|validate> <scenario.yaml> [workspace]" >&2; exit 1; }

CMD="$1"
SCENARIO_FILE="$2"

case "$CMD" in
  inject)
    [[ $# -lt 3 ]] && { echo "inject requires <workspace> argument" >&2; exit 1; }
    do_inject "$SCENARIO_FILE" "$3"
    ;;
  validate)
    do_validate "$SCENARIO_FILE"
    ;;
  *)
    echo "Unknown command: $CMD" >&2; exit 1
    ;;
esac
