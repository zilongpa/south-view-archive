import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseProfileMarkdown,
  safeProfileHref,
  tokenizeProfileInline,
} from '../apps/nextjs/src/lib/profile-markdown.ts';

test('profile Markdown keeps HTML as text and parses headings, paragraphs and lists', () => {
  assert.deepEqual(
    parseProfileMarkdown('# Life\n\n<script>alert(1)</script>\n\n- First\n- Second'),
    [
      { kind: 'heading', level: 2, text: 'Life' },
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
      { kind: 'list', ordered: false, items: ['First', 'Second'] },
    ],
  );
});
test('profile links reject script, data and protocol-relative destinations', () => {
  for (const href of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//evil.example',
    '/\\evil.example',
  ])
    assert.equal(safeProfileHref(href), undefined);
  assert.equal(safeProfileHref('https://example.org/source'), 'https://example.org/source');
  assert.equal(safeProfileHref('/materials/a'), '/materials/a');
});
test('inline sources retain stable IDs while arbitrary image embeds stay plain text', () => {
  const parts = tokenizeProfileInline('Life [^source-1] and ![image](https://example.org/a.png).');
  assert.ok(parts.some((part) => part.kind === 'citation' && part.value === 'source-1'));
  assert.ok(!parts.some((part) => part.kind === 'link'));
  assert.ok(parts.some((part) => part.value.includes('![image]')));
});
