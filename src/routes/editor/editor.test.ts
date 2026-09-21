import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Editor from './+page.svelte';

vi.mock('$app/environment', () => ({ browser: true, dev: true, building: false }));

let editor: ReturnType<typeof mount>;
afterEach(async () => {
  if (editor) await unmount(editor);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each([
  { content: 'Existing markdown body', original: undefined },
  { content: 'Generated body with photos', original: 'Original Micropub content' }
])(
  'loads an existing post into the editor without Node globals: $content',
  async ({ content, original }) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal('Buffer', undefined);
    const jsonResponse = (data: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => data,
      clone: () => ({ text: async () => JSON.stringify(data) })
    });
    vi.stubGlobal('fetch', async (input: string) => {
      if (input === '/api/posts') {
        return jsonResponse([
          {
            filename: 'existing.md',
            path: 'src/content/blog/existing.md',
            slug: 'existing',
            date: '2026-03-20'
          }
        ]);
      }
      expect(input).toBe('/api/posts/read?path=src%2Fcontent%2Fblog%2Fexisting.md');
      return jsonResponse({
        content,
        frontmatter: {
          title: 'Existing post',
          slug: 'existing',
          description: 'A description',
          published: true,
          date: '2026-03-20T18:25:36.789Z',
          categories: ['ruby', 'web'],
          ...(original
            ? { micropub: { properties: { name: ['Existing post'], content: [original] } } }
            : {})
        }
      });
    });
    editor = mount(Editor, {
      target: document.body,
      props: {
        data: {
          isAuthenticated: true,
          siteUrl: 'https://blog.example',
          user: { id: 1, login: 'tester', name: 'Test User', avatar_url: '' }
        }
      }
    });
    flushSync();
    await vi.waitFor(() =>
      expect(document.querySelector('aside')?.textContent).toContain('existing')
    );
    const post = [...document.querySelectorAll<HTMLButtonElement>('aside button')].find((button) =>
      button.textContent?.includes('existing')
    );
    post!.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('Existing post')
    );
    expect(document.querySelector<HTMLInputElement>('#slug')?.value).toBe('existing');
    expect(document.querySelector<HTMLInputElement>('#summary')?.value).toBe('A description');
    expect(document.querySelector<HTMLInputElement>('#categories')?.value).toBe('ruby, web');
    expect(
      new Date(document.querySelector<HTMLInputElement>('#published-at')!.value).toISOString()
    ).toBe('2026-03-20T18:25:36.789Z');
    const published = [...document.querySelectorAll('label')].find((label) =>
      label.textContent?.includes('Published')
    );
    expect(published?.querySelector('input')?.checked).toBe(true);
    expect(document.querySelector('textarea')?.value).toBe(original ?? content);
    expect(document.querySelector('main')?.textContent).not.toContain('Failed to load post');
  }
);

test.each(['unchanged', 'edited', 'now', 'new'])(
  'submits the selected publication timestamp: %s',
  async (scenario) => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const originalDate = '2026-03-20T18:25:36.789Z';
    const now = '2026-09-20T23:45:12.345Z';
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input === '/api/posts') {
        return Response.json([
          {
            filename: '2026-03-20-first.md',
            path: 'src/content/blog/2026-03-20-first.md',
            slug: 'first',
            date: '2026-03-20'
          }
        ]);
      }
      if (input.startsWith('/api/posts/read?')) {
        return Response.json({
          content: 'Body',
          frontmatter: { title: 'first', slug: 'first', date: originalDate }
        });
      }
      expect(input).toBe('/micropub');
      requests.push(JSON.parse(init!.body as string));
      return new Response(null, {
        status: 201,
        headers: { Location: 'https://blog.example/blog/first' }
      });
    });
    editor = mount(Editor, {
      target: document.body,
      props: { data: { isAuthenticated: true, siteUrl: 'https://blog.example', user: null } }
    });
    flushSync();
    const postButton = () =>
      [...document.querySelectorAll<HTMLButtonElement>('aside button')].find((button) =>
        button.textContent?.includes('first')
      )!;
    await vi.waitFor(() => expect(postButton()).toBeDefined());
    if (scenario !== 'new') {
      postButton().click();
      await vi.waitFor(() =>
        expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('first')
      );
    } else {
      for (const [selector, value] of [
        ['#title', 'first'],
        ['#content', 'Body']
      ]) {
        const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      flushSync();
    }
    const input = document.querySelector<HTMLInputElement>('#published-at')!;
    expect(input).not.toBeNull();
    let expected = originalDate;
    if (scenario === 'edited' || scenario === 'new') {
      input.value = '2026-04-05T09:30:15.123';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expected = new Date('2026-04-05T09:30:15.123').toISOString();
    } else if (scenario === 'now') {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === 'Now')!
        .click();
      flushSync();
      vi.useRealTimers();
      expected = now;
    }
    flushSync();
    if (scenario !== 'unchanged') {
      postButton().click();
      expect(confirm).toHaveBeenCalledOnce();
    }
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('main')?.textContent).toContain('successfully')
    );
    expect(requests).toEqual([
      expect.objectContaining({
        [scenario === 'new' ? 'properties' : 'replace']: expect.objectContaining({
          published: [expected]
        })
      })
    ]);
    confirm.mockClear();
    postButton().click();
    expect(confirm).not.toHaveBeenCalled();
  }
);

