import type { BlueskyDraft } from "#lib/social-posts.ts";

export * from "#lib/social-posts.ts";

/** Blobs larger than this are rejected by the PDS. */
const THUMB_LIMIT = 976_560;

const utf8 = new TextEncoder();
const byteOffset = (text: string, index: number) =>
  utf8.encode(text.slice(0, index)).length;

export interface BlueskyAccount {
  service: string;
  identifier: string;
  password: string;
}

async function xrpc<T>(
  service: string,
  method: string,
  init: { token?: string; json?: unknown; body?: BodyInit; type?: string },
): Promise<T> {
  const response = await fetch(`${service}/xrpc/${method}`, {
    method: "POST",
    headers: {
      ...(init.token && { Authorization: `Bearer ${init.token}` }),
      "Content-Type": init.type ?? "application/json",
    },
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Bluesky ${method} failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
  return response.json() as Promise<T>;
}

/** Posts the draft and returns the post's bsky.app URL. */
export async function postToBluesky(
  account: BlueskyAccount,
  draft: BlueskyDraft,
): Promise<string> {
  const session = await xrpc<{
    did: string;
    handle: string;
    accessJwt: string;
    didDoc?: { service?: { id: string; serviceEndpoint: string }[] };
  }>(account.service, "com.atproto.server.createSession", {
    json: { identifier: account.identifier, password: account.password },
  });
  // Write to the account's own PDS when the entryway names it.
  const pds =
    session.didDoc?.service?.find((service) => service.id === "#atproto_pds")
      ?.serviceEndpoint ?? account.service;

  let thumb: unknown;
  if (draft.card?.image) {
    try {
      const image = await fetch(draft.card.image, {
        signal: AbortSignal.timeout(20000),
      });
      const bytes = image.ok ? await image.arrayBuffer() : undefined;
      if (bytes && bytes.byteLength <= THUMB_LIMIT) {
        thumb = (
          await xrpc<{ blob: unknown }>(pds, "com.atproto.repo.uploadBlob", {
            token: session.accessJwt,
            body: bytes,
            type: image.headers.get("content-type") ?? "image/png",
          })
        ).blob;
      }
    } catch (error) {
      // A card without a thumbnail is better than no post.
      console.error(
        "Bluesky thumbnail upload failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const record = {
    $type: "app.bsky.feed.post",
    text: draft.text,
    createdAt: new Date().toISOString(),
    langs: ["en"],
    ...(draft.links.length && {
      facets: draft.links.map((link) => ({
        index: {
          byteStart: byteOffset(draft.text, link.start),
          byteEnd: byteOffset(draft.text, link.end),
        },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: link.uri }],
      })),
    }),
    ...(draft.card && {
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: draft.card.uri,
          title: draft.card.title,
          description: draft.card.description,
          ...(thumb !== undefined && { thumb }),
        },
      },
    }),
  };
  const created = await xrpc<{ uri: string }>(
    pds,
    "com.atproto.repo.createRecord",
    {
      token: session.accessJwt,
      json: { repo: session.did, collection: "app.bsky.feed.post", record },
    },
  );
  const rkey = created.uri.split("/").pop();
  return `https://bsky.app/profile/${session.handle}/post/${rkey}`;
}
