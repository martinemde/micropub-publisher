import { test, expect } from 'bun:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sealData, unsealData } from 'iron-session';

test('Worker authentication, refresh, replay protection, and logout survive restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'publisher-worker-'));
  const origin = 'https://publisher.example';
  const password = 'cloudflare-test-session-secret-not-real-123456';
  let exchanges = 0;
  const unexpected = [];
  const options = {
    name: 'micropub-publisher',
    modules: true,
    scriptPath: resolve('.wrangler/dry-run/_worker.js'),
    compatibilityDate: '2026-09-20',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PUBLISHER: { className: 'Publisher', useSQLite: true } },
    resourcePersistencePath: directory,
    cf: false,
    bindings: {
      PUBLIC_APP_URL: origin,
      PUBLIC_SITE_URL: 'https://blog.example',
      SESSION_SECRET: password,
      GITHUB_CLIENT_ID: 'test-client',
      GITHUB_CLIENT_SECRET: 'test-secret',
      GITHUB_OWNER: 'tester',
      GITHUB_REPO: 'blog',
      MICROPUB_BACKEND: 'github',
      PUBLISHER_RUNTIME: 'cloudflare'
    },
    assets: {
      directory: resolve('.svelte-kit/cloudflare'),
      binding: 'ASSETS',
      routerConfig: { has_user_worker: true }
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.href === 'https://github.com/login/oauth/access_token') {
        const body = await request.json();
        exchanges++;
        if (exchanges === 1) {
          expect(body.code_verifier).toBeTruthy();
          return Response.json({
            access_token: 'ghu_initial',
            expires_in: 1,
            refresh_token: 'ghr_initial',
            refresh_token_expires_in: 3600
          });
        }
        expect(body.grant_type).toBe('refresh_token');
        expect(body.refresh_token).toBe('ghr_initial');
        return Response.json({
          access_token: 'ghu_rotated',
          expires_in: 3600,
          refresh_token: 'ghr_rotated',
          refresh_token_expires_in: 7200
        });
      }
      if (url.origin === 'https://api.github.com') {
        expect(request.headers.get('authorization')).toBe('token ghu_rotated');
        if (url.pathname === '/user')
          return Response.json({ id: 1, login: 'tester', name: 'Test User' });
        if (url.pathname === '/repos/tester/blog')
          return Response.json({ owner: { login: 'tester' } });
        if (decodeURIComponent(url.pathname) === '/repos/tester/blog/contents/src/content/blog')
          return Response.json([]);
        if (
          decodeURIComponent(url.pathname) ===
          '/repos/tester/blog/contents/src/content/blog/existing.md'
        )
          return Response.json({
            type: 'file',
            encoding: 'base64',
            content: Buffer.from(
              '---\ntitle: Existing post\nslug: existing\ncategory: [ruby, web]\npublished: true\n---\nExisting markdown body\n'
            ).toString('base64')
          });
      }
      unexpected.push(`${request.method} ${url.origin}${url.pathname}`);
      return new Response(null, { status: 502 });
    }
  };
  let worker;
  try {
    worker = new Miniflare(convertV4MiniflareOptions(options));
    for (const path of ['/app.js', '/durable-state.mjs', '/_worker.js']) {
      expect((await worker.dispatchFetch(origin + path)).status).toBe(404);
    }
    const login = await worker.dispatchFetch(`${origin}/auth/github/login`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    const callback = await worker.dispatchFetch(
      `${origin}/login/callback?code=fake&state=${state}`,
      {
        redirect: 'manual',
        headers: { cookie: login.headers.get('set-cookie').split(';')[0] }
      }
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/editor');
    expect(exchanges).toBe(2);
    const cookie = callback.headers.get('set-cookie').split(';')[0];
    const session = await unsealData(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)), {
      password
    });
    expect(session.githubToken.startsWith('github-user:')).toBe(true);

    const code = await sealData(
      {
        githubToken: session.githubToken,
        me: 'https://blog.example',
        clientId: 'https://client.example',
        redirectUri: 'https://client.example/callback',
        scope: 'create update delete media',
        issuedAt: Date.now()
      },
      { password, ttl: 600 }
    );
    const exchange = () =>
      worker.dispatchFetch(`${origin}/auth/indieauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: 'https://client.example',
          redirect_uri: 'https://client.example/callback'
        })
      });
    const tokenResponses = await Promise.all([exchange(), exchange()]);
    expect(tokenResponses.map((response) => response.status).sort()).toEqual([200, 400]);
    const tokenResponse = tokenResponses.find((response) => response.status === 200);
    const { access_token } = await tokenResponse.json();

    await worker.dispose();
    worker = new Miniflare(convertV4MiniflareOptions(options));
    const posts = await worker.dispatchFetch(`${origin}/api/posts`, { headers: { cookie } });
    expect(posts.status).toBe(200);
    const post = await worker.dispatchFetch(
      `${origin}/api/posts/read?path=src/content/blog/existing.md`,
      {
        headers: { cookie }
      }
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({
      frontmatter: {
        title: 'Existing post',
        slug: 'existing',
        category: ['ruby', 'web'],
        published: true
      },
      content: 'Existing markdown body\n'
    });
    expect(exchanges).toBe(2);
    const config = () =>
      worker.dispatchFetch(`${origin}/micropub?q=config`, {
        headers: { Authorization: `Bearer ${access_token}` }
      });
    expect((await config()).status).toBe(200);
    expect((await exchange()).status).toBe(400);

    expect(
      (
        await worker.dispatchFetch(`${origin}/auth/github/logout`, {
          redirect: 'manual',
          headers: { cookie }
        })
      ).status
    ).toBe(302);
    await worker.dispose();
    worker = new Miniflare(convertV4MiniflareOptions(options));
    expect((await config()).status).toBe(401);
    expect(
      (await worker.dispatchFetch(`${origin}/api/posts`, { headers: { cookie } })).status
    ).toBe(401);
    expect(unexpected).toEqual([]);
  } finally {
    await worker?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