test.each(['loaded', 'updated', 'autosaved', 'failed', 'editing during update'])(
  'warns only about unsubmitted changes when switching posts: %s',
  async (scenario) => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    let finishUpdate!: (response: Response) => void;
    const update = new Promise<Response>((resolve) => (finishUpdate = resolve));
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input === '/micropub') {
        expect(JSON.parse(init!.body as string)).toMatchObject({
          action: 'update',
          replace: { content: ['Edited body'] }
        });
        return update;
      }
      if (input === '/api/posts') {
        return Response.json(
          ['first', 'second'].map((slug) => ({
            filename: `${slug}.md`,
            path: `src/content/blog/${slug}.md`,
            slug,
            date: '2026-03-20'
          }))
        );
      }
      const slug = input.includes('first.md') ? 'first' : 'second';
      return Response.json({
        content: 'Original body',
        frontmatter: { title: slug, slug }
      });
    });
    editor = mount(Editor, {
      target: document.body,
      props: {
        data: { isAuthenticated: true, siteUrl: 'https://blog.example', user: null }
      }
    });
    flushSync();
    const postButton = (slug: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('aside button')].find((button) =>
        button.textContent?.includes(slug)
      )!;
    await vi.waitFor(() => expect(postButton('first')).toBeDefined());
    postButton('first').click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('first')
    );
    const edit = (value: string) => {
      const content = document.querySelector<HTMLTextAreaElement>('#content')!;
      content.value = value;
      content.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    };
    if (scenario !== 'loaded') edit('Edited body');
    if (scenario === 'autosaved') {
      await vi.waitFor(() => expect(storage.size).toBe(1), { timeout: 2000 });
    } else if (scenario !== 'loaded') {
      document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      if (scenario === 'editing during update') edit('Still editing');
      finishUpdate(new Response(null, { status: scenario === 'failed' ? 500 : 204 }));
      await vi.waitFor(() =>
        expect(document.querySelector('main')?.textContent).toContain(
          scenario === 'failed' ? 'Failed to update' : 'Post updated successfully'
        )
      );
    }
    postButton('second').click();
    const shouldWarn = !['loaded', 'updated'].includes(scenario);
    expect(confirm).toHaveBeenCalledTimes(shouldWarn ? 1 : 0);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe(
        shouldWarn ? 'first' : 'second'
      )
    );
  }
);

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label
  )!;
}
function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector
  )!;
  input.value = value;
  input.dispatchEvent(
    new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
  );
  flushSync();
}
function startEditor() {
  editor = mount(Editor, {
    target: document.body,
    props: { data: { isAuthenticated: true, siteUrl: 'https://blog.example', user: null } }
  });
  flushSync();
}
function memoryStorage() {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  return storage;
}

