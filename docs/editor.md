# Editor

`/editor` is the publisher's own Micropub client. It talks to `/micropub` and
`/micropub/media` with the signed-in session cookie, and to the publisher-specific
`/api/posts` and `/api/posts/read` endpoints to list and load saved posts.

## Composers

There are Article, Note, Bookmark, and Photo composers. New drafts are kept separately
per type in local storage, so switching composers preserves unfinished work. Select a
saved post to edit it in the matching composer; use **New post** to start again.

Notes need only text, bookmarks need a URL, and photos accept uploaded images or image
URLs with alt text and an optional caption. All four create `h-entry` objects:
`bookmark-of` identifies a bookmark and `photo` a photo post. Like the blog's
`src/lib/utils/post-model.ts`, the editor recognizes an article when its nonempty name
differs from the beginning of its nonempty content; otherwise it recognizes a note.

## Post details

**Post details** sets Micropub `summary`, `featured`, `updated`, and the `visibility`
extension.

- Summary loads older descriptions; editing an older post migrates its description to
  summary.
- Featured is a cover image URL, separate from content photos.
- Updated time is optional. The form uses local time; requests use ISO timestamps.
- Visibility can be omitted or set to public, unlisted, or private, independently of
  draft status. The blog excludes unlisted and private posts from publication, but
  these values do not protect repository files.

Clearing a field replaces its property with an empty array.

## Requests

Creating a post sends a Micropub create. Editing sends `action: update` with `replace`
properties and keeps the slug the server returned. Uploading a file sends multipart
data to `/micropub/media`, then uses the returned URL in the post.

Expand entries in the **Action log** to inspect each request body, HTTP status,
response body, and `Location` header. The log labels `/api/posts` requests as
publisher-specific APIs rather than Micropub. Logs are held only in page memory, omit
session credentials and binary file contents, and clear on reload.
