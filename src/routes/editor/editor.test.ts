import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Editor from './+page.svelte';
import matter from 'gray-matter';
import { TestStorageBackend } from '$lib/server/storage/test';
import { mutatePost } from '$lib/server/micropub-posts';
import { env } from '$env/dynamic/public';

vi.mock('$app/environment', () => ({ browser: true, dev: true, building: false }));

let editor: ReturnType<typeof mount>;
afterEach(async () => {
  if (editor) await unmount(editor);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  env.PUBLIC_SITE_URL = 'https://example.com';
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
    expect(document.querySelector<HTMLTextAreaElement>('#content')?.value).toBe(
      original ?? content
    );
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
        headers: { Location: 'https://blog.example/2026/03/20/first' }
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
      // The latest post opens automatically; start a new one instead.
      await vi.waitFor(() =>
        expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('first')
      );
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === 'New post')!
        .click();
      flushSync();
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
    expect(requests).toHaveLength(1);
    const sent = requests[0][scenario === 'new' ? 'properties' : 'replace'];
    if (scenario === 'unchanged') expect(sent).not.toHaveProperty('published');
    else expect(sent).toMatchObject({ published: [expected] });
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

function dropFiles(files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  document.querySelector('#content')!.dispatchEvent(event);
  flushSync();
  return event;
}

function mockImageUrls() {
  const NativeURL = URL;
  const revoke = vi.fn();
  let count = 0;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = () => `blob:preview-${++count}`;
      static revokeObjectURL = revoke;
    }
  );
  return revoke;
}

test('drops images at the selection and displays them in the editor and preview', async () => {
  memoryStorage();
  const urls = ['https://example.com/first.png', 'https://example.com/second.png'];
  let uploads = 0;
  const revoke = mockImageUrls();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/posts') return Response.json([]);
    expect(url).toBe('/micropub/media');
    expect((init!.body as FormData).get('file')).toBeInstanceOf(File);
    return new Response(null, { status: 201, headers: { Location: urls[uploads++] } });
  });
  startEditor();
  fill('#content', 'Before replace after');
  const textarea = document.querySelector<HTMLTextAreaElement>('#content')!;
  textarea.setSelectionRange(7, 14);
  const event = dropFiles([
    new File(['one'], 'first.png', { type: 'image/png' }),
    new File(['two'], 'second.png', { type: 'image/png' })
  ]);
  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(uploads).toBe(2));
  await vi.waitFor(() =>
    expect(textarea.value).toBe(
      'Before ![first.png](https://example.com/first.png)\n\n![second.png](https://example.com/second.png) after'
    )
  );
  const images = document.querySelector('[aria-label="Content images"]')!;
  expect([...images.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
    'blob:preview-1',
    'blob:preview-2'
  ]);
  button('Preview').click();
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Post preview"] img')?.getAttribute('src')).toBe(
      'blob:preview-1'
    )
  );
  expect(
    [...document.querySelectorAll<HTMLImageElement>('[aria-label="Post preview"] img')].map(
      (image) => image.alt
    )
  ).toEqual(['first.png', 'second.png']);
  await unmount(editor);
  editor = undefined as unknown as typeof editor;
  expect(revoke.mock.calls).toEqual([['blob:preview-1'], ['blob:preview-2']]);
});

test.each(['rejected', 'missing Location'])(
  'keeps the text when a dropped upload is %s',
  async (failure) => {
    memoryStorage();
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/api/posts'
        ? Response.json([])
        : failure === 'rejected'
          ? Response.json({ message: 'Failed to upload image' }, { status: 500 })
          : new Response(null, { status: 201 })
    );
    startEditor();
    fill('#content', 'Keep my draft');
    dropFiles([new File(['image'], 'photo.png', { type: 'image/png' })]);
    await vi.waitFor(() => expect(document.body.textContent).toContain('Failed to upload image'));
    expect(document.querySelector<HTMLTextAreaElement>('#content')!.value).toBe('Keep my draft');
    expect(document.querySelector('[aria-label="Content images"]')).toBeNull();
  }
);

