# Micropub conformance testing

## Local verification

Run `bun run test`, `bun run check`, `bun run lint`, and `bun run build`.
Run `bun run test src/hooks.server.test.ts` for the protocol transport regression tests.

The hook tests exercise the real hook chain, session sealing, token store, parsers,
and endpoint handlers with the in-memory storage backend. SvelteKit's request
context is supplied by the harness, including conversion of endpoint HttpErrors
to responses. This is not a deployed HTTP test or a hosted conformance result.
The older Micropub endpoint tests mock parsing and storage and cannot demonstrate
that the generated blog content is correct.

Cross-origin and Origin-less Micropub requests must provide a protocol token.
Only requests with an Origin matching the publisher may use its editor session
cookie. CORS permits browser clients to send Authorization and read Location;
it does not enable credentialed cross-origin cookie access. Other routes retain
CSRF protection.

## Suite mapping and known gaps

Test numbers refer to the upstream [micropub.rocks server test definitions](https://github.com/aaronpk/micropub.rocks/blob/main/database/data.sql).
These are code-review findings, not recorded passes from the hosted suite.

- 100, 200 (basic form/JSON creation): handlers exist. Posts without a name all
  get `untitled-post`; repeated creates on the same date overwrite that file.
  Posts default to `published: false`, so a successful 201 does not mean a post
  is visible on the blog.
- 101, 107, 201 (categories): JSON arrays work, but form `category[]` is not
  decoded and `Object.fromEntries` loses repeated values. Plain category values
  are incorrectly split on commas.
- 202 (HTML content): HTML is stored verbatim in Markdown. Verify the blog's
  rendering and sanitization before claiming a pass.
- 104, 203–206 (photo URLs, alt text, nested objects): these properties are ignored.
- 300–301 (inline multipart): unsupported at `/micropub`. A separate media
  endpoint is advertised; clients should upload there first.
- 400–405, 500–503 (update/delete/undelete): unsupported. Worse, `action` is
  ignored and these requests currently fall through to creating a post.
- 600 (configuration): implemented, including the separate publisher origin.
  601 (`q=syndicate-to`) and 602–603 (`q=source`) are unsupported.
- 700–702 (media): hook regressions cover authenticated JPEG/PNG/GIF requests.
  Body-token authentication is missing on the media route. Validation errors
  are caught and converted to 500 instead of retaining their 400/415 status.
- 800–804 (authentication): hook regressions cover header/body tokens and
  rejection of missing/invalid tokens. Stored scopes and identity are not
  checked by Micropub handlers. Authorization ignores the requested scope and
  token issuance hardcodes `create update`.

The next conformance slice should reject unsupported actions and enforce scopes
before tackling create serialization and collision handling. Do not run the
update/delete groups against real content while actions still fall through.

## Credential boundary review

The publisher uses a user-authorized GitHub token for the configured repository;
Micropub clients receive an opaque token ID. The editor session contains the
GitHub token encrypted in an HttpOnly cookie, while protocol-token mappings live
in server memory. Restarting the single process invalidates those mappings.

A separate origin isolates this service from blog runtime code, but the GitHub
OAuth request still asks for broad `repo` scope. It is not a repository-scoped
credential. Raw error logging in publishing and OAuth paths needs review before
relying on logs to be credential-free. Client-supplied slugs, filenames, and read
paths also need canonical path validation; the file backend's `join` does not
confine traversal to its intended content directory.

## Run the hosted suite

The owner operates the hosted test UI and deployment. No hosted run has been
performed for this extraction.

1. Use an isolated test repository and test identity page. Configure the
   publisher's GitHub OAuth callback as `PUBLIC_APP_URL/auth/github/callback`.
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
