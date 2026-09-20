import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import {
  parseMicropubRequest,
  generateMarkdownFile,
  generateFilePath,
  generateCommitMessage
} from '$lib/server/micropub';
import { createStorageBackend } from '$lib/server/storage/factory';
import { requireMicropubToken } from '$lib/server/micropub-auth';
import { requireEnvironmentVariable } from '$lib/server/env';
import type { RequestHandler } from './$types';

/**
 * GET /micropub?q=config
 * Return Micropub configuration
 */
export const GET: RequestHandler = async ({ url, request, locals }) => {
  const query = url.searchParams.get('q');

  const authentication = requireMicropubToken(request, locals, url);
  if (authentication instanceof Response) return authentication;

  if (query === 'config') {
    return json({
      'media-endpoint': `${requireEnvironmentVariable('PUBLIC_APP_URL', env.PUBLIC_APP_URL)}/micropub/media`,
      'syndicate-to': []
    });
  }

  error(400, 'Invalid query parameter');
};

/**
 * POST /micropub
 * Create a new blog post
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
  try {
    // Parse request body first to check for access_token
    const contentType = request.headers.get('content-type') || '';
    let micropubRequest: Record<string, unknown>;
    let bodyToken: unknown;

    if (contentType.includes('application/json')) {
      try {
        micropubRequest = await request.json();
      } catch {
        error(400, { message: 'Invalid JSON', error: 'invalid_request' });
      }
      if (
        !micropubRequest ||
        typeof micropubRequest !== 'object' ||
        Array.isArray(micropubRequest)
      ) {
        error(400, { message: 'Expected a JSON object', error: 'invalid_request' });
      }
      bodyToken = micropubRequest.access_token;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      micropubRequest = Object.fromEntries(formData);
      bodyToken = formData.get('access_token') ?? undefined;
    } else {
      error(
        415,
        'Unsupported content type. Use application/json or application/x-www-form-urlencoded'
      );
    }

    const githubToken = requireMicropubToken(request, locals, url, bodyToken);
    if (githubToken instanceof Response) return githubToken;

    // Creation has no action parameter. Never interpret an unsupported or
    // malformed action as a request to create content.
    if (Object.hasOwn(micropubRequest, 'action') || Object.hasOwn(micropubRequest, 'action[]')) {
      error(400, { message: 'Actions are not supported', error: 'invalid_request' });
    }
    requireMicropubToken(request, locals, url, bodyToken, 'create');

    // Create storage backend
    const backend = createStorageBackend(githubToken);

    // Parse Micropub request to blog post data
    const post = parseMicropubRequest(micropubRequest);

    // Generate file path and content
    const filePath = generateFilePath(post);
    const content = generateMarkdownFile(post);

    // Check if file already exists
    const exists = await backend.fileExists(filePath);

    // Create or update file via storage backend
    const commitMessage = generateCommitMessage(post, exists);
    await backend.createOrUpdateFile(filePath, content, commitMessage);

    // Return 201 Created with Location header
    const siteUrl = requireEnvironmentVariable('PUBLIC_SITE_URL', env.PUBLIC_SITE_URL);
    const postUrl = `${siteUrl}/blog/${post.slug}`;
    return new Response(null, {
      status: 201,
      headers: {
        Location: postUrl,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    // Re-throw SvelteKit HttpErrors (auth failures, content type errors, etc.)
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    console.error('Micropub POST error:', err);
    error(500, 'Failed to create post');
  }
};
