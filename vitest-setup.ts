// Vitest setup file for test configuration
import { vi } from 'vitest';

// Mock SvelteKit's virtual app modules globally. Environment values live in
// test-helpers.ts so individual tests can change them.
vi.mock('$app/env/private', async () => (await import('#lib/test-helpers.ts')).privateEnv);
vi.mock('$app/env/public', async () => (await import('#lib/test-helpers.ts')).publicEnv);

vi.mock('$app/env', () => ({
  dev: true,
  browser: false,
  building: false,
  version: 'test'
}));
