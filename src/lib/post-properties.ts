/**
 * Post files keep their Micropub properties as top-level front matter, named as
 * Micropub names them (name, published, summary, featured, category, photo,
 * bookmark-of, post-status, …), and the Markdown body is the `content`. This
 * module turns parsed front matter back into properties. It is pure, so the
 * editor can read a post the same way the Micropub endpoint does.
 */
export type MicropubProperties = Record<string, unknown[]>;

/** Front matter `content-type: text/html` marks a body submitted as `content.html`. */
export const HTML_CONTENT = 'text/html';

/** Keys the blog wrote before its front matter used Micropub names. */
const legacyNames: Record<string, string> = {
  title: 'name',
  date: 'published',
  description: 'summary',
  image: 'featured',
  categories: 'category',
  tags: 'category'
};

// Unquoted YAML dates like `date: 2025-12-19` parse as UTC midnight. Keep them
// date-only so they stay on their own day instead of the Pacific day before.
const yamlDate = (date: Date) =>
  date.getTime() % 86_400_000 === 0 ? date.toISOString().slice(0, 10) : date.toISOString();

const values = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

export function frontMatterProperties(
  data: Record<string, unknown>,
  body: string
): MicropubProperties {
  const block = (data.micropub as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (block && typeof block === 'object') {
    // Files written before the properties moved to the top level.
    const properties = Object.fromEntries(
      Object.entries(block).map(([key, value]) => [key, values(value)])
    );
    // Clients may omit published on creation. Preserve the date we stored instead
    // of assigning today's date when that post is edited later.
    const date = data.date instanceof Date ? yamlDate(data.date) : data.date;
    if (!properties.published?.length && date !== undefined) properties.published = [date];
    // Wrapper keys fill gaps; an absent name stays untitled whatever `title` says.
    for (const [key, name] of Object.entries({ ...legacyNames, slug: 'slug' })) {
      if (key === 'title' || key === 'date' || properties[name]?.length) continue;
      if (data[key] !== undefined && data[key] !== null) properties[name] = values(data[key]);
    }
    if (!properties['post-status']?.length && typeof data.published === 'boolean')
      properties['post-status'] = [data.published ? 'published' : 'draft'];
    return properties;
  }
  // A boolean `published` was the old draft flag; Micropub's is the publish time.
  const legacy = typeof data.published === 'boolean' || 'title' in data || 'date' in data;
  const properties: MicropubProperties = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'content-type' || value === undefined || value === null) continue;
    if (legacy && key === 'published') continue;
    const name = legacy ? (legacyNames[key] ?? key) : key;
    const list = values(value).map((item) => (item instanceof Date ? yamlDate(item) : item));
    properties[name] = [...(properties[name] ?? []), ...list];
  }
  if (legacy) properties['post-status'] = [data.published === true ? 'published' : 'draft'];
  const text = body.replace(/^\r?\n/, '').trimEnd();
  if (text) properties.content = [data['content-type'] === HTML_CONTENT ? { html: text } : text];
  return properties;
}
