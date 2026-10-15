import { dev } from '$app/env';
import { MICROPUB_BACKEND } from '$app/env/private';
import type { StorageBackend } from './types.ts';
import { GitHubStorageBackend } from './github.ts';
import { FileStorageBackend } from './file.ts';
import { TestStorageBackend } from './test.ts';

/**
 * Create a storage backend based on configuration and environment
 *
 * Backend selection priority:
 * 1. MICROPUB_BACKEND env var (test, file, github)
 * 2. Auto-detect: dev mode → file, production → github
 *
 * @param token - GitHub authentication token (required for GitHub backend)
 * @returns StorageBackend instance
 */
export function createStorageBackend(token?: string): StorageBackend {
  // Environment variable override
  const backendType = MICROPUB_BACKEND;

  if (backendType === 'test') {
    return new TestStorageBackend();
  }

  if (backendType === 'file') {
    return new FileStorageBackend();
  }

  if (backendType === 'github') {
    if (!token) {
      throw new Error('GitHub backend requires authentication token');
    }
    return new GitHubStorageBackend(token);
  }

  // Auto-detect based on environment
  if (dev) {
    // Local development: use file backend
    return new FileStorageBackend();
  } else {
    // Production: use GitHub backend
    if (!token) {
      throw new Error('GitHub token required for production storage backend');
    }
    return new GitHubStorageBackend(token);
  }
}
