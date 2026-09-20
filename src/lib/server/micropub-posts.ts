import { error } from '@sveltejs/kit';
import { isDeepStrictEqual } from 'node:util';
import { env } from '$env/dynamic/public';
import { requireEnvironmentVariable } from './env';
import {
  invalid,
  readProperties,
  parseMicropubRequest,
  generateMarkdownFile,
  type MicropubProperties
} from './micropub';
import type { StorageBackend } from './storage/types';

export function postSlug(target: unknown): string {
  const base = `${requireEnvironmentVariable('PUBLIC_SITE_URL', env.PUBLIC_SITE_URL)}/blog/`;
  if (
    typeof target !== 'string' ||
    !target.startsWith(base) ||
    !/^[a-zA-Z0-9_-]+$/.test(target.slice(base.length))
  )
    invalid('Invalid post URL');
  return target.slice(base.length);
}
export async function findPost(backend: StorageBackend, target: unknown) {
  const slug = postSlug(target);
  const file = (await backend.listBlogPosts()).find((post) => post.slug === slug);
  if (!file) error(404, { message: 'Post not found', error: 'invalid_request' });
  return file;
}
const archivePath = (slug: string) => `.micropub/deleted/${slug}.json`;
function propertyMap(value: unknown): MicropubProperties {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some((v) => !Array.isArray(v))
  )
    invalid('Expected property arrays');
  const map = value as MicropubProperties;
  for (const key of Object.keys(map)) {
    if (
      [
        'access_token',
        'action',
        'url',
        'h',
        'type',
        '__proto__',
        'constructor',
        'prototype'
      ].includes(key)
    )
      invalid('Reserved property');
  }
  return map;
}
export async function mutatePost(backend: StorageBackend, request: Record<string, unknown>) {
  const slug = postSlug(request.url);
  const archive = archivePath(slug);
  if (request.action === 'undelete') {
    if (!(await backend.fileExists(archive))) error(404, 'Deleted post not found');
    const saved = JSON.parse(await backend.readFile(archive)) as { path: string; content: string };
    if (!new RegExp(`^src/content/blog/\\d{4}-\\d{2}-\\d{2}-${slug}\\.md$`).test(saved.path))
      invalid('Invalid archived path');
    if (await backend.fileExists(saved.path)) error(409, 'Post already exists');
    await backend.createOrUpdateFile(saved.path, saved.content, `Undelete post: ${slug}`);
    await backend.deleteFile(archive, `Remove restored archive: ${slug}`);
    return;
  }
  const file = await findPost(backend, request.url);
  const source = await backend.readFile(file.path);
  if (request.action === 'delete') {
    // Write the recovery copy first. If removing the live file fails, the
    // original still exists and retrying deletion is safe.
    await backend.createOrUpdateFile(
      archive,
      JSON.stringify({ path: file.path, content: source }),
      `Archive post: ${slug}`
    );
    await backend.deleteFile(file.path, `Delete post: ${slug}`);
    return;
  }
  const properties = readProperties(source);
  if (!['replace', 'add', 'delete'].some((key) => Object.hasOwn(request, key)))
    invalid('Missing update operation');
  // Validate every operation before changing storage.
  const replace = request.replace === undefined ? {} : propertyMap(request.replace);
  const add = request.add === undefined ? {} : propertyMap(request.add);
  const remove =
    request.delete === undefined
      ? {}
      : Array.isArray(request.delete)
        ? request.delete
        : propertyMap(request.delete);
  if (Array.isArray(remove) && remove.some((key) => typeof key !== 'string'))
    invalid('Invalid delete properties');
  for (const [key, values] of Object.entries(replace)) properties[key] = values;
  for (const [key, values] of Object.entries(add)) {
    const existing = properties[key] ?? [];
    properties[key] = [
      ...existing,
      ...values.filter((value) => !existing.some((old) => isDeepStrictEqual(old, value)))
    ];
  }
  if (Array.isArray(remove)) {
    for (const key of remove as string[]) delete properties[key];
  } else {
    for (const [key, values] of Object.entries(remove)) {
      if (!Object.hasOwn(properties, key)) continue;
      properties[key] = properties[key].filter(
        (old) => !values.some((value) => isDeepStrictEqual(old, value))
      );
      if (!properties[key].length) delete properties[key];
    }
  }
  const post = parseMicropubRequest({ properties });
  // Updating properties does not relocate an existing permalink or file.
  post.slug = slug;
  await backend.createOrUpdateFile(
    file.path,
    generateMarkdownFile(post),
    `Update post: ${post.title}`
  );
}
