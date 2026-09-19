// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, json, type RequestEvent } from '@sveltejs/kit';
// @ts-expect-error SvelteKit exports this test context helper without public types.
import { with_request_store } from '@sveltejs/kit/internal/server';
import { handle } from './hooks.server';
import { GET, POST } from './routes/micropub/+server';
import { POST as upload } from './routes/micropub/media/+server';
import { setSession } from '$lib/server/auth';
import { clearAllTokens, storeAccessToken } from '$lib/server/token-store';

const publisher = 'https://publisher.example.com';
const client = 'https://micropub.rocks';
let token: string;

beforeEach(() => {
  clearAllTokens();
  token = storeAccessToken('fake-github-token', 'https://example.com/', 'create');
});

// Exercise the hook chain and real handlers. Only environment and storage are
// configured for testing; no parser, authentication, or handler is mocked.
async function request(path: string, init: RequestInit, session = false) {
  const cookies = new Map<string, string>();
  const event = {
    request: new Request(`${publisher}${path}`, init),
    url: new URL(`${publisher}${path}`),
    locals: {},
    cookies: {
      get: (name: string) => cookies.get(name),
      set: (name: string, value: string) => cookies.set(name, value)
    }
  } as unknown as RequestEvent;
  if (session) await setSession(event, { githubToken: 'fake-session-token' });

  const resolve = vi.fn(async (event: RequestEvent) => {
    try {
      if (event.url.pathname === '/micropub') {
        const handler = event.request.method === 'GET' ? GET : POST;
        return await handler(event as Parameters<typeof POST>[0]);
      }
      if (event.url.pathname === '/micropub/media') {
        return await upload(event as Parameters<typeof upload>[0]);
      }
      return new Response('Editor');
    } catch (err) {
      if (isHttpError(err)) return json(err.body, { status: err.status });
      throw err;
    }
  });
  // sequence() expects the request context normally supplied by SvelteKit.
  const store = {
    event,
    state: { tracing: { record_span: ({ fn }: { fn: () => Promise<Response> }) => fn() } }
  } as unknown as Parameters<typeof with_request_store>[0];
  return {
    response: await with_request_store(store, () => handle({ event, resolve })),
    resolve
  };
}

describe('Micropub transport through server hooks', () => {
  // micropub.rocks server cases 100, 800, and 801.
  it.each(['header', 'body'])('accepts a form post with a token in the %s', async (where) => {
    const body = new URLSearchParams({ h: 'entry', content: 'Hello from a client' });
    const headers: Record<string, string> = { Origin: client };
    if (where === 'header') headers.Authorization = `Bearer ${token}`;
    else body.set('access_token', token);
    const { response } = await request('/micropub', { method: 'POST', headers, body });
    expect(response.status).toBe(201);
    expect(response.headers.get('Location')).toBe('https://example.com/blog/untitled-post');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Location');
  });

  it('accepts a native client without an Origin header', async () => {
    const { response } = await request('/micropub', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: new URLSearchParams({ h: 'entry', content: 'Native client' })
    });
    expect(response.status).toBe(201);
  });

  // micropub.rocks server cases 700–702.
  it.each(['jpeg', 'png', 'gif'])('accepts a cross-origin %s upload', async (format) => {
    const body = new FormData();
    body.set('file', new File(['image bytes'], `photo.${format}`, { type: `image/${format}` }));
    const { response } = await request('/micropub/media', {
      method: 'POST',
      headers: { Origin: client, Authorization: `Bearer ${token}` },
      body
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('Location')).toBe(`/test-images/photo.${format}`);
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Location');
  });

  it.each(['/micropub', '/micropub/media'])('answers browser preflight for %s', async (path) => {
    const { response, resolve } = await request(path, {
      method: 'OPTIONS',
      headers: {
        Origin: client,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type'
      }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization'
    );
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('makes the configuration query readable by browser clients (600)', async () => {
    const { response } = await request('/micropub?q=config', {
      headers: { Origin: client, Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({
      'media-endpoint': `${publisher}/micropub/media`,
      'syndicate-to': []
    });
  });

  it.each([undefined, 'Bearer invalid'])(
    'rejects missing/invalid tokens (803/804)',
    async (auth) => {
      const headers: Record<string, string> = { Origin: client };
      if (auth) headers.Authorization = auth;
      const { response } = await request('/micropub', {
        method: 'POST',
        headers,
        body: new URLSearchParams({ h: 'entry', content: 'Unauthorized' })
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
  );

  it.each([client, 'null', undefined])(
    'does not use session cookies with Origin %s',
    async (origin) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (origin) headers.Origin = origin;
      const { response } = await request(
        '/micropub',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ type: ['h-entry'], properties: { content: ['Forged post'] } })
        },
        true
      );
      expect(response.status).toBe(401);
    }
  );

  it('does not use session cookies for cross-origin media uploads', async () => {
    const body = new FormData();
    body.set('file', new File(['image bytes'], 'photo.png', { type: 'image/png' }));
    const { response } = await request(
      '/micropub/media',
      {
        method: 'POST',
        headers: { Origin: client },
        body
      },
      true
    );
    expect(response.status).toBe(401);
  });

  it('preserves session authentication for the same-origin editor', async () => {
    const { response } = await request(
      '/micropub',
      {
        method: 'POST',
        headers: { Origin: publisher },
        body: new URLSearchParams({ h: 'entry', content: 'Editor post' })
      },
      true
    );
    expect(response.status).toBe(201);
  });

  it('keeps CSRF protection on other routes', async () => {
    const { response, resolve } = await request(
      '/editor',
      {
        method: 'POST',
        headers: { Origin: client },
        body: new URLSearchParams({ content: 'Forged' })
      },
      true
    );
    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });
});
