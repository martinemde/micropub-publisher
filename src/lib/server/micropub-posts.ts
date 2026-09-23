import { error } from '@sveltejs/kit';
import { isDeepStrictEqual } from 'node:util';
import { env } from '$env/dynamic/public';
import { requireEnvironmentVariable } from './env';
import {
  invalid,
  readProperties,
  parseMicropubRequest,
  generateMarkdownFile,
  siteDateParts,
  type BlogPost,
  type MicropubProperties
} from './micropub';
import type { StorageBackend } from './storage/types';

const siteUrl = () => requireEnvironmentVariable('PUBLIC_SITE_URL', env.PUBLIC_SITE_URL);
/** Permalinks are nested by the site's calendar day: /2026/07/21/134309 */
export function postUrl(post: Pick<BlogPost, 'date' | 'slug'>): string {
  return `${siteUrl()}/${siteDateParts(post.date).day.replaceAll('-', '/')}/${post.slug}`;
}
/** Parse a permalink, or a legacy /blog/slug URL that has no day. */
export function postLocation(target: unknown): { day?: string; slug: string } {
  const path =
    typeof target === 'string' && target.startsWith(`${siteUrl()}/`)
      ? target.slice(siteUrl().length)
      : '';
  const match =
    path.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([a-zA-Z0-9_-]+)$/) ??
    path.match(/^\/blog\/()()()([a-zA-Z0-9_-]+)$/);
  if (!match) invalid('Invalid post URL');
  const [, year, month, day, slug] = match;
  return year ? { day: `${year}-${month}-${day}`, slug } : { slug };
}
export async function findPost(backend: StorageBackend, target: unknown) {
  const { day, slug } = postLocation(target);
  const files = (await backend.listBlogPosts()).filter(
    (post) => post.slug === slug && (!day || post.date === day)
  );
  if (!files.length) error(404, { message: 'Post not found', error: 'invalid_request' });
  if (files.length > 1) invalid('Ambiguous post URL');
  return files[0];
}
export const archivePath = (day: string, slug: string) => `.micropub/deleted/${day}-${slug}.json`;
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
  if (request.action === 'undelete') {
    const { day, slug } = postLocation(request.url);
    const archive = day && archivePath(day, slug);
    if (!archive || !(await backend.fileExists(archive))) error(404, 'Deleted post not found');
    const saved = JSON.parse(await backend.readFile(archive)) as { path: string; content: string };
    if (saved.path !== `src/content/blog/${day}-${slug}.md`) invalid('Invalid archived path');
    if (await backend.fileExists(saved.path)) error(409, 'Post already exists');
    await backend.createOrUpdateFile(saved.path, saved.content, `Undelete post: ${slug}`);
    await backend.deleteFile(archive, `Remove restored archive: ${slug}`);
    return;
  }
  const file = await findPost(backend, request.url);
  const slug = file.slug;
  const source = await backend.readFile(file.path);
  if (request.action === 'delete') {
    // Write the recovery copy first. If removing the live file fails, the
    // original still exists and retrying deletion is safe.
    await backend.createOrUpdateFile(
      archivePath(file.date, slug),
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
  if (post.properties['mp-slug']) post.properties['mp-slug'] = [slug];
  await backend.createOrUpdateFile(
    file.path,
    generateMarkdownFile(post),
    `Update post: ${post.title || slug}`
  );
}
