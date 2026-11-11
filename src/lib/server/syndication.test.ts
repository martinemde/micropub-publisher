import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import matter from 'gray-matter';
import { privateEnv } from '#lib/test-helpers.ts';
import { TestStorageBackend } from './storage/test.ts';

const backend = new TestStorageBackend();
vi.mock('./storage/factory.ts', () => ({ createStorageBackend: () => backend }));
const posted: unknown[] = [];
vi.mock('./bluesky.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bluesky.ts')>()),
  postToBluesky: vi.fn(async (_account, draft) => {
    posted.push(draft);
    return `https://bsky.app/profile/example.com/post/${posted.length}`;
  })
}));

const { queueSyndication, requestedTargets, runSyndication, syndicationJob, syndicationTargets } =
  await import('./syndication.ts');

const path = 'src/content/blog/2026-11-11-hello.md';
const url = 'https://example.com/2026/11/11/hello';
const target = 'https://bsky.app/profile/example.com';
let clock = Date.now();
/** An hour past the last run, so every job is due. */
const later = () => (clock += 60 * 60_000);

function writePost(extra: Record<string, unknown> = {}) {
  return backend.createOrUpdateFile(
    path,
    matter.stringify('Hello, world.\n', {
      published: '2026-11-11T09:00:00-08:00',
      author: 'Test',
      slug: 'hello',
      ...extra
    }),
    'Add post'
  );
}

describe('syndication', () => {
  let live: boolean;
  beforeEach(async () => {
    privateEnv.BLUESKY_IDENTIFIER = 'example.com';
    privateEnv.BLUESKY_APP_PASSWORD = 'app-password';
    backend.clear();
    posted.length = 0;
    live = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        live
          ? new Response('<meta property="og:title" content="Hello">')
          : new Response('Not found', { status: 404 })
      )
    );
    await writePost();
  });
  afterEach(() => {
    privateEnv.BLUESKY_IDENTIFIER = undefined;
    privateEnv.BLUESKY_APP_PASSWORD = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('advertises Bluesky only when its credentials are set', () => {
    expect(syndicationTargets().map((entry) => entry.uid)).toEqual([target]);
    privateEnv.BLUESKY_APP_PASSWORD = undefined;
    expect(syndicationTargets()).toEqual([]);
  });

  it('rejects unknown targets', () => {
    expect(requestedTargets([target, target])).toEqual([target]);
    expect(() => requestedTargets(['https://example.social/me'])).toThrow();
  });

  it('waits for the deploy, posts once, and writes the copy back', async () => {
    live = false;
    queueSyndication(url, [target], 'token');
    await runSyndication(later());
    expect(posted).toHaveLength(0);
    expect(syndicationJob(url)?.attempts).toBe(1);

    live = true;
    await runSyndication(later());
    expect(posted).toEqual([{ text: 'Hello, world.', links: [] }]);
    expect(syndicationJob(url)).toBeUndefined();
    const { data } = matter(await backend.readFile(path));
    expect(data.syndication).toEqual(['https://bsky.app/profile/example.com/post/1']);

    // Asking again for a post that already has a Bluesky copy does nothing.
    queueSyndication(url, [target], 'token');
    await runSyndication(later());
    expect(posted).toHaveLength(1);
  });

  it('never copies drafts or unlisted posts', async () => {
    await writePost({ visibility: 'unlisted' });
    queueSyndication(url, [target], 'token');
    await runSyndication(later());
    expect(posted).toHaveLength(0);
    expect(syndicationJob(url)).toBeUndefined();
  });

  it('gives up after about half an hour and keeps the error', async () => {
    live = false;
    queueSyndication(url, [target], 'token');
    let now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      now += 60 * 60_000;
      await runSyndication(now);
    }
    expect(syndicationJob(url)?.error).toContain('not live yet');
    expect(posted).toHaveLength(0);
  });
});
