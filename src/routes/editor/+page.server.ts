import { getSession } from '$lib/server/auth';
import { env } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

// Disable prerendering for editor - needs runtime session management
export const prerender = false;

export const load: PageServerLoad = async (event) => {
  const session = await getSession(event);

  return {
    siteUrl: env.PUBLIC_SITE_URL,
    user: session.user || null,
    isAuthenticated: !!session.user
  };
};
