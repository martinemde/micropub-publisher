import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { JSDOM } from 'jsdom';

// Judge the publisher's actual output, independently of its parser and storage
// code. These are file-backed judgments, not claims about a deployed blog theme.
export function createJudge(appDir, fixtureDir) {
  const deleted = new Map();
  return async ({ number, id, requests }) => {
    const creation = requests.find(
      (entry) => entry.response.code === 201 && entry.response.location
    );
    assert(creation, 'Creation must succeed before manual verification');
    const slug = new URL(creation.response.location).pathname.split('/').at(-1);
    assert(/^[\w-]+$/.test(slug));
    const directory = join(appDir, 'src/content/blog');
    const files = (await readdir(directory)).filter((name) => name.endsWith(`-${slug}.md`));
    if (id === 'passed_delete') {
      assert.equal(files.length, 0, 'Deleted post must be absent from blog content');
      const archive = JSON.parse(
        await readFile(join(appDir, '.micropub/deleted', `${slug}.json`), 'utf8')
      );
      assert(
        matter(archive.content).data.micropub.properties.content?.length,
        'Recovery copy must contain original content'
      );
      deleted.set(number, archive.content);
      return 'Post file is absent from blog content; original content exists in the recovery archive.';
    }
    assert.equal(files.length, 1, 'Location must identify exactly one stored post');
    const source = await readFile(join(directory, files[0]), 'utf8');
    if (id === 'passed_undelete') {
      assert.equal(source, deleted.get(number), 'Restoration must preserve every byte');
      return 'Restored post exactly matches the archived original.';
    }
    const { data, content } = matter(source);
    assert.equal(data.published, true, 'Default posts must be marked published for the blog');
    const properties = data.micropub.properties;
    const initial = creation.request;
    let expected;
    if (initial.method === 'postjson') expected = JSON.parse(initial.body).properties;
    else {
      expected = {};
      const entries =
        initial.method === 'multipart'
          ? Object.entries(initial.params)
          : new URLSearchParams(initial.body);
      for (const [field, value] of entries) {
        const key = field.replace(/\[\]$/, '');
        if (['h', 'access_token'].includes(key)) continue;
        (expected[key] ??= []).push(value);
      }
    }
    if (id === 'passed_update') {
      // Explicit outcomes from the upstream cases, not a copy of the app's
      // update algorithm (which could reproduce the same bug).
      if (number === 400)
        expected.content = ['This is the updated text. If you can see this you passed the test!'];
      else if (number === 401) expected.category = ['test1', 'test2'];
      else if ([402, 403].includes(number)) expected.category = ['test1'];
      else if (number === 404) delete expected.category;
      else throw new Error(`No judgment defined for update case ${number}`);
    }
    for (const [key, value] of Object.entries(expected))
      assert.deepEqual(properties[key], value, `Stored ${key} must match submitted values`);
    assert(!Object.hasOwn(properties, 'access_token'));
    assert.deepEqual(
      data.categories ?? [],
      expected.category ?? [],
      'Blog categories must reflect source'
    );
    if (!expected.category) assert(!Object.hasOwn(properties, 'category'));
    const originalContent = expected.content?.[0];
    const text =
      typeof originalContent === 'string'
        ? originalContent
        : (originalContent?.html ?? originalContent?.text);
    assert(
      // Photos render above the caption, so the text follows any leading images.
      content
        .trim()
        .replace(/^(<img\b[^>]*>\s*)+/, '')
        .startsWith(text?.trim() ?? ''),
      'Published content must retain submitted text/HTML'
    );
    const dom = new JSDOM(content);
    try {
      if (id === 'passed_html') {
        assert(dom.window.document.querySelector('b, strong'), 'Bold HTML must be preserved');
        assert(dom.window.document.querySelector('i, em'), 'Italic HTML must be preserved');
      }
      if (properties.photo) {
        const images = [...dom.window.document.querySelectorAll('img')];
        assert.equal(images.length, properties.photo.length, 'Every photo must be rendered');
        for (const [i, photo] of properties.photo.entries()) {
          assert.equal(
            images[i].getAttribute('src'),
            typeof photo === 'string' ? photo : photo.value
          );
          assert.equal(
            images[i].getAttribute('alt'),
            typeof photo === 'string' ? '' : (photo.alt ?? '')
          );
        }
      }
      if (initial.method === 'multipart') {
        const names = Object.values(initial.files).flat();
        assert.equal(properties.photo.length, names.length);
        for (const [i, name] of names.entries()) {
          const filename = new URL(properties.photo[i]).pathname.split('/').at(-1);
          assert.deepEqual(
            await readFile(join(appDir, 'static/images/blog', filename)),
            await readFile(join(fixtureDir, 'public/media', name)),
            'Uploaded photo bytes must match fixture'
          );
        }
      }
    } finally {
      dom.window.close();
    }
    return `Verified ${files[0]}: submitted properties, blog categories, content/HTML and photo URLs/alt text${initial.method === 'multipart' ? ', including original uploaded bytes' : ''}.`;
  };
}
