# Deployment

Production is prepared for `https://publish.martinemde.com`, representing
`https://martinemde.com`. Register exactly `https://publish.martinemde.com/login/callback`
as the GitHub App callback. Install the app only on the selected blog repository,
with **Contents: read and write** (Metadata read is automatic). Leave user token
expiration enabled. Webhooks, device flow, an app private key, and installation
access tokens are not used. User authorization is requested when signing in to the
editor or authorizing a Micropub client.

Cloudflare Workers runs the service, with a SQLite-backed Durable Object owning
GitHub credentials, Micropub tokens, and consumed authorization codes (see
[authentication.md](authentication.md#state)). Explicit map mutations write durable
storage. Cloudflare requests fail closed without durable state.

`wrangler.jsonc` fixes the production origins and publishing repository
`martinemde/martinemde.com`. The sibling `../cloudflare` repo manages the custom
domain; Wrangler manages the Worker, assets, Durable Object migration, and secrets.
Worker preview URLs and request logging are disabled.

The production Worker name is `publish`, matching the custom domain's service in
`../cloudflare/workers.tf`. Keep Wrangler's `name` aligned with that service.
Deploying as the former `micropub-publisher` name can try to recreate its existing
Durable Object namespace and fail with Cloudflare error 10065. Correct the Worker
name, then rerun `pnpm run deploy`; do not rename or delete the stored class.

Keep production secrets in ignored `.env.production.local`, separate from dev's
`.env.local`. It must contain `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a
fresh random `SESSION_SECRET` of at least 32 characters. Use the production GitHub
App's **client ID**, not App ID. Do not copy the dev credentials. Keep the session
secret stable across deployments to preserve cookies and authorization codes.

Verify locally before deployment:

```sh
pnpm run build
pnpm run test:cloudflare
pnpm run conformance
```

`test:cloudflare` bundles with Wrangler's dry run, then runs the actual Worker in
Miniflare with fake external services. It verifies login, GitHub user-token refresh,
Micropub token issuance, restart persistence, code replay rejection, and logout
revocation surviving another restart. It never uses real credentials or GitHub.

For the initial deployment, authenticate Wrangler and run:

```sh
pnpm run build
pnpm exec wrangler deploy --secrets-file .env.production.local
```

That file must contain only the three secret values; public origins and repository
settings belong in `wrangler.jsonc`. Never put secrets in command arguments. A Worker
must exist before OpenTofu can attach its custom domain. In `../cloudflare`, run
`make plan`, review the publisher domain addition, then `make apply`.
Subsequent code deployments use `pnpm run deploy` without rotating secrets or
reapplying unchanged infrastructure. Verify HTTPS and the login redirect at
`https://publish.martinemde.com/auth/github/login`, then complete a real login
before considering deployment verified. Micropub clients also need the identity
links in the [README](../README.md#run-locally) on the blog.

The media endpoint enforces its own 10 MiB file limit. Adapter-node's `ORIGIN` and
`BODY_SIZE_LIMIT` settings do not apply to Workers. Expired/revoked GitHub refresh
credentials still require signing in again.

DNS, HTTPS, app installation, secrets, and the live authorization flow must be
verified separately from these local checks.

If the old GitHub OAuth App is still authorized, revoke it on GitHub; changing this
service does not revoke old GitHub tokens remotely.

## Bluesky syndication

Syndication stays off until the app password is set. Create one in Bluesky under
Settings → Privacy and security → App passwords, without DM access, then store it
without putting it in a command argument:

```sh
pnpm exec wrangler secret put BLUESKY_APP_PASSWORD
```

Revoking the app password in Bluesky stops syndication without a deploy.
