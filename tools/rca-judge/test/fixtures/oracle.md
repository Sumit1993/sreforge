# Oracle — fixture (test only)

Preamble that must be ignored.

## CompoundedOracle contract

Some contract text that must not leak into the ground truth.

## Root cause (harness-internal)

The deployed cache backend has drifted to `NullCache` via a compose-level `.env`
override (`CACHE_TYPE=NullCache`) in the deploy directory, invisible to `git log`.
The recent `settings.py` commit ("Fix invalid HTTP status") is an innocent decoy:
it cannot affect search latency.

## Signals

Signal text that must not be part of the extracted ground truth.
