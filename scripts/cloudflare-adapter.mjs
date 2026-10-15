import cloudflare from '@sveltejs/adapter-cloudflare';
import { appendFileSync, copyFileSync, renameSync } from 'node:fs';

/** @returns {import('@sveltejs/kit').Adapter} */
export default function adapter() {
  const base = cloudflare();
  return {
    ...base,
    // Vite development and the conformance harness use their local stores, not
    // a Wrangler platform proxy, so the app never imports cloudflare:workers.
    vite: undefined,
    /** @param {import('@sveltejs/kit').Builder} builder */
    async adapt(builder) {
      await base.adapt(builder);
      renameSync('.svelte-kit/cloudflare/_worker.js', '.svelte-kit/cloudflare/app.js');
      copyFileSync('scripts/cloudflare-worker.mjs', '.svelte-kit/cloudflare/_worker.js');
      copyFileSync('scripts/durable-state.mjs', '.svelte-kit/cloudflare/durable-state.mjs');
      appendFileSync('.svelte-kit/cloudflare/.assetsignore', '\napp.js\ndurable-state.mjs\n');
    }
  };
}
