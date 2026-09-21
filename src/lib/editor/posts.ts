export type PostType = 'article' | 'note' | 'bookmark' | 'photo';
export interface Photo {
  value: string;
  alt: string;
}
export const postTypes: { type: PostType; name: string; description: string }[] = [
  { type: 'article', name: 'Article', description: 'A titled story with room to write.' },
  { type: 'note', name: 'Note', description: 'A quick thought. No title needed.' },
  { type: 'bookmark', name: 'Bookmark', description: 'Save a link and why it matters.' },
  { type: 'photo', name: 'Photo', description: 'Share images with a caption and alt text.' }
];

// Keep inference aligned with the blog's src/lib/utils/post-model.ts.
function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}
function text(value: unknown): string | undefined {
  return values(value)
    .find((item): item is string => typeof item === 'string' && !!item.trim())
    ?.trim();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function httpUrl(value: unknown): boolean {
  const url = text(value);
  if (!url) return false;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
function plainText(source: string): string {
  return source
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function inferPostType(properties: Record<string, unknown>, body = ''): PostType {
  if (httpUrl(properties['bookmark-of'])) return 'bookmark';
  if (
    values(properties.photo).some((photo) =>
      httpUrl(typeof photo === 'string' ? photo : record(photo).value)
    )
  )
    return 'photo';
  const originalContent = values(properties.content)[0];
  const originalText =
    typeof originalContent === 'string'
      ? originalContent
      : (text(record(originalContent).html) ?? text(record(originalContent).text));
  const content = plainText(originalText ?? body);
  const name = plainText(text(properties.name) ?? '');
  return name && content && !content.startsWith(name) ? 'article' : 'note';
}
