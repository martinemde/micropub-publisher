import { getSession } from '#lib/server/auth.ts';
import { syndicationTargets } from '#lib/server/syndication.ts';
import { PUBLIC_SITE_URL } from '$app/env/public';
import type { PageServerLoad } from './$types';

// Disable prerendering for editor - needs runtime session management
export const prerender = false;

export const load: PageServerLoad = async (event) => {
  const session = await getSession(event);

  return {
    siteUrl: PUBLIC_SITE_URL,
    syndicateTo: syndicationTargets(),
    user: session.user || null,
    isAuthenticated: !!session.user
  };
};
