import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // hooks.server.ts applies SvelteKit's CSRF rule while exempting only the
    // cross-origin IndieAuth token exchange required by the protocol.
    csrf: {
      trustedOrigins: ['*']
    }
  }
};

export default config;
