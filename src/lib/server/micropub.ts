import { error } from '@sveltejs/kit';
import matter from 'gray-matter';
import { env } from '$env/dynamic/private';
import { requireEnvironmentVariable } from './env';

export type MicropubProperties = Record<string, unknown[]>;
export interface MicropubRequest {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface BlogPost {
  title: string;
  content: string;
  slug: string;
  date: string;
  published: boolean;
  description?: string;
  author: string;
  categories?: string[];
  properties: MicropubProperties;
}
const reserved = new Set([
  'access_token',
  'h',
  'type',
  'action',
  'url',
  'replace',
  'add',
  'delete'
]);
export function invalid(message: string): never {
  error(400, { message, error: 'invalid_request' });
}
export function normalizeProperties(input: Record<string, unknown>): MicropubProperties {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !reserved.has(key) && (!key.startsWith('mp-') || key === 'mp-slug'))
      .map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
  );
}
export const SITE_TIME_ZONE = 'America/Los_Angeles';
/** The site's calendar day (YYYY-MM-DD) and clock time (HHMMSS) for a published date. */
export function siteDateParts(date: string): { day: string; time: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return { day: date, time: '000000' };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SITE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(new Date(date))
      .map(({ type, value }) => [type, value])
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}${parts.minute}${parts.second}`
  };
}
const first = (properties: MicropubProperties, key: string, fallback = ''): string => {
  const value = properties[key]?.[0];
  return typeof value === 'string' ? value : fallback;
};
const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
function photoMarkup(value: unknown): string {
  const photo =
    typeof value === 'string'
      ? { value, alt: '' }
      : (value as { value?: unknown; alt?: unknown } | null);
  if (!photo || typeof photo.value !== 'string') invalid('Invalid photo');
  let url: URL;
  try {
    url = new URL(photo.value);
  } catch {
    invalid('Photo URL must be absolute');
  }
  if (!['http:', 'https:'].includes(url.protocol)) invalid('Invalid photo URL scheme');
  return `<img src="${escapeAttribute(photo.value)}" alt="${escapeAttribute(typeof photo.alt === 'string' ? photo.alt : '')}" />`;
}
export function parseMicropubRequest(request: MicropubRequest): BlogPost {
  if (
    Object.hasOwn(request, 'properties') &&
    (!request.properties ||
      typeof request.properties !== 'object' ||
      Array.isArray(request.properties))
  )
    invalid('Expected properties object');
  if (
    request.type !== undefined &&
    (!Array.isArray(request.type) || request.type.length !== 1 || request.type[0] !== 'h-entry')
  )
    invalid('Only h-entry is supported');
  if (request.h !== undefined && request.h !== 'entry') invalid('Only h-entry is supported');
  const properties = normalizeProperties(request.properties ?? request);
  for (const key of [
    'name',
    'category',
    'published',
    'slug',
    'mp-slug',
    'description',
    'post-status',
    'bookmark-of'
  ]) {
    if (properties[key]?.some((value) => typeof value !== 'string')) invalid(`Invalid ${key}`);
  }
  const postStatus = first(properties, 'post-status', 'published');
  if (!['published', 'draft'].includes(postStatus) || (properties['post-status']?.length ?? 0) > 1)
    invalid('Invalid post-status');
  const title = first(properties, 'name');
  const date = first(properties, 'published', new Date().toISOString());
  if (!Number.isFinite(Date.parse(date))) invalid('Invalid published date');
  const suggestedSlug = first(properties, 'mp-slug');
  const rawSlug = suggestedSlug
    ? suggestedSlug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    : first(properties, 'slug');
  const slug =
    rawSlug ||
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    // Untitled posts are named for their publish time, e.g. /2026/07/21/134309.
    siteDateParts(date).time;
  if (!/^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/.test(slug)) invalid('Invalid slug');
  const value = properties.content?.[0];
  let content = typeof value === 'string' ? value : '';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rich = value as { html?: unknown; text?: unknown };
    content =
      typeof rich.html === 'string' ? rich.html : typeof rich.text === 'string' ? rich.text : '';
  }
  const photos = (properties.photo ?? []).map(photoMarkup);
  if (photos.length) content += `\n\n${photos.join('\n\n')}`;
  for (const bookmark of properties['bookmark-of'] ?? []) {
    let url: URL;
    try {
      url = new URL(bookmark as string);
    } catch {
      invalid('Bookmark URL must be absolute');
    }
    if (!['http:', 'https:'].includes(url.protocol)) invalid('Invalid bookmark URL scheme');
    const href = escapeAttribute(bookmark as string);
    content += `\n\n<a class="u-bookmark-of" href="${href}">${href}</a>`;
  }
  return {
    title,
    content,
    slug,
    date,
    published: postStatus === 'published',
    description: first(properties, 'description') || undefined,
    author: requireEnvironmentVariable('GITHUB_OWNER', env.GITHUB_OWNER),
    categories: properties.category?.filter((value): value is string => typeof value === 'string'),
    properties
  };
}
export function generateMarkdownFile(post: BlogPost): string {
  const data = Object.fromEntries(
    Object.entries({
      title: post.title || undefined,
      date: post.date,
      author: post.author,
      description: post.description,
      published: post.published,
      slug: post.slug,
      categories: post.categories,
      micropub: { type: ['h-entry'], properties: post.properties }
    }).filter(([, value]) => value !== undefined)
  );
  return matter.stringify(post.content + '\n', data);
}
export function readProperties(source: string): MicropubProperties {
  const { data, content } = matter(source);
  if (data.micropub?.properties) return normalizeProperties(data.micropub.properties);
  return normalizeProperties(
    Object.fromEntries(
      Object.entries({
        name: data.title,
        content,
        category: data.categories,
        slug: data.slug,
        published: data.date instanceof Date ? data.date.toISOString() : data.date,
        description: data.description,
        'post-status': data.published ? 'published' : 'draft'
      }).filter(([, value]) => value !== undefined)
    )
  );
}
export function generateFilePath(post: BlogPost): string {
  return `src/content/blog/${siteDateParts(post.date).day}-${post.slug}.md`;
}
export function generateCommitMessage(post: BlogPost, isUpdate = false): string {
  return `${isUpdate ? 'Update' : 'Add'} post: ${post.title || post.slug}`;
}
