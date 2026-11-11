# Testing

What the publisher implements is described in [micropub.md](micropub.md) and
[authentication.md](authentication.md); this page covers how it is verified.

## Local upstream conformance

Run `pnpm run conformance:setup` once to download micropub.rocks revision
`eeac57ad4b38e6a6cc0a31d6a4fe2bca2794f791`. The setup command verifies its SHA-256
before extracting it into ignored `.conformance/upstream/`. After setup, test runs
need no internet access, GitHub credentials, email login, or deployment.

Run `pnpm run conformance` for the complete local baseline. To rerun specific
cases, use e.g. `pnpm run conformance 100 200 600 800 801 803 804`.
`pnpm run conformance --help` explains the command. The app and fixture server bind
only to `127.0.0.1`, on ports 4177 and 4178; the command fails if either is busy and
stops its own servers when it finishes.

The runner executes the pinned upstream test-page JavaScript and `common.js` in
jsdom. A narrow renderer substitutes the known PHP template variables and partials;
unknown expressions fail the run. The adapter replaces the PHP HTTP proxy and
report persistence, sending the upstream request payloads to the real SvelteKit
HTTP server and feeding responses into the upstream assertions. This runs the
upstream browser tests, not the PHP website, discovery/login flow, or its database.
The unchanged upstream scripts share a function scope so their declarations are
available across scripts in jsdom. `pnpm run test:conformance`
checks both passing and deliberately failing responses and pending manual checks.

Each run copies the app into `.conformance/runs/<timestamp>/app/`, without `.env`,
and starts it with an allowlisted environment, the file storage backend, and fake
GitHub credentials. The runner seeds the real in-memory token store through Vite's
server module loader with create/update/delete/undelete-scoped and unscoped tokens; no test authentication
route or bypass is added to the shipped app. App fetches to external hosts are
blocked, and the suite transport allows only its two local origins without
following redirects. The standalone fixture origin represents the published site
for uploaded media; it does not implement the real blog's post rendering.

Each case saves its requests/responses, assertion HTML, and a snapshot of generated
Markdown. Reports redact the ephemeral tokens. `summary.json` contains the full
results; `.conformance/latest.json` points to the latest run. The runner confirms manual checks only after successful file-backed judgments.
Unresolved checks remain pending; deployed blog rendering is verified separately.
A successful creation status alone does not prove correct publication or content.

Exit codes are 0 when all selected cases pass, 1 for failed or pending checks, and
2 for harness errors. The default run excludes syndication test 601 per the current
scope and records that exclusion. Other unsupported optional features remain
visible as failures. File 805 is included even though upstream's database seed
omits it; its assertion expects the literal error string `bad request`, which differs
from Micropub's `invalid_request`. Preserve that distinction when fixing the app.

The local suite passes all 35 in-scope cases. Case 601 (syndication) is excluded: the
local run configures no Bluesky credentials, so `syndicate-to` is empty.
Manual checks are judged against the actual generated files: canonical properties,
blog frontmatter, content/HTML, photo URLs and alt text, uploaded bytes, absence of
deleted post files, and byte-for-byte restoration. Reports retain each judgment's
evidence. These checks verify publisher output, not the deployed blog theme.

Case 802 has one documented transport correction: its template describes body-only
authentication but omits `skipauth`, causing upstream's proxy to add a duplicate
header token. The local runner omits that header on its create request; the source
query and all upstream assertions remain unchanged. Case 805 still verifies that
actual duplicate transports are rejected. No upstream source files are edited.

The workflow `.github/workflows/conformance.yml` runs these commands on pushes and
pull requests with no publishing credentials and read-only repository permissions.
It uploads reports and generated post snapshots even on failure, without uploading
the isolated app or dependency tree. Pending judgments never count as passes.

## Unit and integration tests

Run `pnpm run test`, `pnpm run check`, `pnpm run lint`, and `pnpm run build`.
Run `pnpm run test src/hooks.server.test.ts` for the protocol transport regression tests.

The hook tests exercise the real hook chain, session sealing, token store, parsers,
and endpoint handlers. Transport tests use in-memory storage; authorization and
action tests use the real GitHub storage backend with GitHub faked at its API
boundary, asserting that rejected requests produce no writes. The complete
authorization/callback/token/publish flow also verifies scope propagation. SvelteKit's request
context is supplied by the harness, including conversion of endpoint HttpErrors
to responses. This is not a deployed HTTP test or a hosted conformance result.
The older Micropub endpoint tests mock parsing and storage and cannot demonstrate
that the generated blog content is correct.

## Run the hosted suite

Local runs above are the development loop. The owner operates the hosted test UI
and deployment for a later interoperability check. No hosted run has been performed
for this extraction.

1. Use an isolated test repository and test identity page. Configure the
   publisher's GitHub App callback as `PUBLIC_APP_URL/login/callback`.
   Set `MICROPUB_BACKEND=github` only for that test repository. The file backend
   writes to the publisher checkout, not to the separately hosted blog.
2. On the test identity page, advertise `rel=micropub`, `rel=authorization_endpoint`,
   and `rel=token_endpoint` pointing to the publisher. `PUBLIC_SITE_URL` must
   match that identity; it also supplies returned post URLs.
3. Sign in at [micropub.rocks](https://micropub.rocks/) via its email link, then
   authorize its server tests against the test identity. This grants publishing
   access and the create/media tests write content.
4. Start with 600 and 800–804, then 100/200 and category tests. Inspect the
   request, response, committed Markdown, and rendered blog post. A Location
   header alone does not verify correct content or publication.
5. Record the case number, request encoding, status/body, and content mismatch
   here, omitting tokens, cookies, authorization codes, and secrets. Reproduce
   each failure locally before changing the implementation.