test('keeps edits made while a dropped image uploads and escapes its Markdown alt text', async () => {
  memoryStorage();
  mockImageUrls();
  let finishUpload!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string) =>
    url === '/api/posts'
      ? Response.json([])
      : new Promise<Response>((resolve) => {
          finishUpload = resolve;
        })
  );
  startEditor();
  fill('#content', 'Original');
  dropFiles([new File(['image'], 'a [photo].png', { type: 'image/png' })]);
  expect(button('Create Post').disabled).toBe(true);
  fill('#content', 'Original with more text');
  const textarea = document.querySelector<HTMLTextAreaElement>('#content')!;
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  finishUpload(
    new Response(null, { status: 201, headers: { Location: 'https://example.com/photo.png' } })
  );
  await vi.waitFor(() =>
    expect(textarea.value).toBe(
      'Original with more text![a \\[photo\\].png](https://example.com/photo.png)'
    )
  );
  button('Preview').click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLImageElement>('[aria-label="Post preview"] img')?.alt).toBe(
      'a [photo].png'
    )
  );
});

test('inserts a selected image at the caret and renders saved Markdown images after reload', async () => {
  memoryStorage();
  mockImageUrls();
  vi.stubGlobal('fetch', async (url: string) =>
    url === '/api/posts'
      ? Response.json([])
      : new Response(null, { status: 201, headers: { Location: 'https://example.com/photo.png' } })
  );
  startEditor();
  fill('#content', 'Before after');
  const textarea = document.querySelector<HTMLTextAreaElement>('#content')!;
  textarea.setSelectionRange(7, 7);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['image'], 'photo.png', { type: 'image/png' })]
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect(textarea.value).toBe('Before ![photo.png](https://example.com/photo.png)after')
  );
  await vi.waitFor(() => expect(localStorage.getItem('blog-editor-draft')).not.toBeNull(), {
    timeout: 2000
  });
  await unmount(editor);
  document.body.replaceChildren();
  startEditor();
  expect(document.querySelector('[aria-label="Content images"] img')?.getAttribute('src')).toBe(
    'https://example.com/photo.png'
  );
  button('Preview').click();
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Post preview"] img')?.getAttribute('src')).toBe(
      'https://example.com/photo.png'
    )
  );
});

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
          ? { status: 201, headers: { Location: 'https://blog.example/2026/09/20/new-post' } }
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
    expect(log.textContent).toContain('location: https://blog.example/2026/09/20/new-post');
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
      url: 'https://blog.example/2026/09/20/new-post',
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
  mockImageUrls();
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

test('follows a post to its new permalink when an update moves it', async () => {
  memoryStorage();
  const requests: Record<string, unknown>[] = [];
  const locations = [
    'https://blog.example/2026/09/20/draft-name',
    'https://blog.example/2026/09/20/final-name'
  ];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/posts') return Response.json([]);
    requests.push(JSON.parse(init!.body as string));
    return requests.length <= 2
      ? new Response(null, { status: 201, headers: { Location: locations[requests.length - 1] } })
      : new Response(null, { status: 204 });
  });
  startEditor();
  button('Article').click();
  flushSync();
  fill('#title', 'Draft name');
  fill('#content', 'Body');
  button('Create Post').click();
  await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
  fill('#slug', 'final-name');
  button('Update Post').click();
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({ action: 'update', url: locations[0] });
  await vi.waitFor(() => expect(document.body.textContent).toContain(locations[1]));
  button('Update Post').click();
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]).toMatchObject({ action: 'update', url: locations[1] });
});

