import { resolve } from 'node:path';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';

const [root, runDir] = process.argv.slice(2);
if (!root || !runDir) throw new Error('Expected repository and isolated run directory');
// This subprocess receives an allowlisted environment from the runner, never .env.
await mkdir(runDir, { recursive: true });
for (const file of [
  'src',
  'static',
  'svelte.config.js',
  'scripts/cloudflare-adapter.mjs',
  'vite.config.ts',
  'tsconfig.json',
  'package.json'
]) {
  await cp(resolve(root, file), resolve(runDir, file), { recursive: true });
}
await symlink(resolve(root, 'node_modules'), resolve(runDir, 'node_modules'), 'dir');
process.chdir(runDir);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== '127.0.0.1')
    throw new Error(`Conformance blocked external fetch: ${url.origin}`);
  return nativeFetch(input, { ...init, redirect: 'error' });
};
const { createServer } = await import('vite');
const vite = await createServer({
  root: runDir,
  envDir: runDir,
  mode: 'conformance',
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  logLevel: 'warn'
});
await vite.listen();
const { storeAccessToken } = await vite.ssrLoadModule('/src/lib/server/token-store.ts');
const tokens = {
  create: storeAccessToken(
    'local-fake-github-token',
    process.env.PUBLIC_SITE_URL,
    'create update delete undelete'
  ),
  restricted: storeAccessToken('local-fake-github-token', process.env.PUBLIC_SITE_URL, '')
};
await mkdir(resolve(runDir, 'src/content/blog'), { recursive: true });
await writeFile(resolve(runDir, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });
console.log('Conformance app ready on http://127.0.0.1:4177');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await vite.close();
    process.exit(0);
  });
}
