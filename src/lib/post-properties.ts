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

// Unquoted YAML dates like `date: 2025-12-19` parse as UTC midnight. Keep them
// date-only so they stay on their own day instead of the Pacific day before.
const yamlDate = (date: Date) =>
  date.getTime() % 86_400_000 === 0 ? date.toISOString().slice(0, 10) : date.toISOString();

const values = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

export function frontMatterProperties(
  data: Record<string, unknown>,
  body: string
): MicropubProperties {
  const properties: MicropubProperties = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'content-type' || value === undefined || value === null) continue;
    properties[key] = values(value).map((item) => (item instanceof Date ? yamlDate(item) : item));
  }
  const text = body.replace(/^\r?\n/, '').trimEnd();
  if (text) properties.content = [data['content-type'] === HTML_CONTENT ? { html: text } : text];
  return properties;
}
