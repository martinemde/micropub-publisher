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

export function inferPostType(properties: Record<string, unknown[]>): PostType {
  if (properties['bookmark-of']?.length) return 'bookmark';
  if (properties.photo?.length) return 'photo';
  return properties.name?.length ? 'article' : 'note';
}
