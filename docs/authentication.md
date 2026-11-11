# Authentication

The publisher has no repository credential of its own. Every GitHub write uses a GitHub
App **user** access token, limited by both the signed-in user's access and the app's
installation (Contents read/write on selected repositories). No installation token,
app private key, or OAuth `repo` scope is used. Sign-in also checks that the user owns
the publishing repository or has write, maintain, or admin permission on it.

## GitHub sign-in

`/auth/github/login` starts GitHub App user authorization with `state` and S256 PKCE.
`/login/callback` exchanges the code using only the app's client ID and secret
(`/auth/github/callback` remains an alias). `/auth/github/logout` removes the GitHub
credential and every Micropub token issued from it.

GitHub access and rotating refresh tokens never leave the server. Encrypted
iron-session cookies (HttpOnly, Secure in production, SameSite=Lax, 7 days) and sealed
IndieAuth codes carry only opaque credential references. The editor and Micropub
clients share one refresh path, and concurrent refreshes share one request. A failed
refresh requires signing in again.

When an installation starts on GitHub with user authorization enabled, the first
callback can arrive without our state and PKCE. The publisher discards that code and
starts a fresh protected login. To retry a failed installation landing, open
`/auth/github/login`; reinstalling is not necessary.

## IndieAuth

The publisher wraps GitHub sign-in in an IndieAuth authorization and token endpoint for
Micropub clients:

1. The client discovers `authorization_endpoint`, `token_endpoint`, and `micropub`
   from `<link>` tags on the blog (`PUBLIC_SITE_URL`).
2. `/auth/indieauth/authorize` validates the request: `me` must be the site's origin,
   `client_id` and `redirect_uri` must be HTTPS (or `http://localhost`), and
   `redirect_uri` must share the client's origin (any localhost port when both are
   local). PKCE accepts S256 or plain.
3. The user signs in with GitHub; the callback issues a sealed authorization code that
   expires in 10 minutes and can be used once.
4. `/auth/indieauth/token` exchanges the code, verifying PKCE, for an opaque access
   token that maps to the GitHub credential and expires after 30 days.

Only the requested supported scopes (`create`, `update`, `delete`, `undelete`) are
granted, and token exchange cannot broaden them.

## Request rules for `/micropub`

Cross-origin and Origin-less requests must present a bearer token. Only requests whose
`Origin` matches the publisher may use the editor's session cookie. CORS lets browser
clients send `Authorization` and read `Location`, but does not allow credentialed
cross-origin cookie access. Other routes keep SvelteKit's CSRF protection.

## State

In production, one SQLite-backed Durable Object holds GitHub credentials, Micropub
tokens, and consumed authorization codes, and serializes every request, including
GitHub writes and token refreshes. Credentials survive eviction and deployment. Token
revocation deletes the live record, though Cloudflare's storage recovery can retain
historical data. Vite development and local conformance runs use in-memory stores.

## Known gaps

- `/api/posts/read` checks only that a path starts with `src/content/blog/` and ends in
  `.md`; it does not canonicalize `..` segments, and the file backend's `join` does not
  confine paths to the content directory.
- Error logging for OAuth, publishing, media, and editor APIs avoids dumping raw GitHub
  error objects; keep it that way when adding handlers.
