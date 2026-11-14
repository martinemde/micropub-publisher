# Dependency updates

The central GitHub App runner in `martinemde/renovate-config` proposes updates.
Minor, patch and digest updates automerge by squash after the seven-day release
age policy and all required checks pass: lint/type checks, unit tests, Micropub
conformance (including build and Cloudflare tests), and Workers Builds: publish.
Major updates, initial pinning, security alerts and shared-policy updates require
manual review. Renovate performs the merge; native GitHub auto-merge is not needed.

Existing Cloudflare deployment automation is unchanged. An automatic merge to
main can trigger the same deployment as a manual merge.
