# Micropub Publisher

A standalone Micropub, media, IndieAuth, and Markdown editor service backed by GitHub App user authorization. The service has no repository credential of its own: each GitHub write uses a user access token limited by both the signed-in user and the GitHub App installation.

This was extracted from `martinemde.com` at commit `964f9969d271`. `PUBLIC_APP_URL` and `PUBLIC_SITE_URL` allow the publisher and published site to use different origins. All 35 in-scope local Micropub conformance cases pass. Hosted conformance has not been verified; see `TESTING_GUIDE.md` for the procedure and limits of local judgments.

## Routes

- `/auth/indieauth/authorize` and `/auth/indieauth/token`
- `/auth/github/login`, `/login/callback`, and `/auth/github/logout`
- `/micropub` and `/micropub/media`
- `/editor`
- `/api/posts` and `/api/posts/read`

## Run locally

```sh
cp .env.example .env
bun install
bun run dev
```

For development, use a separate GitHub App with callback `http://localhost:5180/login/callback`.
Set `PUBLIC_APP_URL` and `ORIGIN` to `http://localhost:5180`, `MICROPUB_BACKEND=file`,
and fill in the dev app's client ID and client secret in `.env`. The example file
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

Set the app's **client ID** (not App ID) and client secret as `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`, and set `GITHUB_OWNER`, `GITHUB_REPO`, and a fresh
`SESSION_SECRET`. Set both `PUBLIC_APP_URL` and the adapter's `ORIGIN` to
`https://publish.martinemde.com`, and `PUBLIC_SITE_URL=https://martinemde.com`.
Configure HTTPS forwarding to the service port on your host.

Build and run this as one long-lived Bun or Node process:

```sh
bun run build
bun run start
```

Set `MICROPUB_BACKEND=github` and `BODY_SIZE_LIMIT=12M` in production. The body limit
allows a 10 MiB image plus multipart overhead; see the [adapter configuration](https://svelte.dev/docs/kit/adapter-node#Environment-variables-BODY_SIZE_LIMIT). GitHub user credentials, Micropub tokens, and authorization-code replay state remain in memory. User tokens refresh automatically; expired/revoked refresh credentials require signing in again. A restart invalidates editor sessions and issued Micropub tokens, and multiple replicas would not share them; use one process until those stores are replaced with a durable implementation.

See `MICROPUB_SETUP.md`, `INDIEAUTH_IMPLEMENTATION.md`, and `TESTING_GUIDE.md` for the recovered implementation details. `OAUTH_SECURITY_ANALYSIS.md` records the original audit and the fixes made before extraction.

The GitHub App flow uses state and S256 PKCE. Cookies and sealed IndieAuth codes
carry opaque credential references; GitHub access/refresh tokens remain server-side.
The new cookie name invalidates legacy OAuth sessions. Revoke the old OAuth App's
GitHub authorization when retiring it; changing this service does not revoke old
GitHub tokens remotely. The old `/auth/github/callback` route remains an alias.

This is local deployment preparation. DNS, HTTPS, app installation, secrets, and the
live authorization flow must still be configured and verified on the host.