test.each(['loaded', 'normalized input', 'draft reload', 'old draft'])(
  'keeps a legacy date-only permalink through an editor content edit: %s',
  async (scenario) => {
    env.PUBLIC_SITE_URL = 'https://blog.example';
    const storage = memoryStorage();
    const backend = new TestStorageBackend();
    const path = 'src/content/blog/2025-12-19-legacy.md';
    await backend.createOrUpdateFile(
      path,
      '---\ntitle: Legacy\ndate: 2025-12-19\nslug: legacy\npublished: true\n---\nOriginal body\n',
      'Seed'
    );
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/posts') return Response.json(await backend.listBlogPosts());
      if (url.startsWith('/api/posts/read?')) {
        const { data: frontmatter, content } = matter(await backend.readFile(path));
        // Match the real API's YAML Date -> JSON timestamp round trip.
        return Response.json({ frontmatter, content });
      }
      const payload = JSON.parse(init!.body as string);
      requests.push(payload);
      const moved = await mutatePost(backend, payload);
      return new Response(
        null,
        moved ? { status: 201, headers: { Location: moved } } : { status: 204 }
      );
    });
    startEditor();
    await vi.waitFor(() =>
      expect(document.querySelector('aside')?.textContent).toContain('legacy')
    );
    [...document.querySelectorAll<HTMLButtonElement>('aside button')]
      .find((item) => item.textContent?.includes('legacy'))!
      .click();
    await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
    fill('#content', 'Edited body');
    if (scenario === 'normalized input')
      fill('#published-at', document.querySelector<HTMLInputElement>('#published-at')!.value);
    if (scenario === 'draft reload' || scenario === 'old draft') {
      await vi.waitFor(() => expect(storage.has('blog-editor-draft')).toBe(true), {
        timeout: 2000
      });
      if (scenario === 'old draft') {
        const draft = JSON.parse(storage.get('blog-editor-draft')!);
        delete draft.savedPublishedAt;
        storage.set('blog-editor-draft', JSON.stringify(draft));
      }
      await unmount(editor);
      document.body.replaceChildren();
      startEditor();
    }
    button('Update Post').click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Post updated successfully!')
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].replace).not.toHaveProperty('published');
    expect([...backend.getAllFiles().keys()]).toEqual([path]);
    expect(matter(await backend.readFile(path)).data.date).toBe('2025-12-19');
    expect(matter(await backend.readFile(path)).content.trim()).toBe('Edited body');
  }
);

test.each(['2025-12-19T00:00:00.000Z', '2026-11-01T09:30:00.000Z'])(
  'preserves an unchanged exact publication instant: %s',
  async (date) => {
    memoryStorage();
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/posts')
        return Response.json([
          { path: 'src/content/blog/2025-12-18-exact.md', slug: 'exact', date: '2025-12-18' }
        ]);
      if (url.startsWith('/api/posts/read?'))
        return Response.json({
          content: 'Body',
          frontmatter: { title: 'Exact', slug: 'exact', date }
        });
      requests.push(JSON.parse(init!.body as string));
      return new Response(null, { status: 204 });
    });
    startEditor();
    await vi.waitFor(() => expect(document.querySelector('aside')?.textContent).toContain('exact'));
    [...document.querySelectorAll<HTMLButtonElement>('aside button')]
      .find((item) => item.textContent?.includes('exact'))!
      .click();
    await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
    fill('#content', 'Edited');
    button('Update Post').click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].replace).not.toHaveProperty('published');
  }
);

