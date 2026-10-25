import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';
import { privateEnv } from '#lib/test-helpers.ts';
import { generateMarkdownFile, parseMicropubRequest, readProperties } from './micropub.ts';

const generate = (properties: Record<string, unknown>) =>
  generateMarkdownFile(parseMicropubRequest({ properties }));

afterEach(() => {
  privateEnv.AUTHOR_NAME = undefined;
});

describe('post files', () => {
  it('writes each Micropub property as a top-level key and the content as the body', () => {
    privateEnv.AUTHOR_NAME = 'Martin Emde';
    const source = generate({
      name: ['A title'],
      content: ['Body text'],
      published: ['2026-09-20T10:15:00-07:00'],
      summary: ['Short'],
      featured: ['https://example.com/header.png'],
      category: ['one'],
      photo: [{ value: 'https://example.com/a.png', alt: 'A "quoted" photo' }],
      syndication: ['https://example.social/1']
    });
    const { data, content } = matter(source);
    expect(data).toEqual({
      name: 'A title',
      published: '2026-09-20T10:15:00-07:00',
      author: 'Martin Emde',
      summary: 'Short',
      featured: 'https://example.com/header.png',
      category: ['one'],
      photo: [{ value: 'https://example.com/a.png', alt: 'A "quoted" photo' }],
      slug: 'a-title',
      syndication: 'https://example.social/1'
    });
    expect(content).toBe('Body text\n');
    expect(Object.keys(data)[0]).toBe('name');
  });

  it('reads back every property it wrote', () => {
    const properties = {
      name: ['A title'],
      content: ['Body text'],
      published: ['2026-09-20T10:15:00-07:00'],
      category: ['a', 'b'],
      'bookmark-of': ['https://example.org/page'],
      'post-status': ['draft']
    };
    expect(readProperties(generate(properties))).toEqual({
      ...properties,
      author: ['test_owner'],
      slug: ['a-title']
    });
  });

  it('keeps HTML content as the body and marks it so the source query returns html', () => {
    const source = generate({ content: [{ html: '<p><b>Bold</b></p>' }] });
    expect(matter(source).data['content-type']).toBe('text/html');
    expect(matter(source).content).toBe('<p><b>Bold</b></p>\n');
    expect(readProperties(source).content).toEqual([{ html: '<p><b>Bold</b></p>' }]);
  });

  it('leaves photos and bookmarks out of the body for the blog to render', () => {
    const { content } = matter(
      generate({
        content: ['Caption'],
        photo: ['https://example.com/a.png'],
        'bookmark-of': ['https://example.org/page']
      })
    );
    expect(content.trim()).toBe('Caption');
  });

  it('reads files written with the earlier wrapper keys', () => {
    expect(
      readProperties(
        '---\ntitle: Old\ndate: 2025-12-19\ndescription: Short\nimage: /a.png\ncategories: [x]\npublished: true\nslug: old\n---\nBody\n'
      )
    ).toEqual({
      name: ['Old'],
      published: ['2025-12-19'],
      summary: ['Short'],
      featured: ['/a.png'],
      category: ['x'],
      slug: ['old'],
      'post-status': ['published'],
      content: ['Body']
    });
  });
});
