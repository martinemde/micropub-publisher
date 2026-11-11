import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BLUESKY_LIMIT,
  composeBlueskyPost,
  graphemes,
  openGraph,
  plainText,
  postToBluesky
} from './bluesky.ts';

const permalink = 'https://example.com/2026/11/11/post';
const card = { title: 'Card title', description: 'Card description', image: undefined };

describe('plainText', () => {
  it('keeps links as facets and separates blocks', () => {
    const rich = plainText(
      'Read [my *longer* post](/2026/09/20/article) today.\n\n- one\n- two\n\n> quoted',
      permalink
    );
    expect(rich.text).toBe('Read my longer post today.\n\n• one\n• two\n\nquoted');
    expect(rich.links).toEqual([
      { start: 5, end: 19, uri: 'https://example.com/2026/09/20/article' }
    ]);
    expect(rich.text.slice(5, 19)).toBe('my longer post');
  });

  it('drops images and strips HTML bodies', () => {
    expect(plainText('![alt](/a.png)\n\nText', permalink).text).toBe('Text');
    expect(plainText('<p>One &amp; two</p><p>Three</p>', permalink, true).text).toBe(
      'One & two\n\nThree'
    );
  });
});

describe('composeBlueskyPost', () => {
  it('posts a short note whole, with no link back', () => {
    const draft = composeBlueskyPost({ content: ['Small thoughts.'] }, permalink, card);
    expect(draft).toEqual({ text: 'Small thoughts.', links: [] });
  });

  it('truncates a long note and links the rest', () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const draft = composeBlueskyPost({ content: [words] }, permalink, card);
    expect(graphemes(draft.text)).toBeLessThanOrEqual(BLUESKY_LIMIT);
    expect(draft.text.endsWith('…')).toBe(true);
    // Cut at a word boundary: every remaining word is whole.
    expect(
      draft.text
        .slice(0, -1)
        .split(' ')
        .every((word) => words.includes(word))
    ).toBe(true);
    expect(draft.card).toEqual({ uri: permalink, ...card });
  });

  it('counts graphemes, not code units', () => {
    const draft = composeBlueskyPost({ content: ['👍🏽'.repeat(300)] }, permalink, card);
    expect(draft.card).toBeUndefined();
  });

  it('introduces an article by name and summary with a card', () => {
    const draft = composeBlueskyPost(
      { name: ['A title'], summary: ['Short'], content: ['Long body'] },
      permalink,
      card
    );
    expect(draft.text).toBe('A title\n\nShort');
    expect(draft.card?.uri).toBe(permalink);
  });

  it('links the bookmarked page after the commentary', () => {
    const draft = composeBlueskyPost(
      { 'bookmark-of': ['https://www.example.org/a/page/'], content: ['Worth reading.'] },
      permalink,
      card
    );
    expect(draft.text).toBe('Worth reading.\n\nexample.org/a/page');
    expect(draft.links).toEqual([{ start: 16, end: 34, uri: 'https://www.example.org/a/page/' }]);
    expect(draft.card?.uri).toBe(permalink);
  });

  it('gives a photo post a card for its permalink', () => {
    const draft = composeBlueskyPost(
      { photo: [{ value: 'https://example.com/a.png', alt: '' }], content: ['Sunset'] },
      permalink,
      card
    );
    expect(draft.text).toBe('Sunset');
    expect(draft.card?.uri).toBe(permalink);
  });
});

describe('openGraph', () => {
  it('reads the card fields from a page', () => {
    expect(
      openGraph(
        '<meta property="og:title" content="Tom &amp; Jerry"><meta property="og:description" content="&quot;Hi&quot;"><meta property="og:image" content="https://example.com/social.png">'
      )
    ).toEqual({
      title: 'Tom & Jerry',
      description: '"Hi"',
      image: 'https://example.com/social.png'
    });
  });
});

describe('postToBluesky', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signs in, uploads the thumbnail, and creates the post with UTF-8 facet offsets', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const body =
          typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? undefined);
        calls.push({ url, body });
        if (url.endsWith('createSession'))
          return Response.json({
            did: 'did:plc:abc',
            handle: 'example.com',
            accessJwt: 'jwt',
            didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] }
          });
        if (url === 'https://example.com/social.png')
          return new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/png' }
          });
        if (url.endsWith('uploadBlob')) return Response.json({ blob: { ref: 'blob' } });
        if (url.endsWith('createRecord'))
          return Response.json({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz' });
        throw new Error(`Unexpected ${url}`);
      })
    );
    const url = await postToBluesky(
      { service: 'https://bsky.social', identifier: 'example.com', password: 'app-password' },
      {
        text: 'Café link',
        links: [{ start: 5, end: 9, uri: 'https://example.org' }],
        card: {
          uri: permalink,
          title: 'T',
          description: 'D',
          image: 'https://example.com/social.png'
        }
      }
    );
    expect(url).toBe('https://bsky.app/profile/example.com/post/3kxyz');
    expect(calls.map((call) => call.url)).toEqual([
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      'https://example.com/social.png',
      'https://pds.example/xrpc/com.atproto.repo.uploadBlob',
      'https://pds.example/xrpc/com.atproto.repo.createRecord'
    ]);
    const { record } = calls[3].body as { record: Record<string, unknown> };
    // "Café " is six bytes in UTF-8.
    expect(record.facets).toEqual([
      {
        index: { byteStart: 6, byteEnd: 10 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.org' }]
      }
    ]);
    expect(record.embed).toEqual({
      $type: 'app.bsky.embed.external',
      external: { uri: permalink, title: 'T', description: 'D', thumb: { ref: 'blob' } }
    });
  });
});
