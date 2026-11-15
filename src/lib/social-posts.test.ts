import { describe, it, expect } from 'vitest';
import { X_LIMIT, composeXPost, xLength } from './social-posts.ts';

const permalink = 'https://example.com/2026/11/14/post';

describe('composeXPost', () => {
  it('ends a short note with its permalink', () => {
    expect(composeXPost({ content: ['Small thoughts.'] }, permalink)).toBe(
      `Small thoughts.\n\n${permalink}`
    );
  });

  it('introduces an article by name and summary', () => {
    expect(
      composeXPost({ name: ['A title'], summary: ['Short'], content: ['Long body'] }, permalink)
    ).toBe(`A title\n\nShort\n\n${permalink}`);
  });

  it('puts a bookmark’s URL before the permalink', () => {
    expect(
      composeXPost(
        { 'bookmark-of': ['https://example.org/page'], content: ['Worth reading.'] },
        permalink
      )
    ).toBe(`Worth reading.\n\nhttps://example.org/page\n\n${permalink}`);
  });

  it('cuts long text to fit, counting each URL as 23', () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const post = composeXPost({ content: [words] }, permalink);
    expect(xLength(post)).toBeLessThanOrEqual(X_LIMIT);
    expect(post).toMatch(new RegExp(`…\\n\\n${permalink}$`));
  });
});

describe('xLength', () => {
  it('counts URLs as 23 characters', () => {
    expect(xLength(`Hi ${'https://example.com/' + 'a'.repeat(100)}`)).toBe(3 + 23);
  });
});
