import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { MicropubProperties } from './micropub.ts';

/** Bluesky counts post length in graphemes. */
export const BLUESKY_LIMIT = 300;
/** Blobs larger than this are rejected by the PDS. */
const THUMB_LIMIT = 976_560;

interface Link {
  start: number;
  end: number;
  uri: string;
}
/** Plain text with its links, as UTF-16 offsets into `text`. */
export interface RichText {
  text: string;
  links: Link[];
}
export interface Card {
  uri: string;
  title: string;
  description: string;
  image?: string;
}
export interface BlueskyDraft extends RichText {
  /** A link card for the permalink; absent when the text stands on its own. */
  card?: Card;
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  ordered?: boolean;
  children?: MdNode[];
}

const blocks = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'code',
  'thematicBreak',
  'table'
]);

/** Markdown (or simple HTML) as plain text, keeping links as facets. */
export function plainText(markdown: string, base: string, html = false): RichText {
  if (html) {
    const text = markdown
      .replace(/<(br|\/p|\/li|\/h\d|\/blockquote)\b[^>]*>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    return { text: tidy(text), links: [] };
  }
  const tree = unified().use(remarkParse).parse(markdown) as MdNode;
  let text = '';
  const links: Link[] = [];
  const separate = () => {
    text = text.replace(/[ \t]+$/, '');
    if (text && !text.endsWith('\n\n')) text += text.endsWith('\n') ? '\n' : '\n\n';
  };
  const visit = (node: MdNode, list?: { ordered: boolean; index: number }) => {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        text += (node.value ?? '').replace(/\s*\n\s*/g, ' ');
        return;
      case 'code':
        separate();
        text += node.value ?? '';
        return;
      case 'break':
        text += '\n';
        return;
      case 'image':
      case 'html':
      case 'definition':
        return;
      case 'thematicBreak':
        return separate();
      case 'link': {
        const start = text.length;
        node.children?.forEach((child) => visit(child));
        let uri: string;
        try {
          uri = new URL(node.url ?? '', base).href;
        } catch {
          return;
        }
        if (text.length > start && /^https?:/.test(uri))
          links.push({ start, end: text.length, uri });
        return;
      }
      case 'listItem':
        // Items follow one another line by line; the list itself is set apart.
        if (!text.endsWith('\n')) separate();
        text += list?.ordered ? `${list.index}. ` : '• ';
        // A tight list item's paragraph shouldn't add a blank line after the bullet.
        node.children?.forEach((child, index) =>
          child.type === 'paragraph' && index === 0
            ? child.children?.forEach((inline) => visit(inline))
            : visit(child)
        );
        return;
      case 'list': {
        let index = 1;
        separate();
        for (const child of node.children ?? []) {
          visit(child, { ordered: !!node.ordered, index: index++ });
          text = text.replace(/\n+$/, '');
          text += '\n';
        }
        return;
      }
    }
    if (blocks.has(node.type)) separate();
    node.children?.forEach((child) => visit(child));
  };
  visit(tree);
  // The walk never starts with whitespace or leaves blank runs, so offsets hold.
  const trimmed = text.trimEnd();
  return { text: trimmed, links: links.filter((link) => link.end <= trimmed.length) };
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const graphemes = (text: string) => [...segmenter.segment(text)].length;

/** Shorten to `limit` graphemes at a word boundary, ending with an ellipsis. */
export function truncate(rich: RichText, limit: number): RichText {
  if (graphemes(rich.text) <= limit) return rich;
  const segments = [...segmenter.segment(rich.text)];
  let cut = segments[limit - 1].index;
  const space = rich.text.slice(0, cut).search(/\s\S*$/);
  if (space > cut / 2) cut = space;
  const text = `${rich.text.slice(0, cut).trimEnd()}…`;
  return { text, links: rich.links.filter((link) => link.end <= cut) };
}

function join(...parts: RichText[]): RichText {
  let text = '';
  const links: Link[] = [];
  for (const part of parts.filter((part) => part.text)) {
    if (text) text += '\n\n';
    links.push(
      ...part.links.map((link) => ({
        ...link,
        start: link.start + text.length,
        end: link.end + text.length
      }))
    );
    text += part.text;
  }
  return { text, links };
}

const plain = (text: string): RichText => ({ text, links: [] });
const first = (properties: MicropubProperties, key: string): string => {
  const value = properties[key]?.[0];
  return typeof value === 'string' ? value.trim() : '';
};

/** A short label for a link: its host and path, without the scheme. */
function linkLabel(uri: string): string {
  const label = uri.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

/**
 * The Bluesky post for a blog post. A note that fits is posted whole, without
 * a link back. An article, a photo, a bookmark, or a note too long to fit gets
 * a link card for its permalink, so readers can reach the rest.
 */
export function composeBlueskyPost(
  properties: MicropubProperties,
  permalink: string,
  card: Omit<Card, 'uri'>
): BlueskyDraft {
  const name = first(properties, 'name');
  const raw = properties.content?.[0];
  const html = !!raw && typeof raw === 'object' && 'html' in raw;
  const source =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object'
        ? String(
            (raw as { html?: unknown; text?: unknown }).html ??
              (raw as { text?: unknown }).text ??
              ''
          )
        : '';
  const body = plainText(source, permalink, html);
  const linked: Card = { uri: permalink, ...card };
  const bookmark = first(properties, 'bookmark-of');

  if (bookmark) {
    const label = linkLabel(bookmark);
    const link: RichText = { text: label, links: [{ start: 0, end: label.length, uri: bookmark }] };
    const room = BLUESKY_LIMIT - graphemes(label) - 2;
    return { ...join(truncate(body.text ? body : plain(name), room), link), card: linked };
  }
  if (name && !properties.photo?.length) {
    return {
      ...truncate(join(plain(name), plain(first(properties, 'summary'))), BLUESKY_LIMIT),
      card: linked
    };
  }
  if (properties.photo?.length) {
    return { ...truncate(body.text ? body : plain(name), BLUESKY_LIMIT), card: linked };
  }
  if (graphemes(body.text) <= BLUESKY_LIMIT) return body;
  return { ...truncate(body, BLUESKY_LIMIT), card: linked };
}

/** The Open Graph tags a published page carries, for its link card. */
export function openGraph(html: string): Omit<Card, 'uri'> {
  const tag = (property: string) => {
    const match = new RegExp(`<meta\\s+property="og:${property}"\\s+content="([^"]*)"`, 'i').exec(
      html
    );
    return match
      ? match[1]
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
      : '';
  };
  return { title: tag('title'), description: tag('description'), image: tag('image') || undefined };
}

const utf8 = new TextEncoder();
const byteOffset = (text: string, index: number) => utf8.encode(text.slice(0, index)).length;

export interface BlueskyAccount {
  service: string;
  identifier: string;
  password: string;
}

async function xrpc<T>(
  service: string,
  method: string,
  init: { token?: string; json?: unknown; body?: BodyInit; type?: string }
): Promise<T> {
  const response = await fetch(`${service}/xrpc/${method}`, {
    method: 'POST',
    headers: {
      ...(init.token && { Authorization: `Bearer ${init.token}` }),
      'Content-Type': init.type ?? 'application/json'
    },
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Bluesky ${method} failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

/** Posts the draft and returns the post's bsky.app URL. */
export async function postToBluesky(account: BlueskyAccount, draft: BlueskyDraft): Promise<string> {
  const session = await xrpc<{
    did: string;
    handle: string;
    accessJwt: string;
    didDoc?: { service?: { id: string; serviceEndpoint: string }[] };
  }>(account.service, 'com.atproto.server.createSession', {
    json: { identifier: account.identifier, password: account.password }
  });
  // Write to the account's own PDS when the entryway names it.
  const pds =
    session.didDoc?.service?.find((service) => service.id === '#atproto_pds')?.serviceEndpoint ??
    account.service;

  let thumb: unknown;
  if (draft.card?.image) {
    try {
      const image = await fetch(draft.card.image, { signal: AbortSignal.timeout(20000) });
      const bytes = image.ok ? await image.arrayBuffer() : undefined;
      if (bytes && bytes.byteLength <= THUMB_LIMIT) {
        thumb = (
          await xrpc<{ blob: unknown }>(pds, 'com.atproto.repo.uploadBlob', {
            token: session.accessJwt,
            body: bytes,
            type: image.headers.get('content-type') ?? 'image/png'
          })
        ).blob;
      }
    } catch (error) {
      // A card without a thumbnail is better than no post.
      console.error(
        'Bluesky thumbnail upload failed:',
        error instanceof Error ? error.message : error
      );
    }
  }

  const record = {
    $type: 'app.bsky.feed.post',
    text: draft.text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    ...(draft.links.length && {
      facets: draft.links.map((link) => ({
        index: {
          byteStart: byteOffset(draft.text, link.start),
          byteEnd: byteOffset(draft.text, link.end)
        },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: link.uri }]
      }))
    }),
    ...(draft.card && {
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: draft.card.uri,
          title: draft.card.title,
          description: draft.card.description,
          ...(thumb !== undefined && { thumb })
        }
      }
    })
  };
  const created = await xrpc<{ uri: string }>(pds, 'com.atproto.repo.createRecord', {
    token: session.accessJwt,
    json: { repo: session.did, collection: 'app.bsky.feed.post', record }
  });
  const rkey = created.uri.split('/').pop();
  return `https://bsky.app/profile/${session.handle}/post/${rkey}`;
}
