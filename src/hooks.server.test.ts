// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect, json, type RequestEvent } from '@sveltejs/kit';
// @ts-expect-error SvelteKit exports this test context helper without public types.
import { with_request_store } from '@sveltejs/kit/internal/server';
import { env } from '$env/dynamic/private';
import { GET as authorize } from './routes/auth/indieauth/authorize/+server';
import { GET as callback } from './routes/auth/github/callback/+server';
import { POST as exchange } from './routes/auth/indieauth/token/+server';
import { handle } from './hooks.server';
import { GET, POST } from './routes/micropub/+server';
import { POST as upload } from './routes/micropub/media/+server';
import { setSession } from '$lib/server/auth';
import { clearAllTokens, storeAccessToken } from '$lib/server/token-store';

// Fake GitHub at the external API boundary; keep the storage implementation real.
const githubWrites = vi.hoisted(() => new Map<string, string>());
vi.mock('@octokit/rest', () => ({
  Octokit: class {
    users = {
      getAuthenticated: async () => ({
        data: { id: 1, login: 'test_owner', name: 'Test', avatar_url: '' }
      })
    };
    repos = {
      get: async () => ({ data: { owner: { login: 'test_owner' } } }),
      getContent: async () => {
        throw Object.assign(new Error('Not found'), { status: 404 });
      },
      createOrUpdateFileContents: async ({ path, content }: { path: string; content: string }) => {
        githubWrites.set(path, content);
        return { data: {} };
      }
    };
  }
}));

const publisher = 'https://publisher.example.com';
const client = 'https://micropub.rocks';
let token: string;

beforeEach(() => {
  clearAllTokens();
  githubWrites.clear();
  env.MICROPUB_BACKEND = 'test';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected external request');
    })
  );
  token = storeAccessToken('fake-github-token', 'https://example.com/', 'create');
});

afterEach(() => vi.unstubAllGlobals());

// Exercise the hook chain and real handlers. Only environment and storage are
// configured for testing; no parser, authentication, or handler is mocked.
async function request(
  path: string,
  init: RequestInit,
  session: boolean | Map<string, string> = false
) {
  const cookies = session instanceof Map ? session : new Map<string, string>();
  const event = {
    request: new Request(`${publisher}${path}`, init),
    url: new URL(`${publisher}${path}`),
    locals: {},
    cookies: {
      get: (name: string) => cookies.get(name),
      set: (name: string, value: string) => cookies.set(name, value)
    }
  } as unknown as RequestEvent;
  if (session === true) await setSession(event, { githubToken: 'fake-session-token' });

  const resolve = vi.fn(async (event: RequestEvent) => {
    try {
      if (event.url.pathname === '/auth/indieauth/authorize')
        return await authorize(event as Parameters<typeof authorize>[0]);
      if (event.url.pathname === '/auth/github/callback')
        return await callback(event as Parameters<typeof callback>[0]);
      if (event.url.pathname === '/auth/indieauth/token')
        return await exchange(event as Parameters<typeof exchange>[0]);
      if (event.url.pathname === '/micropub') {
        const handler = event.request.method === 'GET' ? GET : POST;
        return await handler(event as Parameters<typeof POST>[0]);
      }
      if (event.url.pathname === '/micropub/media') {
        return await upload(event as Parameters<typeof upload>[0]);
      }
      return new Response('Editor');
    } catch (err) {
      if (isRedirect(err))
        return new Response(null, { status: err.status, headers: { Location: err.location } });
      if (isHttpError(err)) return json(err.body, { status: err.status });
      throw err;
    }
  });
  // sequence() expects the request context normally supplied by SvelteKit.
  const store = {
    event,
    state: { tracing: { record_span: ({ fn }: { fn: () => Promise<Response> }) => fn() } }
  } as unknown as Parameters<typeof with_request_store>[0];
  const writesBefore = new Map(githubWrites);
  const response = await with_request_store(store, () => handle({ event, resolve }));
  if (response.status >= 400) expect(githubWrites).toEqual(writesBefore);
  return { response, resolve, cookies };
}

