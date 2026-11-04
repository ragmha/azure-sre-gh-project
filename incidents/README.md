# Incident reports

The SRE console saves one post-incident report per scenario here:

- `oom-killed.md`, for step 1
- `mongodb-down.md`, for step 2
- `service-mismatch.md`, for step 3

Pushing a report to `main` runs that step's workflow, which grades it with `node lab/check.mjs <scenario>`. Run the same command locally to check a report before you push it.
