# `tools/transcript` — Agent handoff capture

Provides the driver-facing contract for handing off agent-side artifacts (like conversation transcripts or RCAs) to the SREForge engine. Because drivers run outside the sealed engine environment, they write to a shared mount; this script packages the raw data into standard envelopes (`agent-transcript.v1`, `agent-rca.v1`).

## Files

| Path | What |
| --- | --- |
| `write-handoff.mjs` | Packages raw text or JSON into a standard schema envelope. |

## Usage

External drivers (like t3code or `agent-agy.sh`) call this script after the agent completes its run, just before or after `submit`:

```sh
node tools/transcript/write-handoff.mjs \
  --run-id "<run-id>" \
  --harness "<harness-name>" \
  --session "cold" \
  --confinement "host-open" \
  --kind "transcript" \
  --raw-text-file "/path/to/raw.txt" \
  --out ".run-workspace/agent-transcript.json"

# RCA handoff
node tools/transcript/write-handoff.mjs \
  --run-id "<run-id>" \
  --harness "<harness-name>" \
  --session "cold" \
  --confinement "host-open" \
  --kind "rca" \
  --raw-text-file "/path/to/rca.txt" \
  --out ".run-workspace/agent-rca.json"
```

`--confinement` is required and must be one of `host-open` | `host-sandboxed` | `in-box` — the tier the driver actually ran the agent under. It is a fixed property of the driver, hardcoded per driver, never an env var; an unlabelled handoff is refused so a verdict is never banked with unknown measurement conditions.

The engine's `FileRunRecorder` automatically ingests these files from the `.run-workspace` directory and bundles them into the final `run-record.v1` artifact set.
