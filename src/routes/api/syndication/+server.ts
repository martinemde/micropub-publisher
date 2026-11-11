import { error, json } from '@sveltejs/kit';
import { syndicationJob } from '#lib/server/syndication.ts';
import type { RequestHandler } from './$types';

/**
 * GET /api/syndication?url=…
 * The editor's view of a post's pending or failed syndication.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.githubToken) error(401, 'Unauthorized');
  const job = syndicationJob(url.searchParams.get('url') ?? '');
  return json(
    job && {
      targets: job.targets,
      done: job.done,
      nextAt: job.nextAt,
      error: job.error
    }
  );
};
