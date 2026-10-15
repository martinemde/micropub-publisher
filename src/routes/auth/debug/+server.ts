import { json } from '@sveltejs/kit';
import { dev } from '$app/env';
import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_OWNER,
  SESSION_SECRET
} from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Debug endpoint to verify environment variables are loaded
 * IMPORTANT: Remove this endpoint before deploying to production!
 */
export const GET: RequestHandler = async () => {
  if (!dev) {
    return new Response('Not found', { status: 404 });
  }

  const checks = {
    SESSION_SECRET: {
      exists: !!SESSION_SECRET,
      length: SESSION_SECRET?.length || 0,
      valid: (SESSION_SECRET?.length || 0) >= 32,
      preview: SESSION_SECRET ? 'SET (hidden)' : 'NOT SET'
    },
    GITHUB_CLIENT_ID: {
      exists: !!GITHUB_CLIENT_ID,
      preview: GITHUB_CLIENT_ID ? `${GITHUB_CLIENT_ID.slice(0, 4)}...` : 'NOT SET'
    },
    GITHUB_CLIENT_SECRET: {
      exists: !!GITHUB_CLIENT_SECRET,
      preview: GITHUB_CLIENT_SECRET ? 'SET (hidden)' : 'NOT SET'
    },
    GITHUB_OWNER: {
      exists: !!GITHUB_OWNER,
      value: GITHUB_OWNER || 'NOT SET'
    }
  };

  return json(checks, {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
};
