# Micropub Publisher

A standalone Micropub, media, IndieAuth, and Markdown editor service backed by GitHub App user authorization. The service has no repository credential of its own: each GitHub write uses a user access token limited by both the signed-in user and the GitHub App installation.

This was extracted from `martinemde.com` at commit `964f9969d271`. `PUBLIC_APP_URL` and `PUBLIC_SITE_URL` allow the publisher and published site to use different origins. All 35 in-scope local Micropub conformance cases pass. Hosted conformance has not been verified; see `TESTING_GUIDE.md` for the procedure and limits of local judgments.

## Routes

- `/auth/indieauth/authorize` and `/auth/indieauth/token`
- `/auth/github/login`, `/login/callback`, and `/auth/github/logout`
- `/micropub` and `/micropub/media`
- `/editor`
- `/api/posts` and `/api/posts/read`

The editor has Article, Note, Bookmark, and Photo composers. New drafts are kept
separately per type in local storage, so switching composers preserves unfinished
work. Select a saved post to edit it in the matching composer; use **New post** to
start again. Notes need only text, bookmarks need a URL, and photos accept uploaded
images or image URLs with alt text and an optional caption.

Expand entries in the editor's **Action log** to inspect the actual request body,
HTTP status, response body, and `Location` header. All four composers create
`h-entry` objects: `name` makes an article, `bookmark-of` a bookmark, and `photo`
a photo post; a note needs only `content`. Updates send `action: update` with
`replace` properties. Uploading a file sends multipart data to `/micropub/media`,
then its returned URL is used in the post. The log labels `/api/posts` requests as
publisher-specific APIs rather than Micropub. Logs are held only in page memory,
omit session credentials and binary file contents, and clear on reload.

## Run locally

```sh
cp .env.example .env.local
bun install
bun run dev
```

For development, use a separate GitHub App with callback `http://localhost:5180/login/callback`.
Set `PUBLIC_APP_URL` to `http://localhost:5180`, `MICROPUB_BACKEND=file`,
and fill in the dev app's client ID and client secret in `.env.local`. The example file
contains the production origins; override them before running locally.
The configured GitHub user must have access to the selected publishing repository.

The published site's identity page must advertise the standalone endpoints:

```html
<link rel="authorization_endpoint" href="https://publish.martinemde.com/auth/indieauth/authorize" />
<link rel="token_endpoint" href="https://publish.martinemde.com/auth/indieauth/token" />
<link rel="micropub" href="https://publish.martinemde.com/micropub" />
```

## Verify

```sh
bun run format
bun run lint
bun run check
bun run test
bun run build
```

Tests fake GitHub and other external services at the application boundary. They do not access a network, account, or repository.

For the independent upstream conformance tests, run `bun run conformance:setup`
once, then `bun run conformance`. This starts an isolated local app, runs the
pinned micropub.rocks browser assertions over HTTP, and saves artifacts under
`.conformance/runs/`. Failures and unresolved manual checks produce a nonzero exit code. File-backed
judgments record evidence for the manual cases. The GitHub Actions workflow runs
the same commands; see `TESTING_GUIDE.md` for details.

## Deploy

Production is prepared for `https://publish.martinemde.com`, representing
`https://martinemde.com`. Register exactly `https://publish.martinemde.com/login/callback`
as the GitHub App callback. Install the app only on the selected blog repository,
with **Contents: read and write** (Metadata read is automatic). Leave user token
expiration enabled. Webhooks, device flow, an app private key, and installation
access tokens are not used. User authorization is requested when signing in to the
editor or authorizing a Micropub client.

Cloudflare Workers runs the service, with a SQLite-backed Durable Object owning
GitHub credentials, Micropub tokens, and consumed authorization codes. Requests
to the application are serialized through that object, including GitHub writes
and token refreshes. Explicit map mutations write durable storage; credentials
survive eviction and deployment. Vite development and local conformance use
isolated in-memory stores. Cloudflare requests fail closed without durable state.

`wrangler.jsonc` fixes the production origins and publishing repository
`martinemde/martinemde.com`. The sibling `../cloudflare` repo manages the custom
domain; Wrangler manages the Worker, assets, Durable Object migration, and secrets.
Worker preview URLs and request logging are disabled.

Keep production secrets in ignored `.env.production.local`, separate from dev's
`.env.local`. It must contain `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a
fresh random `SESSION_SECRET` of at least 32 characters. Use the production GitHub
App's **client ID**, not App ID. Do not copy the dev credentials. Keep the session
secret stable across deployments to preserve cookies and authorization codes.

Verify locally before deployment:

```sh
bun run build
bun run test:cloudflare
bun run conformance
```

`test:cloudflare` bundles with Wrangler's dry run, then runs the actual Worker in
Miniflare with fake external services. It verifies login, GitHub user-token refresh,
Micropub token issuance, restart persistence, code replay rejection, and logout
revocation surviving another restart. It never uses real credentials or GitHub.

For the initial deployment, authenticate Wrangler and run:

```sh
bun run build
bunx wrangler deploy --secrets-file .env.production.local
```

That file must contain only the three secret values; public origins and repository
settings belong in `wrangler.jsonc`. Never put secrets in command arguments. A Worker
must exist before OpenTofu can attach its custom domain. In `../cloudflare`, run
`make plan`, review the publisher domain addition, then `make apply`.
Subsequent code deployments use `bun run deploy` without rotating secrets or
reapplying unchanged infrastructure. Verify HTTPS and the login redirect at
`https://publish.martinemde.com/auth/github/login`, then complete a real login
before considering deployment verified. Micropub clients also need the identity
links shown above on the blog.

The media endpoint enforces its own 10 MiB file limit. Adapter-node's `ORIGIN` and
`BODY_SIZE_LIMIT` settings do not apply to Workers. Expired/revoked GitHub refresh
credentials still require signing in again. Token revocation deletes the live
record; Cloudflare's storage recovery retention can retain historical data.

See `MICROPUB_SETUP.md`, `INDIEAUTH_IMPLEMENTATION.md`, and `TESTING_GUIDE.md` for the recovered implementation details. `OAUTH_SECURITY_ANALYSIS.md` records the original audit and the fixes made before extraction.

The GitHub App flow uses state and S256 PKCE. Cookies and sealed IndieAuth codes
carry opaque credential references; GitHub access/refresh tokens remain server-side.
The new cookie name invalidates legacy OAuth sessions. Revoke the old OAuth App's
GitHub authorization when retiring it; changing this service does not revoke old
GitHub tokens remotely. The old `/auth/github/callback` route remains an alias.

DNS, HTTPS, app installation, secrets, and the live authorization flow must be
verified separately from these local checks.

When installation starts on GitHub with user authorization enabled, the first
callback can lack our state/PKCE. The publisher discards that code and starts a
fresh protected login. To retry a failed installation landing, open
`http://localhost:5180/auth/github/login`; reinstalling is not necessary.
