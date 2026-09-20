import adapter from './scripts/cloudflare-adapter.mjs';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // hooks.server.ts applies CSRF protection and allows cross-origin protocol
    // requests without granting them access to editor session cookies.
    csrf: {
      trustedOrigins: ['*']
    }
  }
};

export default config;