test.each(['Article', 'Note', 'Bookmark', 'Photo'])(
  'creates and updates a %s using its Micropub properties and logs the exchange',
  async (type) => {
    memoryStorage();
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/posts') return Response.json([]);
      expect(url).toBe('/micropub');
      requests.push(JSON.parse(init!.body as string));
      return new Response(
        null,
        requests.length === 1
          ? { status: 201, headers: { Location: 'https://blog.example/blog/new-post' } }
          : { status: 204 }
      );
    });
    startEditor();
    button(type).click();
    flushSync();
    const expected: Record<string, unknown> = {
      published: ['2026-09-20T12:00:00.000Z'],
      'post-status': ['draft'],
      summary: ['Preview summary'],
      featured: ['https://example.com/cover.jpg'],
      updated: [new Date('2026-09-21T08:45:12.123').toISOString()],
      visibility: ['unlisted']
    };
    fill('#summary', 'Preview summary');
    fill('#featured', 'https://example.com/cover.jpg');
    fill('#updated-at', '2026-09-21T08:45:12.123');
    fill('#visibility', 'unlisted');
    fill(
      '#published-at',
      new Date(new Date('2026-09-20T12:00:00Z').getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, -1)
    );
    if (type === 'Article') {
      fill('#title', 'My article');
      fill('#content', 'A longer story');
      Object.assign(expected, {
        name: ['My article'],
        content: ['A longer story'],
        slug: ['my-article']
      });
    } else if (type === 'Note') {
      expect(document.querySelector('#title')).toBeNull();
      fill('#content', 'A short thought');
      expected.content = ['A short thought'];
    } else if (type === 'Bookmark') {
      fill('#bookmark', 'https://example.com/read');
      expected['bookmark-of'] = ['https://example.com/read'];
    } else {
      expect(button('Create Post').disabled).toBe(true);
      button('Add image URL').click();
      flushSync();
      fill('#photo-0', 'https://example.com/photo.jpg');
      fill('#alt-0', 'A mountain at sunrise');
      expected.photo = [{ value: 'https://example.com/photo.jpg', alt: 'A mountain at sunrise' }];
    }
    expect(document.querySelector('form')!.checkValidity()).toBe(true);
    button('Create Post').click();
    await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
    expect(requests[0]).toEqual({ type: ['h-entry'], properties: expected });
    const log = document.querySelector('[aria-label="Action log"]')!;
    expect(log.textContent).toContain('HTTP 201');
    expect(log.textContent).toContain('location: https://blog.example/blog/new-post');
    expect(log.textContent).toContain(JSON.stringify(requests[0], null, 2));
    fill('#content', 'Updated commentary');
    fill('#summary', '');
    fill('#featured', '');
    button('Clear updated time').click();
    fill('#visibility', '');
    button('Update Post').click();
    await vi.waitFor(() => expect(log.textContent).toContain('HTTP 204'));
    expect(requests[1]).toMatchObject({
      action: 'update',
      url: 'https://blog.example/blog/new-post',
      replace: {
        content: ['Updated commentary'],
        summary: [],
        featured: [],
        updated: [],
        visibility: [],
        description: [],
        ...(expected.photo ? { photo: expected.photo } : {}),
        ...(expected['bookmark-of'] ? { 'bookmark-of': expected['bookmark-of'] } : {})
      }
    });
    button('New post').click();
    flushSync();
    expect(document.querySelector<HTMLTextAreaElement>('#content')?.value).toBe('');
    expect(button('Create Post')).toBeDefined();
  }
);

test('keeps separate composers through type navigation and a reload', async () => {
  memoryStorage();
  vi.stubGlobal('fetch', async () => Response.json([]));
  startEditor();
  fill('#title', 'An unfinished article');
  fill('#content', 'Article body');
  button('Note').click();
  flushSync();
  fill('#content', 'A draft note');
  fill('#summary', 'Note summary');
  fill('#featured', 'https://example.com/cover.jpg');
  fill('#updated-at', '2026-09-21T08:45');
  fill('#visibility', 'private');
  button('Bookmark').click();
  flushSync();
  fill('#bookmark', 'https://example.com/saved');
  button('Photo').click();
  flushSync();
  button('Add image URL').click();
  flushSync();
  fill('#photo-0', 'https://example.com/photo.jpg');
  fill('#alt-0', 'A saved description');
  button('Article').click();
  flushSync();
  expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('An unfinished article');
  await unmount(editor);
  document.body.replaceChildren();
  startEditor();
  button('Note').click();
  flushSync();
  expect(document.querySelector<HTMLTextAreaElement>('#content')?.value).toBe('A draft note');
  expect(document.querySelector<HTMLInputElement>('#summary')?.value).toBe('Note summary');
  expect(document.querySelector<HTMLInputElement>('#featured')?.value).toBe(
    'https://example.com/cover.jpg'
  );
  expect(document.querySelector<HTMLInputElement>('#updated-at')?.value).toBe('2026-09-21T08:45');
  expect(document.querySelector<HTMLSelectElement>('#visibility')?.value).toBe('private');
  button('Bookmark').click();
  flushSync();
  expect(document.querySelector<HTMLInputElement>('#bookmark')?.value).toBe(
    'https://example.com/saved'
  );
  button('Photo').click();
  flushSync();
  expect(document.querySelector<HTMLInputElement>('#alt-0')?.value).toBe('A saved description');
});

