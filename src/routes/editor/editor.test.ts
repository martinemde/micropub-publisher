import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Editor from './+page.svelte';

vi.mock('$app/environment', () => ({ browser: true, dev: true, building: false }));

let editor: ReturnType<typeof mount>;
afterEach(async () => {
  if (editor) await unmount(editor);
  document.body.replaceChildren();
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
    const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data });
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
          categories: ['ruby', 'web'],
          ...(original ? { micropub: { properties: { content: [original] } } } : {})
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
    expect(document.querySelector<HTMLInputElement>('#description')?.value).toBe('A description');
    expect(document.querySelector<HTMLInputElement>('#categories')?.value).toBe('ruby, web');
    const published = [...document.querySelectorAll('label')].find((label) =>
      label.textContent?.includes('Published')
    );
    expect(published?.querySelector('input')?.checked).toBe(true);
    expect(document.querySelector('textarea')?.value).toBe(original ?? content);
    expect(document.querySelector('main')?.textContent).not.toContain('Failed to load post');
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
