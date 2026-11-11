# Micropub endpoint

`/micropub` and `/micropub/media` implement [Micropub](https://www.w3.org/TR/micropub/).
The built-in [editor](editor.md) uses the same endpoints with its session cookie; other
clients use an IndieAuth bearer token (see [authentication.md](authentication.md)).

## Post files

Each post is committed to `src/content/blog/YYYY-MM-DD-slug.md`. Its front matter is
its Micropub properties, top-level under their Micropub names: `name`, `published`
(ISO 8601), `updated`, `author` (`AUTHOR_NAME`, else `GITHUB_OWNER`), `summary`,
`featured`, `category`, `photo`, `bookmark-of`, `post-status`, `visibility`, `slug`,
then any other property a client sent. A single value is written as a scalar
(`category` and `photo` stay lists); reading wraps it back in an array.

The body is the `content`, exactly; `content-type: text/html` marks a body submitted as
`content.html`. Photos and bookmarks are not copied into the body: the blog renders
them from `photo` and `bookmark-of`. `src/lib/post-properties.ts` reads this format,
and only this format. The blog's renderer must agree with it; martinemde.com keeps
publisher-generated fixtures for that contract.

## Queries

`q=config` advertises the media endpoint, an empty `syndicate-to`, and `post-types`
(note, article, photo, bookmark). `q=source` returns a post's properties, optionally
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

A slug that is already used (on any date, or by an archived deletion) gets a unique
suffix. The `Location` header and the stored `mp-slug` contain the allocated slug.
Updates keep existing permalinks. HTML content is stored as-is with
`content-type: text/html` for the blog renderer to handle.

Not implemented: syndication, location discovery or rendering, media queries,
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
