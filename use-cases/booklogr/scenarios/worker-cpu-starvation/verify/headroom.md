# Baseline Headroom Qualification

**DISQUALIFIED** — raw mitigation 0.986 on both cold attempts >= threshold 0.8 (pending hardening)

**Date**: 2026-07-21
**Driver**: agy (two independent raw cold attempts, different models)
**Judge Model**: gpt-oss:120b
**Threshold**: 0.8
**Mode**: score-headroom (certification gate-6 attempts; formal 3-run campaign owed post-merge on the re-baselined substrate)

| Run ID | Driver Model | Mitigation Score | Verdict | Notes |
|---|---|---|---|---|
| cert65-gate6-1 | Claude Opus 4.6 (Thinking) | 0.986 | passed | correctly diagnosed the full-library re-sort, reverted it |
| cert65-gate6-2 | Gemini 3.1 Pro (High) | 0.986 | passed | same diagnosis and fix path, cold |

Recorded per the 2026-07-21 owner decision (record honestly, merge, re-qualify on
merged main): the multi-alert storm structure did not slow frontier models — both
read recent deploy history and reverted the hot commit. Disqualified as an A/B
discriminator until hardened; mechanics gates (determinism, solvability,
anti-cheat, de-tell 14/100, db-pool interference re-smoke) all passed the same
day — see PR #71. Re-qualification owed after the #66 baseline index merges
(changes this scenario's physics: the indexed path removes the healthy-state
throughput ceiling found at cert).

*(Hand-recorded from certification evidence; formal `tools/headroom` campaign to
re-generate this file runs post-merge.)*
