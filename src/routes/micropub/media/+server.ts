import { error, isHttpError } from '@sveltejs/kit';
import { createStorageBackend } from '$lib/server/storage/factory';
import { requireMicropubToken } from '$lib/server/micropub-auth';
import type { RequestHandler } from './$types';

/**
 * POST /micropub/media
 * Upload an image file to the blog
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
  try {
    const formData = await request.formData();
    const githubToken = requireMicropubToken(
      request,
      locals,
      url,
      formData.get('access_token') ?? undefined,
      'create'
    );
    if (githubToken instanceof Response) return githubToken;
    const backend = createStorageBackend(githubToken);
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      error(400, 'No file provided');
    }

    // Validate file is an image
    if (!file.type.startsWith('image/')) {
      error(415, 'File must be an image');
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload via storage backend
    const imageUrl = await backend.uploadImage(file.name, buffer, file.type);

    // Return 201 Created with Location header
    return new Response(null, {
      status: 201,
      headers: {
        Location: imageUrl,
        'Content-Type': 'text/plain'
      }
    });
  } catch (err) {
    if (isHttpError(err)) throw err;
    console.error('Media upload error:', err);
    error(500, 'Failed to upload image');
  }
};
