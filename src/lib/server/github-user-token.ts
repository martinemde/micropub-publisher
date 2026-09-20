import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireEnvironmentVariable } from './env';

type Credential = {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt: number;
  refreshing?: Promise<string>;
};
// Shared references let editor and Micropub sessions use the same rotated token.
// Credentials never leave the server in cookies or IndieAuth authorization codes.
const credentials = new Map<string, Credential>();
const prefix = 'github-user:';

export async function requestUserToken(parameters: Record<string, string>): Promise<Credential> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: requireEnvironmentVariable('GITHUB_CLIENT_ID', env.GITHUB_CLIENT_ID),
      client_secret: requireEnvironmentVariable('GITHUB_CLIENT_SECRET', env.GITHUB_CLIENT_SECRET),
      ...parameters
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('GitHub user authorization failed');
  const data = await response.json();
  if (data.error || typeof data.access_token !== 'string' || !data.access_token.startsWith('ghu_'))
    throw new Error('GitHub user authorization failed');
  const expiration = (seconds: unknown) => {
    if (seconds === undefined) return Infinity;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)
      throw new Error('Invalid GitHub token expiry');
    return Date.now() + seconds * 1000;
  };
  return {
    accessToken: data.access_token,
    expiresAt: expiration(data.expires_in),
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    refreshExpiresAt: expiration(data.refresh_token_expires_in)
  };
}
export function storeGithubCredential(credential: Credential): string {
  const reference = `${prefix}${crypto.randomUUID()}`;
  credentials.set(reference, credential);
  return reference;
}
export function hasGithubCredential(reference: string): boolean {
  return !reference.startsWith(prefix) || credentials.has(reference);
}
export function revokeGithubCredential(reference: string): void {
  credentials.delete(reference);
}
export async function resolveGithubToken(reference: string): Promise<string> {
  // Storage also accepts explicitly supplied API tokens (used by boundary tests).
  if (!reference.startsWith(prefix)) return reference;
  const credential = credentials.get(reference);
  if (!credential) error(401, 'Sign in to GitHub again');
  if (credential.expiresAt > Date.now() + 60000) return credential.accessToken;
  if (!credential.refreshToken || credential.refreshExpiresAt <= Date.now()) {
    credentials.delete(reference);
    error(401, 'Sign in to GitHub again');
  }
  if (!credential.refreshing) {
    credential.refreshing = (async () => {
      try {
        const refreshed = await requestUserToken({
          grant_type: 'refresh_token',
          refresh_token: credential.refreshToken!
        });
        // A logout during refresh must not resurrect the credential.
        if (credentials.get(reference) !== credential) error(401, 'Sign in to GitHub again');
        credentials.set(reference, refreshed);
        return refreshed.accessToken;
      } catch {
        credentials.delete(reference);
        error(401, 'Sign in to GitHub again');
      }
    })();
  }
  return credential.refreshing;
}
