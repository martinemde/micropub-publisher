import { json, error, isHttpError } from '@sveltejs/kit';
import { createStorageBackend } from '$lib/server/storage/factory';
import matter from 'gray-matter';
import type { RequestHandler } from './$types';

/**
 * GET /api/posts/read?path=...
 * Read a specific blog post file
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  // Require authentication
  if (!locals.githubToken) {
    error(401, 'Unauthorized');
  }

  const path = url.searchParams.get('path');
  if (!path) {
    error(400, 'Missing path parameter');
  }

  // Validate that path is a blog post file
  if (!path.startsWith('src/content/blog/') || !path.endsWith('.md')) {
    error(400, 'Invalid path: must be a blog post file');
  }

  try {
    const backend = createStorageBackend(locals.githubToken);
    const source = await backend.readFile(path);
    const { data: frontmatter, content } = matter(source);

    return json({ frontmatter, content });
  } catch (err) {
    if (isHttpError(err)) throw err;
    console.error('Failed to read blog post:');
    error(500, 'Failed to read blog post');
  }
};