test.each(['note', 'bookmark', 'photo'])(
  'loads the %s composer without generated content or a fabricated title',
  async (type) => {
    memoryStorage();
    const properties =
      type === 'bookmark'
        ? { 'bookmark-of': ['https://example.com/read'] }
        : type === 'photo'
          ? {
              photo: [
                { value: 'https://example.com/photo.jpg', alt: 'Original alt' },
                'https://example.com/second.jpg'
              ]
            }
          : { content: ['Original note'] };
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/posts')
        return Response.json([
          { path: 'src/content/blog/2026-09-20-original.md', slug: 'original', date: '2026-09-20' }
        ]);
      if (url.startsWith('/api/posts/read?'))
        return Response.json({
          frontmatter: { title: 'Untitled Post', slug: 'original', micropub: { properties } },
          content: 'Generated image or bookmark markup'
        });
      requests.push(JSON.parse(init!.body as string));
      return new Response(null, { status: 204 });
    });
    startEditor();
    await vi.waitFor(() =>
      expect(document.querySelector('aside')?.textContent).toContain('original')
    );
    [...document.querySelectorAll<HTMLButtonElement>('aside button')]
      .find((item) => item.textContent?.includes('original'))!
      .click();
    await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
    expect(document.querySelector<HTMLInputElement>('#title')?.value ?? '').toBe('');
    expect(document.querySelector<HTMLTextAreaElement>('#content')?.value).toBe(
      type === 'note' ? 'Original note' : ''
    );
    button('Update Post').click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      replace:
        type === 'photo'
          ? {
              photo: [
                { value: 'https://example.com/photo.jpg', alt: 'Original alt' },
                { value: 'https://example.com/second.jpg', alt: '' }
              ]
            }
          : properties
    });
  }
);

test('logs media upload metadata, HTTP failures, and network failures without losing the draft', async () => {
  memoryStorage();
  let attempt = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/posts') return Response.json([]);
    if (url === '/micropub/media') {
      expect((init!.body as FormData).get('file')).toBeInstanceOf(File);
      return new Response(null, {
        status: 201,
        headers: { Location: 'https://example.com/upload.jpg' }
      });
    }
    if (++attempt === 1) return Response.json({ error: 'invalid_request' }, { status: 400 });
    throw new TypeError('Connection lost');
  });
  startEditor();
  button('Photo').click();
  flushSync();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['image'], 'sunrise.jpg', { type: 'image/jpeg' })]
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#photo-0')?.value).toBe(
      'https://example.com/upload.jpg'
    )
  );
  fill('#alt-0', 'Sunrise');
  const log = document.querySelector('[aria-label="Action log"]')!;
  expect(log.textContent).toContain('sunrise.jpg (image/jpeg, 5 bytes; binary omitted)');
  button('Create Post').click();
  await vi.waitFor(() => expect(log.textContent).toContain('HTTP 400'));
  button('Create Post').click();
  await vi.waitFor(() => expect(log.textContent).toContain('Connection lost'));
  expect(document.querySelector<HTMLInputElement>('#alt-0')?.value).toBe('Sunrise');
  button('Clear log').click();
  flushSync();
  expect(log.querySelectorAll('details')).toHaveLength(0);
});

