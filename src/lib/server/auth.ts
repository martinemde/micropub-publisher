import { createHash } from 'node:crypto';
import { sealData, unsealData } from 'iron-session';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { requestUserToken, storeGithubCredential, hasGithubCredential } from './github-user-token';
import type { RequestEvent } from '@sveltejs/kit';
import { requireEnvironmentVariable } from './env';
import { stateMap } from './state';

export interface SessionData {
  user?: {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
  githubToken?: string;
  oauthState?: string;
  oauthVerifier?: string;
  indieAuthRequest?: {
    scope?: string;
    me: string;
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  };
}

export interface AuthCode {
  scope?: string;
  githubToken: string;
  me: string;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  issuedAt: number;
}

/**
 * Get session options lazily to avoid accessing env vars during prerendering
 */
function getSessionOptions() {
  const secret = env.SESSION_SECRET;

  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }

  if (secret.length < 32) {
    throw new Error(
      `SESSION_SECRET is too short (${secret.length} characters). Minimum 32 characters required for iron-session encryption.`
    );
  }

  return {
    password: secret,
    ttl: 60 * 60 * 24 * 7 // 7 days
  };
}

// Separate from legacy OAuth sessions carrying broad repo-scoped tokens.
const COOKIE_NAME = 'micropub_session_v2';

/**
 * Get session data from request cookies
 */
export async function getSession(event: RequestEvent): Promise<SessionData> {
  const sessionCookie = event.cookies.get(COOKIE_NAME);

  if (!sessionCookie) {
    return {};
  }

  try {
    const session = await unsealData<SessionData>(sessionCookie, getSessionOptions());
    if (session.githubToken && !hasGithubCredential(session.githubToken)) return {};
    return session;
  } catch (error) {
    console.error('Failed to unseal session:', error);
    return {};
  }
}

/**
 * Set session data in response cookies
 */
export async function setSession(event: RequestEvent, data: SessionData): Promise<void> {
  const sealed = await sealData(data, getSessionOptions());

  event.cookies.set(COOKIE_NAME, sealed, {
    path: '/',
    httpOnly: true,
    secure: event.url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: getSessionOptions().ttl
  });
}

/**
 * Clear session cookie
 */
export function clearSession(event: RequestEvent): void {
  event.cookies.delete(COOKIE_NAME, { path: '/' });
}

/**
 * Exchange OAuth code for access token
 */
export function githubCallbackUrl(): string {
  return new URL(
    '/login/callback',
    requireEnvironmentVariable('PUBLIC_APP_URL', publicEnv.PUBLIC_APP_URL)
  ).href;
}
export async function exchangeCodeForToken(code: string, verifier?: string): Promise<string> {
  const credential = await requestUserToken({
    code,
    redirect_uri: githubCallbackUrl(),
    ...(verifier ? { code_verifier: verifier } : {})
  });
  return storeGithubCredential(credential);
}

/**
 * Generate random state for OAuth CSRF protection
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build GitHub OAuth authorization URL
 */
export function getAuthorizationUrl(state: string, redirectUri: string, verifier?: string): string {
  const params = new URLSearchParams({
    client_id: requireEnvironmentVariable('GITHUB_CLIENT_ID', env.GITHUB_CLIENT_ID),
    redirect_uri: redirectUri,
    state
  });

  if (verifier) {
    params.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    params.set('code_challenge_method', 'S256');
  }
  return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * Create an IndieAuth authorization code (sealed)
 */
export async function createAuthCode(data: Omit<AuthCode, 'issuedAt'>): Promise<string> {
  const authCode: AuthCode = {
    ...data,
    issuedAt: Date.now()
  };

  return await sealData(authCode, {
    password: env.SESSION_SECRET!,
    ttl: 600 // 10 minutes
  });
}

// Store for used authorization codes (prevents replay attacks)
const usedAuthCodes = stateMap<number>('used-auth-codes');

/**
 * Verify and decode an IndieAuth authorization code
 * Ensures codes can only be used once
 */
export async function verifyAuthCode(code: string): Promise<AuthCode | null> {
  const codeHash = createHash('sha256').update(code).digest('hex');
  for (const [key, expiresAt] of usedAuthCodes) {
    if (expiresAt <= Date.now()) usedAuthCodes.delete(key);
  }

  try {
    const data = await unsealData<AuthCode>(code, {
      password: env.SESSION_SECRET!,
      ttl: 600
    });

    // Validate required fields exist (unsealData may return empty object for invalid tokens)
    if (!data.githubToken || !data.me || !data.clientId || !data.redirectUri || !data.issuedAt) {
      return null;
    }

    // Check if code is expired (10 minutes)
    if (Date.now() - data.issuedAt > 600000) {
      return null;
    }

    // Mark code as used
    // Check and consume together after the asynchronous unseal.
    if (usedAuthCodes.has(codeHash)) return null;
    usedAuthCodes.set(codeHash, data.issuedAt + 900000);

    return data;
  } catch {
    return null;
  }
}

/**
 * Verify PKCE code challenge
 */
export async function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string = 'S256'
): Promise<boolean> {
  if (method === 'plain') {
    return verifier === challenge;
  }

  if (method === 'S256') {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return base64 === challenge;
  }

  return false;
}
