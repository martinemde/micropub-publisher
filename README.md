# Micropub Publisher

A standalone Micropub, media, IndieAuth, and Markdown editor service backed by a user's GitHub OAuth authorization. The service has no repository credential of its own: each GitHub write uses the token granted by the person authorizing the Micropub client.

This was extracted from `martinemde.com` at commit `964f9969d271`. The original conformance-tested routes and test suite are preserved, while `PUBLIC_APP_URL` and `PUBLIC_SITE_URL` allow the publisher and published site to use different origins.

## Routes

- `/auth/indieauth/authorize` and `/auth/indieauth/token`
- `/auth/github/login`, `/auth/github/callback`, and `/auth/github/logout`
- `/micropub` and `/micropub/media`
- `/editor`
- `/api/posts` and `/api/posts/read`

## Run locally

```sh
cp .env.example .env
bun install
bun run dev
```

Create a GitHub OAuth App whose callback URL is `PUBLIC_APP_URL/auth/github/callback`, then fill in `.env`. The configured GitHub user must have write access to `GITHUB_OWNER/GITHUB_REPO`.

The published site's identity page must advertise the standalone endpoints:

```html
<link rel="authorization_endpoint" href="https://publisher.example/auth/indieauth/authorize" />
<link rel="token_endpoint" href="https://publisher.example/auth/indieauth/token" />
<link rel="micropub" href="https://publisher.example/micropub" />
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

## Deploy

Build and run this as one long-lived Bun or Node process:

```sh
bun run build
bun run start
```

Set `MICROPUB_BACKEND=github` in production. Micropub access tokens and authorization-code replay state intentionally remain in memory, matching the extracted implementation. A restart invalidates issued Micropub tokens, and multiple replicas would not share them; use one process until those stores are replaced with a durable implementation.

See `MICROPUB_SETUP.md`, `INDIEAUTH_IMPLEMENTATION.md`, and `TESTING_GUIDE.md` for the recovered implementation details. `OAUTH_SECURITY_ANALYSIS.md` records the original audit and the fixes made before extraction.
