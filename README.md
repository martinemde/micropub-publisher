# Micropub Publisher

A standalone [Micropub](https://www.w3.org/TR/micropub/) endpoint, media endpoint,
IndieAuth server, and Markdown editor for [martinemde.com](https://martinemde.com),
running on Cloudflare Workers at `https://publish.martinemde.com`. Each post is committed
to the blog's repository as a Markdown file, using the signed-in user's GitHub App token;
the service holds no repository credential of its own.

## Routes

- `/editor`: the built-in editor ([docs/editor.md](docs/editor.md))
- `/micropub` and `/micropub/media`: Micropub ([docs/micropub.md](docs/micropub.md))
- `/auth/indieauth/authorize` and `/auth/indieauth/token`: IndieAuth for Micropub clients
- `/auth/github/login`, `/login/callback`, and `/auth/github/logout`: GitHub sign-in
  ([docs/authentication.md](docs/authentication.md))
- `/api/posts` and `/api/posts/read`: publisher-specific APIs the editor uses to list and
  load posts

## Run locally

```sh
mise install
cp .env.example .env.local
pnpm install
pnpm run dev
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
pnpm run lint
pnpm run check
pnpm run test
pnpm run build
```

Tests fake GitHub and other external services at the application boundary. They do not access a network, account, or repository.

For the independent upstream conformance tests, run `pnpm run conformance:setup`
once, then `pnpm run conformance`. This starts an isolated local app, runs the
pinned micropub.rocks browser assertions over HTTP, and saves artifacts under
`.conformance/runs/`. Failures and unresolved manual checks produce a nonzero exit code. File-backed
judgments record evidence for the manual cases. The GitHub Actions workflow runs
the same commands; see [docs/testing.md](docs/testing.md) for details.

## Deploy

`pnpm run deploy` builds and deploys the Worker. First-time setup, secrets, and
post-deploy checks are in [docs/deployment.md](docs/deployment.md).

## Documentation

- [docs/editor.md](docs/editor.md): composers, post details, and the action log
- [docs/micropub.md](docs/micropub.md): post file format, supported Micropub features, media, and storage backends
- [docs/authentication.md](docs/authentication.md): GitHub App sign-in, IndieAuth, and token state
- [docs/testing.md](docs/testing.md): conformance runner, test suites, and the hosted micropub.rocks procedure
- [docs/deployment.md](docs/deployment.md): production setup and deployment

Contributor and agent conventions are in [CLAUDE.md](CLAUDE.md).
