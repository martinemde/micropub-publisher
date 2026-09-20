import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runTest } from './upstream.mjs';

const context = {
  directory: resolve('.conformance/upstream'),
  endpoint: 'http://127.0.0.1:4177/micropub',
  fixtureOrigin: 'http://127.0.0.1:4178',
  tokens: { create: 'fake-create-token', restricted: 'fake-restricted-token' }
};

describe('upstream assertion harness', () => {
  test('sends the upstream payload and accepts its successful response', async () => {
    const result = await runTest({
      ...context,
      number: 100,
      localFetch: async (url, init) => {
        expect(url).toBe(context.endpoint);
        expect(init.headers.get('Authorization')).toBe('Bearer fake-create-token');
        expect(init.body).toBe('h=entry&content=Micropub+test+of+creating+a+basic+h-entry');
        return new Response(null, {
          status: 201,
          headers: { Location: `${context.fixtureOrigin}/blog/test` }
        });
      }
    });
    expect(result.status).toBe('pass');
    expect(result.requests).toHaveLength(1);
  });

  test('fails on a rejected create, rather than treating execution as a pass', async () => {
    const result = await runTest({
      ...context,
      number: 100,
      localFetch: async () => Response.json({ error: 'invalid_request' }, { status: 400 })
    });
    expect(result.status).toBe('fail');
    expect(result.failedChecks).toHaveLength(2);
  });

  test('does not auto-confirm manual content checks', async () => {
    const result = await runTest({
      ...context,
      number: 101,
      localFetch: async () =>
        new Response(null, {
          status: 201,
          headers: { Location: `${context.fixtureOrigin}/blog/test` }
        })
    });
    expect(result.status).toBe('pending');
    expect(result.manualChecks).toHaveLength(1);
  });

  test('runs the error body assertion, not only the HTTP status assertion', async () => {
    const result = await runTest({
      ...context,
      number: 803,
      localFetch: async (_url, init) => {
        expect(init.headers.has('Authorization')).toBe(false);
        return Response.json({ error: 'wrong-error' }, { status: 401 });
      }
    });
    expect(result.status).toBe('fail');
  });

  test('uses the limited-scope token for the unauthorized-token test', async () => {
    const result = await runTest({
      ...context,
      number: 804,
      localFetch: async (_url, init) => {
        expect(init.headers.get('Authorization')).toBe('Bearer fake-restricted-token');
        return Response.json({ error: 'insufficient_scope' }, { status: 401 });
      }
    });
    expect(result.status).toBe('pass');
  });
});
