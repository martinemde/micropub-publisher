import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import adapter from './scripts/cloudflare-adapter.mjs';

export default defineConfig({
  server: { port: 5180, strictPort: true },
  plugins: [
    tailwindcss(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter(),
      // hooks.server.ts applies CSRF protection and allows cross-origin protocol
      // requests without granting them access to editor session cookies.
      csrf: {
        trustedOrigins: ['*']
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any,
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts']
  },
  resolve: {
    // Always use browser conditions to properly resolve Svelte 5 client-side entry points
    conditions: ['browser']
  }
});
