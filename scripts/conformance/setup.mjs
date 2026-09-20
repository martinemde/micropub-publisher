import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveSha256, revision } from './upstream.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = join(root, '.conformance');
const directory = join(cache, 'upstream');
if ((await readFile(join(directory, '.revision'), 'utf8').catch(() => '')) === revision) {
  console.log(`micropub.rocks ${revision} already installed`);
  process.exit(0);
}
await mkdir(cache, { recursive: true });
const url = `https://codeload.github.com/aaronpk/micropub.rocks/tar.gz/${revision}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== archiveSha256)
  throw new Error('Upstream archive checksum mismatch');
const archive = join(cache, 'upstream.tar.gz');
const staging = join(cache, `upstream-${process.pid}`);
await writeFile(archive, bytes);
await mkdir(staging);
try {
  const tar = Bun.spawn(['tar', '-xzf', archive, '-C', staging, '--strip-components=1'], {
    stdout: 'inherit',
    stderr: 'inherit'
  });
  if (await tar.exited) throw new Error('Could not extract upstream archive');
  await writeFile(join(staging, '.revision'), revision);
  await rm(directory, { recursive: true, force: true });
  await rename(staging, directory);
} finally {
  await rm(staging, { recursive: true, force: true });
  await rm(archive, { force: true });
}
console.log(`Installed micropub.rocks ${revision}`);
