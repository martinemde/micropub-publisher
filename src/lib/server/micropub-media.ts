import { error } from '@sveltejs/kit';
import type { StorageBackend } from './storage/types';

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif'
};
export function validatePhoto(file: File): void {
  if (!Object.hasOwn(extensions, file.type))
    error(415, { message: 'Unsupported image type', error: 'invalid_request' });
  if (!file.size) error(400, { message: 'Empty image', error: 'invalid_request' });
  if (file.size > 10 * 1024 * 1024)
    error(413, { message: 'Image exceeds 10 MiB', error: 'invalid_request' });
}
export async function uploadPhoto(backend: StorageBackend, file: File): Promise<string> {
  validatePhoto(file);
  // Never let client filenames choose a repository path or overwrite an image.
  const filename = `${crypto.randomUUID()}.${extensions[file.type]}`;
  return backend.uploadImage(filename, Buffer.from(await file.arrayBuffer()), file.type);
}
