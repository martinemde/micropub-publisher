import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { revision, runTest } from './upstream.mjs';
import { createJudge } from './judgment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, '.conformance/upstream');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Usage: bun run conformance [case numbers]\nRuns pinned micropub.rocks assertions against an isolated local app.\nWithout case numbers, runs all cases except excluded syndication test 601.\nExit: 0 all selected cases pass; 1 failure or pending manual check; 2 harness error.'
  );
  process.exit(0);
}
if (args.some((arg) => !/^\d{3}$/.test(arg)))
  throw new Error('Expected case numbers, e.g. 100 200 600 803 804');
if ((await readFile(join(directory, '.revision'), 'utf8').catch(() => '')) !== revision) {
  throw new Error('Run bun run conformance:setup first to download the pinned upstream suite.');
}
const available = (await readdir(join(directory, 'views/server-tests')))
  .filter((name) => /^\d+\.php$/.test(name))
  .map((name) => Number(name.slice(0, -4)))
  .sort();
const selected = args.length
  ? [...new Set(args.map(Number))]
  : available.filter((number) => number !== 601);
if (selected.some((number) => !available.includes(number)))
  throw new Error('Unknown upstream case number');
const runDir = join(root, '.conformance/runs', new Date().toISOString().replaceAll(':', '-'));
const appDir = join(runDir, 'app');
await mkdir(appDir, { recursive: true });
const appOrigin = 'http://127.0.0.1:4177';
const fixtureOrigin = 'http://127.0.0.1:4178';
const endpoint = `${appOrigin}/micropub`;
const localFetch = (input, options = {}) => {
  const url = new URL(input);
  if (![appOrigin, fixtureOrigin].includes(url.origin))
    throw new Error(`Blocked non-test URL: ${url.origin}`);
  return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
};
const fixtures = createServer(async (request, response) => {
  const path = new URL(request.url, fixtureOrigin).pathname;
  const match = path.match(/^\/(media|images\/blog)\/([\w.-]+)$/);
  if (!match) {
    response.writeHead(404).end();
    return;
  }
  const file =
    match[1] === 'media'
      ? join(directory, 'public/media', match[2])
      : join(appDir, 'static/images/blog', match[2]);
  try {
    const bytes = await readFile(file);
    response.setHeader(
      'Content-Type',
      file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.png') ? 'image/png' : 'image/gif'
    );
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
let child;
let log;
let tokens;
const logReaders = [];
const results = [];
const redact = (text) =>
  Object.values(tokens ?? {}).reduce(
    (value, token) => value.replaceAll(token, '[TEST TOKEN]'),
    text
  );
async function stop() {
  if (child) {
    child.kill('SIGTERM');
    const stopped = await Promise.race([
      child.exited.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5000))
    ]);
    if (!stopped) {
      child.kill('SIGKILL');
      await child.exited;
    }
    child = undefined;
  }
  await new Promise((r) => fixtures.close(r));
  await Promise.all(logReaders);
  await log?.end();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await stop();
    process.exit(130);
  });
let exitCode = 2;
try {
  await new Promise((ready, reject) => {
    fixtures.once('error', reject);
    fixtures.listen(4178, '127.0.0.1', ready);
  });
  log = Bun.file(join(runDir, 'app.log')).writer();
  child = Bun.spawn([process.execPath, join(root, 'scripts/conformance/app.mjs'), root, appDir], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      MICROPUB_BACKEND: 'file',
      PUBLIC_APP_URL: appOrigin,
      PUBLIC_SITE_URL: fixtureOrigin,
      GITHUB_OWNER: 'conformance',
      GITHUB_REPO: 'local-only',
      SESSION_SECRET: 'local-conformance-only-not-a-production-secret'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const copyLog = async (stream) => {
    for await (const chunk of stream) log.write(chunk);
  };
  logReaders.push(copyLog(child.stdout), copyLog(child.stderr));
  const deadline = Date.now() + 30000;
  while (!tokens && Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Conformance app exited; see ${join(runDir, 'app.log')}`);
    try {
      tokens = JSON.parse(await readFile(join(appDir, 'tokens.json'), 'utf8'));
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!tokens) throw new Error('Conformance app startup timed out');
  await rm(join(appDir, 'tokens.json'));
  console.log(`micropub.rocks ${revision}\nApp: ${appOrigin}\nArtifacts: ${runDir}`);
  const judge = createJudge(appDir, directory);
  for (const number of selected) {
    let result;
    try {
      result = await runTest({
        directory,
        number,
        endpoint,
        tokens,
        fixtureOrigin,
        localFetch,
        judge
      });
    } catch (err) {
      result = { number, status: 'error', errors: [err.stack ?? String(err)] };
    }
    const caseDir = join(runDir, String(number));
    await mkdir(caseDir, { recursive: true });
    if (result.html) {
      await writeFile(join(caseDir, 'result.html'), redact(result.html));
      delete result.html;
    }
    await cp(join(appDir, 'src/content/blog'), join(caseDir, 'posts'), { recursive: true });
    await writeFile(join(caseDir, 'result.json'), redact(JSON.stringify(result, null, 2)));
    results.push(result);
    console.log(
      `${number}: ${result.status}${result.failedChecks?.length ? ` — ${result.failedChecks.join('; ')}` : ''}${result.errors?.length ? ` — ${result.errors[0]}` : ''}`
    );
  }
  const counts = Object.fromEntries(
    ['pass', 'fail', 'pending', 'error'].map((status) => [
      status,
      results.filter((r) => r.status === status).length
    ])
  );
  const summary = {
    revision,
    counts,
    excluded: args.length
      ? []
      : [{ number: 601, reason: 'Syndication excluded from publishing scope' }],
    results
  };
  await writeFile(join(runDir, 'summary.json'), redact(JSON.stringify(summary, null, 2)));
  await writeFile(
    join(root, '.conformance/latest.json'),
    JSON.stringify({ runDir, counts }, null, 2)
  );
  console.log(JSON.stringify(counts));
  exitCode = counts.error ? 2 : counts.fail || counts.pending ? 1 : 0;
} catch (err) {
  console.error(err.stack ?? String(err));
} finally {
  await stop();
}
process.exit(exitCode);
