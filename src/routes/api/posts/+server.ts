import { json, error, isHttpError } from '@sveltejs/kit';
import { createStorageBackend } from '$lib/server/storage/factory';
import type { RequestHandler } from './$types';

/**
 * GET /api/posts
 * List all blog post files
 */
export const GET: RequestHandler = async ({ locals }) => {
  // Require authentication
  if (!locals.githubToken) {
    error(401, 'Unauthorized');
  }

  try {
    const backend = createStorageBackend(locals.githubToken);
    const posts = await backend.listBlogPosts();

    return json(posts);
  } catch (err) {
    if (isHttpError(err)) throw err;
    console.error('Failed to list blog posts:');
    error(500, 'Failed to list blog posts');
  }
};
