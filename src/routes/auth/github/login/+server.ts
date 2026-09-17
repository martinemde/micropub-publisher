import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { generateState, getAuthorizationUrl, getSession, setSession } from '$lib/server/auth';
import { requireEnvironmentVariable } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  // Generate CSRF protection state
  const state = generateState();

  // Store state in session for verification
  // Preserve user/githubToken if already logged in, but clear any IndieAuth flow
  const session = await getSession(event);
  const { user, githubToken } = session;

  await setSession(event, {
    // Preserve existing auth
    ...(user && { user }),
    ...(githubToken && { githubToken }),
    // Set new OAuth state
    oauthState: state
    // Explicitly NOT including indieAuthRequest - this is a normal login flow
    // This prevents a race condition where a user starts IndieAuth then clicks normal login
  });

  // Build redirect URI for GitHub OAuth
  const publisherUrl = requireEnvironmentVariable('PUBLIC_APP_URL', env.PUBLIC_APP_URL);
  const redirectUri = `${publisherUrl}/auth/github/callback`;

  // Get GitHub OAuth URL
  const authUrl = getAuthorizationUrl(state, redirectUri);

  // Redirect to GitHub
  redirect(302, authUrl);
};
