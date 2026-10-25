import { error } from '@sveltejs/kit';
import matter from 'gray-matter';
import { AUTHOR_NAME, GITHUB_OWNER } from '$app/env/private';
import {
  HTML_CONTENT,
  frontMatterProperties,
  type MicropubProperties
} from '#lib/post-properties.ts';
import { requireEnvironmentVariable } from './env.ts';

export type { MicropubProperties };
export interface MicropubRequest {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface BlogPost {
  title: string;
  /** The Markdown body: the submitted content, exactly. */
  content: string;
  html: boolean;
  slug: string;
  date: string;
  published: boolean;
  author: string;
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
  error(400, message, { error: 'invalid_request' });
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
function validatePhoto(value: unknown) {
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
    'bookmark-of',
    'summary',
    'featured'
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
  let html = false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rich = value as { html?: unknown; text?: unknown };
    html = typeof rich.html === 'string';
    content =
      typeof rich.html === 'string' ? rich.html : typeof rich.text === 'string' ? rich.text : '';
  }
  // Photos and bookmarks stay properties; the blog renders them around the body.
  (properties.photo ?? []).forEach(validatePhoto);
  for (const bookmark of properties['bookmark-of'] ?? []) {
    let url: URL;
    try {
      url = new URL(bookmark as string);
    } catch {
      invalid('Bookmark URL must be absolute');
    }
    if (!['http:', 'https:'].includes(url.protocol)) invalid('Invalid bookmark URL scheme');
  }
  return {
    title,
    content,
    html,
    slug,
    date,
    published: postStatus === 'published',
    author:
      first(properties, 'author') ||
      AUTHOR_NAME ||
      requireEnvironmentVariable('GITHUB_OWNER', GITHUB_OWNER),
    properties
  };
}
/** Familiar keys first; any other property a client sent follows in its own order. */
const keyOrder = [
  'name',
  'published',
  'updated',
  'author',
  'summary',
  'featured',
  'category',
  'photo',
  'bookmark-of',
  'post-status',
  'visibility',
  'slug'
];
/** Properties that are lists by nature stay lists even with one value. */
const listProperties = new Set(['category', 'photo']);
/**
 * Every Micropub property is a top-level front matter key under its Micropub
 * name, and the body is the content. A single value is written as a scalar so
 * the file reads like ordinary front matter; reading wraps it back in an array.
 */
export function generateMarkdownFile(post: BlogPost): string {
  const { content: _content, ...rest } = post.properties;
  const properties: MicropubProperties = {
    ...rest,
    published: [post.date],
    // A client's own author (e.g. an h-card) wins over the configured name.
    author: rest.author?.length ? rest.author : [post.author],
    slug: [post.slug]
  };
  const keys = [
    ...keyOrder.filter((key) => key in properties),
    ...Object.keys(properties).filter((key) => !keyOrder.includes(key))
  ];
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const values = properties[key];
    if (!values.length) continue;
    data[key] = values.length === 1 && !listProperties.has(key) ? values[0] : values;
  }
  if (post.html) data['content-type'] = HTML_CONTENT;
  return matter.stringify(post.content + '\n', data);
}
export function readProperties(source: string): MicropubProperties {
  const { data, content } = matter(source);
  return normalizeProperties(frontMatterProperties(data, content));
}
export function generateFilePath(post: BlogPost): string {
  return `src/content/blog/${siteDateParts(post.date).day}-${post.slug}.md`;
}
export function generateCommitMessage(post: BlogPost, isUpdate = false): string {
  return `${isUpdate ? 'Update' : 'Add'} post: ${post.title || post.slug}`;
}
