import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import {
  parseMicropubRequest,
  generateMarkdownFile,
  generateFilePath,
  generateCommitMessage,
  readProperties,
  invalid,
  siteDateParts
} from '$lib/server/micropub';
import { createStorageBackend } from '$lib/server/storage/factory';
import { requireMicropubToken } from '$lib/server/micropub-auth';
import { requireEnvironmentVariable } from '$lib/server/env';
import {
  archivePath,
  findPost,
  mutatePost,
  postLocation,
  postUrl
} from '$lib/server/micropub-posts';
import { uploadPhoto, validatePhoto } from '$lib/server/micropub-media';
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
      'syndicate-to': [],
      'post-types': [
        { type: 'note', name: 'Note' },
        { type: 'article', name: 'Article' },
        { type: 'photo', name: 'Photo' },
        { type: 'bookmark', name: 'Bookmark' }
      ]
    });
  }

  if (query === 'source') {
    const target = url.searchParams.get('url');
    const backend = createStorageBackend(authentication);
    const file = await findPost(backend, target);
    const properties = readProperties(await backend.readFile(file.path));
    const requested = url.searchParams.getAll('properties[]');
    return json({
      type: ['h-entry'],
      properties: requested.length
        ? Object.fromEntries(Object.entries(properties).filter(([key]) => requested.includes(key)))
        : properties
    });
  }

  error(400, 'Invalid query parameter');
};

/**
 * POST /micropub
 * Create a new blog post
 */
// Token/session state already requires one process. Serialize mutations in that
// process so slug allocation and read-modify-write updates cannot race.
let postWrites: Promise<void> = Promise.resolve();
function serializeWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = postWrites.then(write);
  postWrites = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
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
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        invalid('Invalid form body');
      }
      micropubRequest = Object.create(null);
      for (const [field, value] of formData) {
        const key = field.endsWith('[]') ? field.slice(0, -2) : field;
        if (key === 'action' && field !== key) invalid('Invalid action');
        const previous = micropubRequest[key];
        micropubRequest[key] =
          previous === undefined
            ? value
            : [...(Array.isArray(previous) ? previous : [previous]), value];
      }
      bodyToken = formData.get('access_token') ?? undefined;
    } else {
      error(
        415,
        'Unsupported content type. Use application/json or application/x-www-form-urlencoded'
      );
    }

    const githubToken = requireMicropubToken(request, locals, url, bodyToken);
    if (githubToken instanceof Response) return githubToken;

    if (Object.hasOwn(micropubRequest, 'action') || Object.hasOwn(micropubRequest, 'action[]')) {
      const action = micropubRequest.action;
      if (typeof action !== 'string' || !['update', 'delete', 'undelete'].includes(action))
        invalid('Invalid action');
      postLocation(micropubRequest.url);
      if (action === 'update' && !contentType.includes('application/json'))
        invalid('Updates require JSON');
      requireMicropubToken(request, locals, url, bodyToken, action);
      const moved = await serializeWrite(() =>
        mutatePost(createStorageBackend(githubToken), micropubRequest)
      );
      // Micropub answers a URL-changing update with 201 and the new Location.
      return moved
        ? new Response(null, { status: 201, headers: { Location: moved } })
        : new Response(null, { status: 204 });
    }
    requireMicropubToken(request, locals, url, bodyToken, 'create');

    return await serializeWrite(async () => {
      // Create storage backend
      const backend = createStorageBackend(githubToken);

      // File uploads are allowed only for the photo property. Store their public
      // URLs, never File objects or authentication fields, in the post source.
      for (const [key, value] of Object.entries(micropubRequest)) {
        const values = Array.isArray(value) ? value : [value];
        if (!values.some((item) => item instanceof File)) continue;
        if (key !== 'photo') invalid('Only photo uploads are supported');
        for (const item of values) if (item instanceof File) validatePhoto(item);
        micropubRequest[key] = await Promise.all(
          values.map(async (item) => {
            if (!(item instanceof File)) return item;
            return uploadPhoto(backend, item);
          })
        );
      }

      // Parse Micropub request to blog post data
      const post = parseMicropubRequest(micropubRequest);

      // Slugs only need to be unique within their day.
      const { day } = siteDateParts(post.date);
      const usedSlugs = new Set(
        (await backend.listBlogPosts()).filter((file) => file.date === day).map((file) => file.slug)
      );
      const requestedSlug = post.slug;
      while (usedSlugs.has(post.slug) || (await backend.fileExists(archivePath(day, post.slug)))) {
        post.slug = `${requestedSlug}-${crypto.randomUUID()}`;
      }
      if (post.properties['mp-slug']) post.properties['mp-slug'] = [post.slug];

      // Generate file path and content
      const filePath = generateFilePath(post);
      const content = generateMarkdownFile(post);

      // Check if file already exists
      const exists = await backend.fileExists(filePath);
      if (exists) error(409, 'Post already exists');

      // Create or update file via storage backend
      const commitMessage = generateCommitMessage(post, exists);
      await backend.createOrUpdateFile(filePath, content, commitMessage);

      // Return 201 Created with Location header
      return new Response(null, {
        status: 201,
        headers: {
          Location: postUrl(post),
          'Content-Type': 'application/json'
        }
      });
    });
  } catch (err) {
    // Re-throw SvelteKit HttpErrors (auth failures, content type errors, etc.)
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    console.error('Micropub POST error:');
    error(500, 'Failed to create post');
  }
};