describe('Micropub authorization and actions', () => {
  beforeEach(() => {
    env.MICROPUB_BACKEND = 'github';
  });
  it.each(['', 'update', 'delete', 'recreate'])('rejects create with scope %j', async (scope) => {
    const restricted = storeAccessToken('fake-github-token', 'https://example.com/', scope);
    for (const where of ['header', 'body', 'query']) {
      const body = new URLSearchParams({ h: 'entry', content: 'Must not publish' });
      const headers: Record<string, string> = { Origin: client };
      if (where === 'header') headers.Authorization = `Bearer ${restricted}`;
      if (where === 'body') body.set('access_token', restricted);
      const path = where === 'query' ? `/micropub?access_token=${restricted}` : '/micropub';
      const { response } = await request(path, { method: 'POST', headers, body });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'insufficient_scope', scope: 'create' });
    }
  });

  it.each(['update', 'delete', 'undelete', 'unknown', '', null, ['delete']])(
    'rejects explicit action %j instead of creating a post',
    async (action) => {
      const bodies = [JSON.stringify({ action, content: 'Must not publish' })];
      if (typeof action === 'string') bodies.push(new URLSearchParams({ action }).toString());
      for (const [index, body] of bodies.entries()) {
        const { response } = await request('/micropub', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': index === 0 ? 'application/json' : 'application/x-www-form-urlencoded'
          },
          body
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'invalid_request' });
      }
    }
  );

  it('does not let a session or body token override a restricted header token', async () => {
    const restricted = storeAccessToken('fake-github-token', 'https://example.com/', 'update');
    const { response } = await request(
      '/micropub',
      {
        method: 'POST',
        headers: { Origin: publisher, Authorization: `Bearer ${restricted}` },
        body: new URLSearchParams({ h: 'entry', content: 'No escalation', access_token: token })
      },
      true
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
  });

  it('does not fall back from an invalid header token to the editor session', async () => {
    const { response } = await request(
      '/micropub',
      {
        method: 'POST',
        headers: { Origin: publisher, Authorization: 'Bearer invalid' },
        body: new URLSearchParams({ h: 'entry', content: 'No fallback', access_token: token })
      },
      true
    );
    expect(response.status).toBe(400);
  });

  it.each(['null', '[]', '"not an object"', '{'])('rejects malformed JSON %s', async (body) => {
    const { response } = await request('/micropub', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a form array action even for the editor session', async () => {
    const { response } = await request(
      '/micropub',
      {
        method: 'POST',
        headers: { Origin: publisher },
        body: new URLSearchParams({ 'action[]': 'delete' })
      },
      true
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it.each(['missing', 'text', 'non-image'])(
    'preserves media validation errors for %s files',
    async (kind) => {
      const body = new FormData();
      body.set('access_token', token);
      if (kind === 'text') body.set('file', 'not a file');
      if (kind === 'non-image')
        body.set('file', new File(['text'], 'text.txt', { type: 'text/plain' }));
      const { response } = await request('/micropub/media', { method: 'POST', body });
      expect(response.status).toBe(kind === 'non-image' ? 415 : 400);
    }
  );

  it.each([null, {}, [], ''])(
    'does not fall back from malformed body token %j to a session',
    async (access_token) => {
      const { response } = await request(
        '/micropub',
        {
          method: 'POST',
          headers: { Origin: publisher, 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token, content: 'Must not publish' })
        },
        true
      );
      expect(response.status).toBe(401);
    }
  );

  it('allows configuration queries without create scope', async () => {
    const restricted = storeAccessToken('fake-github-token', 'https://example.com/', '');
    const { response } = await request('/micropub?q=config', {
      headers: { Authorization: `Bearer ${restricted}` }
    });
    expect(response.status).toBe(200);
  });

  it('requires create scope for media uploads', async () => {
    const restricted = storeAccessToken('fake-github-token', 'https://example.com/', 'update');
    const body = new FormData();
    body.set('file', new File(['image bytes'], 'photo.png', { type: 'image/png' }));
    const { response } = await request('/micropub/media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${restricted}` },
      body
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'insufficient_scope', scope: 'create' });
  });

  it('accepts a media access token in the request body', async () => {
    const body = new FormData();
    body.set('access_token', token);
    body.set('file', new File(['image bytes'], 'photo.png', { type: 'image/png' }));
    const { response } = await request('/micropub/media', { method: 'POST', body });
    expect(response.status).toBe(201);
  });
});

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

describe('Requested scope survives authorization and token exchange', () => {
  it.each([
    ['create', 'create'],
    ['create update delete', 'create'],
    ['update', ''],
    ['', ''],
    ['recreate', '']
  ])('requests %j and grants %j', async (requested, granted) => {
    env.MICROPUB_BACKEND = 'github';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url !== 'https://github.com/login/oauth/access_token')
          throw new Error('Unexpected external request');
        return Response.json({ access_token: 'fake-github-token' });
      })
    );
    const params = new URLSearchParams({
      me: 'https://example.com/',
      client_id: client,
      redirect_uri: `${client}/callback`,
      state: 'client-state'
    });
    if (requested) params.set('scope', requested);
    const authorization = await request(`/auth/indieauth/authorize?${params}`, {});
    expect(authorization.response.status).toBe(302);
    const githubUrl = new URL(authorization.response.headers.get('Location')!);
    const callbackParams = new URLSearchParams({
      code: 'fake-oauth-code',
      state: githubUrl.searchParams.get('state')!
    });
    const authorized = await request(
      `/auth/github/callback?${callbackParams}`,
      {},
      authorization.cookies
    );
    expect(authorized.response.status).toBe(302);
    const clientUrl = new URL(authorized.response.headers.get('Location')!);
    const exchanged = await request('/auth/indieauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: clientUrl.searchParams.get('code')!,
        client_id: client,
        redirect_uri: `${client}/callback`,
        scope: 'create update delete'
      })
    });
    expect(exchanged.response.status).toBe(200);
    const result = await exchanged.response.json();
    expect(result.scope).toBe(granted);
    const published = await request('/micropub', {
      method: 'POST',
      headers: { Authorization: `Bearer ${result.access_token}` },
      body: new URLSearchParams({ h: 'entry', content: 'Authorized post' })
    });
    expect(published.response.status).toBe(granted === 'create' ? 201 : 401);
    expect(githubWrites.size).toBe(granted === 'create' ? 1 : 0);
  });
});
