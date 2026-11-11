# Micropub Publisher

A standalone Micropub, media, IndieAuth, and Markdown editor service backed by GitHub App user authorization. The service has no repository credential of its own: each GitHub write uses a user access token limited by both the signed-in user and the GitHub App installation.

This was extracted from `martinemde.com` at commit `964f9969d271`. `PUBLIC_APP_URL` and `PUBLIC_SITE_URL` allow the publisher and published site to use different origins. All 35 in-scope local Micropub conformance cases pass. Hosted conformance has not been verified; see [docs/testing.md](docs/testing.md) for the procedure and limits of local judgments.

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

**Post details** supports Micropub `summary`, `featured`, `updated`, and the
`visibility` extension. Summary loads older descriptions; featured is a cover
image URL separate from content photos. Updated time is optional and uses local
time in the form and ISO timestamps in requests. Visibility can be omitted or set
to public, unlisted, or private, independently of draft status. The blog currently
excludes unlisted and private posts from publication; these values do not protect
repository files. Clearing a field replaces its property with an empty array.
Editing an older post migrates its description to summary.

Each post is committed as a Markdown file whose front matter is its Micropub
properties, top-level under their Micropub names: `name`, `published` (ISO 8601),
`updated`, `author` (`AUTHOR_NAME`, else `GITHUB_OWNER`), `summary`, `featured`,
`category`, `photo`, `bookmark-of`, `post-status`, `visibility`, `slug`, then any
other property a client sent. A single value is written as a scalar (`category`
and `photo` stay lists); reading wraps it back in an array. The body is the
`content`, exactly; `content-type: text/html` marks a body submitted as
`content.html`. Photos and bookmarks are not copied into the body: the blog
renders them from `photo` and `bookmark-of`. `src/lib/post-properties.ts` reads
this format, and only this format.

Expand entries in the editor's **Action log** to inspect the actual request body,
HTTP status, response body, and `Location` header. All four composers create
`h-entry` objects: `bookmark-of` identifies a bookmark and `photo` a photo post.
Like the blog's `src/lib/utils/post-model.ts`, the editor recognizes an article
when its nonempty name differs from the beginning of its nonempty content;
otherwise it recognizes a note. Updates send `action: update` with
`replace` properties. Uploading a file sends multipart data to `/micropub/media`,
then its returned URL is used in the post. The log labels `/api/posts` requests as
publisher-specific APIs rather than Micropub. Logs are held only in page memory,
omit session credentials and binary file contents, and clear on reload.

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

## Code conventions

SvelteKit 3 options, including the adapter and CSRF policy, are passed to
`sveltekit(...)` in `vite.config.ts`; there is no `svelte.config.js`. Environment
variables are declared in `src/env.ts` and imported from `$app/env/private` or
`$app/env/public`; tests change them through `privateEnv` and `publicEnv` in
`src/lib/test-helpers.ts`. Import library modules as `#lib/…` with explicit file
extensions. Import `.svelte` components by relative path instead, because
`svelte-check --tsgo` does not type-check props through `#lib`.

`scripts/cloudflare-adapter.mjs` wraps the adapter's Worker in
`scripts/cloudflare-worker.mjs`, which routes every request through one Durable
Object. Adapter 8 passes no per-request `platform`, so that object registers its
storage on `globalThis` for `src/lib/server/state.ts`.

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

Production runs on Cloudflare Workers at `https://publish.martinemde.com`. See
[docs/deployment.md](docs/deployment.md) for the GitHub App settings, secrets,
deploy commands, and post-deploy checks.

## Documentation

- [docs/micropub.md](docs/micropub.md): supported Micropub features, media, and storage backends
- [docs/authentication.md](docs/authentication.md): GitHub App sign-in, IndieAuth, and token state
- [docs/testing.md](docs/testing.md): conformance runner, test suites, and the hosted micropub.rocks procedure
- [docs/deployment.md](docs/deployment.md): production setup and deployment
