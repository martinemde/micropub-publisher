import { error, isHttpError } from '@sveltejs/kit';
import { createStorageBackend } from '$lib/server/storage/factory';
import { requireMicropubToken } from '$lib/server/micropub-auth';
import { uploadPhoto } from '$lib/server/micropub-media';
import type { RequestHandler } from './$types';

/**
 * POST /micropub/media
 * Upload an image file to the blog
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
  try {
    if (!request.headers.get('content-type')?.includes('multipart/form-data'))
      error(415, 'Expected multipart/form-data');
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      error(400, 'Invalid multipart body');
    }
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
    if (formData.getAll('file').length !== 1) error(400, 'Expected one file');

    if (!file || typeof file === 'string') {
      error(400, 'No file provided');
    }

    const imageUrl = await uploadPhoto(backend, file);

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
    console.error('Media upload error:');
    error(500, 'Failed to upload image');
  }
};