test.each(['no draft', 'local draft', 'typing first'])(
  'opens the latest post unless the writer already has work: %s',
  async (scenario) => {
    const storage = memoryStorage();
    if (scenario === 'local draft') {
      storage.set(
        'blog-editor-draft',
        JSON.stringify({
          postType: 'note',
          title: '',
          content: 'A local note',
          slug: '',
          categories: '',
          published: false,
          autoSlug: true,
          savedAt: new Date().toISOString(),
          currentPath: ''
        })
      );
    }
    let finishList!: () => void;
    const listed = new Promise<void>((resolve) => (finishList = resolve));
    const reads: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === '/api/posts') {
        await listed;
        return Response.json(
          ['2026-10-04-latest', '2026-09-30-older'].map((name) => ({
            filename: `${name}.md`,
            path: `src/content/blog/${name}.md`,
            slug: name.slice(11),
            date: name.slice(0, 10)
          }))
        );
      }
      reads.push(url);
      return Response.json({
        content: 'Body of the latest post',
        frontmatter: { title: 'Latest', slug: 'latest', date: '2026-10-04T12:00:00Z' }
      });
    });
    startEditor();
    if (scenario === 'typing first') fill('#content', 'Started before the list');
    finishList();
    await vi.waitFor(() => expect(document.querySelector('aside')?.textContent).toContain('older'));
    if (scenario === 'no draft') {
      await vi.waitFor(() => expect(button('Update Post')).toBeDefined());
      expect(reads).toEqual(['/api/posts/read?path=src%2Fcontent%2Fblog%2F2026-10-04-latest.md']);
      expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('Latest');
      expect(document.querySelector<HTMLTextAreaElement>('#content')?.value).toBe(
        'Body of the latest post'
      );
    } else {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(reads).toEqual([]);
      expect(button('Create Post')).toBeDefined();
      expect(document.querySelector<HTMLTextAreaElement>('#content')?.value).toBe(
        scenario === 'local draft' ? 'A local note' : 'Started before the list'
      );
    }
  }
);

test('opens posts from the menu drawer and closes it after a choice or Escape', async () => {
  memoryStorage();
  vi.stubGlobal('fetch', async (url: string) =>
    url === '/api/posts'
      ? Response.json([
          { path: 'src/content/blog/2026-10-04-latest.md', slug: 'latest', date: '2026-10-04' },
          { path: 'src/content/blog/2026-09-30-older.md', slug: 'older', date: '2026-09-30' }
        ])
      : Response.json({
          content: 'A body',
          frontmatter: { title: url.includes('older') ? 'Older' : 'Latest' }
        })
  );
  startEditor();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('Latest')
  );
  const menu = document.querySelector<HTMLButtonElement>('[aria-controls="post-drawer"]')!;
  const drawer = document.querySelector('aside')!;
  expect(menu.getAttribute('aria-expanded')).toBe('false');
  expect(drawer.inert).toBe(true);

  menu.click();
  flushSync();
  expect(menu.getAttribute('aria-expanded')).toBe('true');
  expect(drawer.inert).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  flushSync();
  expect(menu.getAttribute('aria-expanded')).toBe('false');

  menu.click();
  flushSync();
  [...drawer.querySelectorAll('button')]
    .find((item) => item.textContent?.includes('older'))!
    .click();
  flushSync();
  expect(menu.getAttribute('aria-expanded')).toBe('false');
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#title')?.value).toBe('Older')
  );
});

test('switches between editing and preview with Ctrl or Command E', async () => {
  memoryStorage();
  vi.stubGlobal('fetch', async () => Response.json([]));
  startEditor();
  fill('#content', '# Heading');
  const toggle = (init: KeyboardEventInit) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', cancelable: true, ...init }));
    flushSync();
  };
  toggle({ ctrlKey: true });
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Post preview"] h1')?.textContent).toBe('Heading')
  );
  expect(document.querySelector('#content')).toBeNull();
  expect(button('Preview').getAttribute('aria-pressed')).toBe('true');
  toggle({ metaKey: true });
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('content'));
  toggle({ ctrlKey: true, shiftKey: true });
  expect(document.querySelector('#content')).not.toBeNull();
});

test('opens collapsed post details when one of their fields is invalid', async () => {
  memoryStorage();
  vi.stubGlobal('fetch', async () => Response.json([]));
  startEditor();
  fill('#title', 'Title');
  fill('#content', 'Body');
  const details = document.querySelector<HTMLElement>('#post-details')!;
  expect(details.hidden).toBe(true);
  fill('#featured', 'not a url');
  expect(document.querySelector('form')!.checkValidity()).toBe(false);
  flushSync();
  expect(details.hidden).toBe(false);
});