test.each(['Micropub', 'legacy'])(
  'loads %s metadata and preserves it when updating',
  async (format) => {
    memoryStorage();
    const updated = '2026-09-21T08:45:12.123Z';
    const metadata = {
      summary: ['Saved summary'],
      featured: ['https://example.com/cover.jpg'],
      updated: [updated],
      visibility: ['private']
    };
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/posts')
        return Response.json([
          { path: 'src/content/blog/2026-09-20-saved.md', slug: 'saved', date: '2026-09-20' }
        ]);
      if (url.startsWith('/api/posts/read?'))
        return Response.json({
          content: 'Body',
          frontmatter: {
            title: 'Saved article',
            slug: 'saved',
            description: format === 'legacy' ? 'Saved summary' : 'Stale description',
            image: 'https://example.com/cover.jpg',
            updated,
            visibility: 'private',
            ...(format === 'Micropub'
              ? {
                  micropub: {
                    properties: { name: ['Saved article'], content: ['Body'], ...metadata }
                  }
                }
              : {})
          }
        });
      requests.push(JSON.parse(init!.body as string));
      return new Response(null, { status: 204 });
    });
    startEditor();
    await vi.waitFor(() => expect(document.querySelector('aside')?.textContent).toContain('saved'));
    [...document.querySelectorAll<HTMLButtonElement>('aside button')]
      .find((item) => item.textContent?.includes('saved'))!
      .click();
    await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
    expect(document.querySelector<HTMLInputElement>('#summary')?.value).toBe('Saved summary');
    expect(document.querySelector<HTMLInputElement>('#featured')?.value).toBe(
      'https://example.com/cover.jpg'
    );
    expect(
      new Date(document.querySelector<HTMLInputElement>('#updated-at')!.value).toISOString()
    ).toBe(updated);
    expect(document.querySelector<HTMLSelectElement>('#visibility')?.value).toBe('private');
    button('Update Post').click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ replace: { ...metadata, description: [] } });
  }
);

test.each([
  { name: 'A heading', content: 'A different opening', expected: 'Article' },
  { name: 'A heading', content: '**A heading** and more', expected: 'Note' },
  { name: '<b>A heading</b>', content: { html: '<p>A heading and more</p>' }, expected: 'Note' },
  { name: 'A heading', content: { text: 'A different opening' }, expected: 'Article' },
  { name: 'A heading', content: '', expected: 'Note' },
  { name: '  ', content: 'A thought', expected: 'Note' }
])('matches blog type inference for $expected: $content', async ({ name, content, expected }) => {
  memoryStorage();
  vi.stubGlobal('fetch', async (url: string) =>
    url === '/api/posts'
      ? Response.json([
          { path: 'src/content/blog/2026-09-20-saved.md', slug: 'saved', date: '2026-09-20' }
        ])
      : Response.json({
          content: 'Fallback body',
          frontmatter: {
            slug: 'saved',
            micropub: { properties: { name: [name], content: [content] } }
          }
        })
  );
  startEditor();
  await vi.waitFor(() => expect(document.querySelector('aside')?.textContent).toContain('saved'));
  [...document.querySelectorAll<HTMLButtonElement>('aside button')]
    .find((item) => item.textContent?.includes('saved'))!
    .click();
  await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
  expect(button(expected).getAttribute('aria-pressed')).toBe('true');
});

test('restores an old local draft description as summary and sets updated time explicitly', async () => {
  const storage = memoryStorage();
  storage.set(
    'blog-editor-draft',
    JSON.stringify({
      title: 'Old draft',
      content: 'Body',
      slug: 'old-draft',
      description: 'Legacy description',
      categories: '',
      published: false,
      autoSlug: true,
      currentPath: '',
      savedAt: new Date().toISOString()
    })
  );
  vi.stubGlobal('fetch', async () => Response.json([]));
  startEditor();
  expect(document.querySelector<HTMLInputElement>('#summary')?.value).toBe('Legacy description');
  expect(document.querySelector<HTMLInputElement>('#updated-at')?.value).toBe('');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-22T10:00:01.123Z'));
  button('Set updated to now').click();
  flushSync();
  expect(
    new Date(document.querySelector<HTMLInputElement>('#updated-at')!.value).toISOString()
  ).toBe('2026-09-22T10:00:01.123Z');
});
