import { isHttpError, isRedirect } from '@sveltejs/kit';
import { expect } from 'vitest';

/**
 * Assert that an awaitable value throws a SvelteKit HttpError with the
 * expected status and a body message containing the given substring.
 *
 * Non-HttpError throws are re-thrown so they surface as real test failures.
 */
export async function expectHttpError(
  promise: unknown,
  status: number,
  messageContains: string
): Promise<void> {
  try {
    await promise;
    expect.fail('Expected an HttpError to be thrown');
  } catch (e) {
    if (!isHttpError(e)) throw e;
    expect(e.status).toBe(status);
    expect(e.body.message).toContain(messageContains);
  }
}

/**
 * Assert that an awaitable value throws a SvelteKit Redirect with the
 * expected status. Returns the location for further assertions.
 */
export async function expectRedirect(promise: unknown, status: number = 302): Promise<string> {
  try {
    await promise;
    expect.fail('Expected a redirect to be thrown');
  } catch (e) {
    if (!isRedirect(e)) throw e;
    expect(e.status).toBe(status);
    return e.location;
  }
}

/**
 * Values behind the `$app/env/private` and `$app/env/public` mocks in
 * vitest-setup.ts. Tests may reassign them; modules read them on each use.
 */
export const privateEnv: Record<string, string | undefined> = {
  GITHUB_CLIENT_ID: 'test_client_id',
  GITHUB_CLIENT_SECRET: 'test_client_secret',
  GITHUB_OWNER: 'test_owner',
  AUTHOR_NAME: undefined,
  GITHUB_REPO: 'test_repo',
  SESSION_SECRET: 'test_session_secret_key_for_testing_only_32_chars',
  MICROPUB_BACKEND: 'test',
  PUBLISHER_RUNTIME: undefined
};

export const publicEnv: Record<string, string | undefined> = {
  PUBLIC_APP_URL: 'https://publisher.example.com',
  PUBLIC_SITE_URL: 'https://example.com'
};
