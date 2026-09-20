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
