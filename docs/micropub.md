# Micropub endpoint

`/micropub` and `/micropub/media` implement [Micropub](https://www.w3.org/TR/micropub/).
The built-in editor uses the same endpoints with its session cookie; other clients use an
IndieAuth bearer token (see [authentication.md](authentication.md)). The front matter
format the publisher writes is described in the [README](../README.md).

## Queries

`q=config` advertises the media endpoint, `syndicate-to`, and `post-types`
(note, article, photo, bookmark). `q=syndicate-to` returns just the targets. `q=source` returns a post's properties, optionally
filtered with `properties[]`. Both require authentication.

## Creating posts

Form-encoded, JSON, and multipart requests are accepted. Repeated categories and nested
property values are preserved. All post types are `h-entry`; `bookmark-of` identifies a
bookmark and `photo` a photo post. Photos may be URLs, `{ value, alt }` objects, or
multipart uploads.

Supported [extensions](https://indieweb.org/Micropub-extensions):

- `post-status`: `published` (default) or `draft`. Hiding drafts is up to the blog.
- `mp-slug`: suggests a slug, normalized to lowercase letters, digits, and hyphens.
  The `slug` property is also accepted for the built-in editor.
- `post-types` in `q=config`.
- `mp-syndicate-to`: copies the post to a configured target (see Syndication below).

A slug that is already used (on any date, or by an archived deletion) gets a unique
suffix. The `Location` header and the stored `mp-slug` contain the allocated slug.
Updates keep existing permalinks. HTML content is stored as-is with
`content-type: text/html` for the blog renderer to handle.

Not implemented: location discovery or rendering, media queries,
post-list queries, and other experimental extensions.

## Updating and deleting

Updates support `replace`, `add`, and `delete`. Delete first saves a recovery copy at
`.micropub/deleted/YYYY-MM-DD-slug.json`, outside the blog content directory, then
removes the live file. Undelete restores the exact original and removes the copy.

With GitHub storage these are separate commits: an interrupted delete can leave both
copies (retry the delete), and an interrupted undelete can leave a recovery copy beside
the restored post. An API failure does not prove that no storage operation happened.

Each action requires the matching `create`, `update`, `delete`, or `undelete` scope.
Scope failures return HTTP 401 `insufficient_scope`, per
[Micropub error responses](https://www.w3.org/TR/micropub/#error-response). Sending a
token in both the header and the body returns 400.

## Media

The media endpoint accepts one JPEG, PNG, GIF, WebP, or AVIF file per request, up to
10 MiB. Empty files and SVG are rejected. Files are named with a server-generated UUID
and an extension derived from the declared media type, so client filenames cannot choose
paths or overwrite earlier uploads. Image bytes are not decoded or re-encoded. Inline
multipart photos on a create request get the same validation.

Uploads are stored at `static/images/blog/UUID.ext` in the publishing repository and
served from `PUBLIC_SITE_URL/images/blog/UUID.ext`.

## Storage backends

`src/lib/server/storage/` separates content storage from protocol handling. Set
`MICROPUB_BACKEND` to choose one; otherwise development (`pnpm run dev`) uses `file` and
production uses `github`.

- `github`: commits to `GITHUB_OWNER/GITHUB_REPO` (default repo `OWNER.github.io`)
  through the Contents API with the signed-in user's token.
- `file`: writes the same paths under the publisher's working directory. Endpoint
  authentication still applies. It does not write to a separately hosted blog.
- `test`: in-memory, for unit tests.

Posts are written to `src/content/blog/YYYY-MM-DD-slug.md`.

## Example

```sh
curl -X POST https://publish.martinemde.com/micropub \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": ["h-entry"],
    "properties": {
      "name": ["My New Post"],
      "content": ["# Hello\n\nThis is my post content."],
      "mp-slug": ["my-new-post"],
      "category": ["tech", "blog"]
    }
  }'
```

## Syndication

The publisher copies posts to Bluesky (POSSE). `syndicate-to` lists the target only when
`BLUESKY_IDENTIFIER` (a var in `wrangler.jsonc`) and the `BLUESKY_APP_PASSWORD` secret are
both set; see [deployment.md](deployment.md). An unknown target is rejected with
`invalid_request` before anything is written.

A create, or an update whose `add` or `replace` carries `mp-syndicate-to`, queues a job in
the Durable Object. Its alarm fetches the permalink until the deploy is live (1, 2, 4, 8,
then 15 minutes apart; then it gives up and the editor shows why), posts once per target,
and commits the copy's URL to the post's `syndication` list. The
`global_fetch_strictly_public` flag lets the Worker reach martinemde.com on the same zone.

A short note is posted whole without a link. Articles (name and summary), photos,
bookmarks (commentary and the bookmarked URL), and notes over 300 graphemes get a link
card for the permalink, built from the page's Open Graph tags and image. Drafts,
unlisted, and private posts are never copied, and a post already on a service is not
posted there again.
