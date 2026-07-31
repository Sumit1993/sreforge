# Security Policy

## Supported versions

SREForge is pre-1.0 and ships from a single line of development on `main`.
Security fixes land on `main` (and the latest tagged release); there are no
maintained release branches.

| Version | Supported |
| ------- | --------- |
| `main` / latest release | yes |
| older tags | no — please upgrade |

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues.**

Use GitHub's private vulnerability reporting:

- Go to the repository's **Security** tab and choose
  **[Report a vulnerability](https://github.com/prismalens/sreforge/security/advisories/new)**.

If you cannot use that, email **sumitpatel.14may@gmail.com** with the details.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- The affected commit or release and your environment.
- Any suggested remediation, if you have one.

Do **not** include real secrets, tokens, or private content in your report.

## What to expect

- Acknowledgement within a few days.
- An assessment of severity and a fix plan for confirmed issues.
- Credit in the release notes if you would like it.

## Scope notes

SREForge is a contamination-controlled evaluation harness for autonomous
SWE/SRE agents. It runs on a local container substrate and is operated by a
human. It deliberately:

- keeps secrets and tokens out of the repository — `.env` and the imported
  `substrate/` checkout are gitignored and never committed;
- separates the harness from the substrate it evaluates, so the harness is not
  exposed to the code under test;
- pins dependencies via lockfiles, watched by Dependabot.

Reports that strengthen those guarantees — for example a path that leaks a
secret into tracked files, or an escape from the agent workspace into the
harness — are especially valuable.
