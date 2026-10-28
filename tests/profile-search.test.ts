import assert from 'node:assert/strict';
import test from 'node:test';
import {
  searchProfiles,
  profileSearchInputSchema,
  profilePlainText,
} from '../packages/validators/src/profile-search';

function publication(id: string, name: string, body = '', updatedAt = '2026-10-01T00:00:00Z') {
  return {
    id,
    version: 1,
    updatedAt,
    profile: {
      name,
      tags: ['Civil rights'],
      birthYear: 1940,
      bodyMarkdown: body,
      bodySourceIds: ['source'],
      sources: [
        {
          id: 'source',
          title: 'Archive source',
          kind: 'link' as const,
          url: 'https://example.org/archive',
        },
      ],
      locations: [
        {
          id: 'home',
          name: 'Atlanta City Hall',
          label: 'Spoke here',
          description: 'A public address.',
          scope: 'atlanta' as const,
          coordinates: null,
          precision: 'unmapped' as const,
          sourceIds: ['source'],
          coordinateSourceIds: [],
          locationNote: '',
        },
      ],
    },
  };
}

test('profile search matches name, tags, places, metadata and full body, returning people only', () => {
  const data = [
    publication(
      'lewis',
      'John Lewis',
      'An early paragraph.\n\n## Recollection\nA remarkable lantern procession.',
    ),
    publication('other', 'Other Person', 'A different history.'),
  ];
  for (const q of [
    'John Lewis',
    'Civil rights',
    'Atlanta City Hall',
    '1940',
    'lantern procession',
  ]) {
    const results = searchProfiles(data, { q });
    assert.ok(
      results.items.some((p) => p.id === 'lewis'),
      q,
    );
    assert.ok(results.items.every((p) => 'profile' in p));
  }
  assert.match(searchProfiles(data, { q: 'lantern' }).items[0]!.excerpt, /lantern/);
  assert.equal(searchProfiles(data, { q: 'missing' }).total, 0);
});

test('profile filters intersect and normalize accents/case without interpreting HTML', () => {
  const a = publication('a', 'Renée Lewis', 'A neighborhood memory.');
  const b = publication('b', 'Other Person', 'A neighborhood memory.');
  b.profile.tags = ['Education'];
  b.profile.locations[0]!.name = 'South-View Cemetery';
  assert.deepEqual(
    searchProfiles([a, b], {
      q: 'neighborhood',
      name: 'renee',
      tag: 'civil RIGHTS',
      place: 'city hall',
    }).items.map((p) => p.id),
    ['a'],
  );
  assert.equal(searchProfiles([a, b], { tag: 'Education', place: 'city hall' }).total, 0);
  assert.equal(searchProfiles([a, b], { personId: 'a', placeId: 'a:home' }).total, 1);
  assert.equal(searchProfiles([a, b], { personId: 'a', placeId: 'b:home' }).total, 0);
  assert.equal(
    profilePlainText(
      '# History\n[Evidence](https://example.org) **bold** <script>alert(1)</script>',
    ),
    'History Evidence bold',
  );
});

test('profile search ranks names first and recent sorting uses publication time with stable pagination', () => {
  const rows = [
    publication('body', 'Another Person', 'John Lewis'),
    publication('name', 'John Lewis', 'History', '2026-10-20T00:00:00Z'),
  ];
  assert.equal(searchProfiles(rows, { q: 'John Lewis' }).items[0]!.id, 'name');
  assert.equal(searchProfiles(rows, { sort: 'recent' }).items[0]!.id, 'name');
  const many = Array.from({ length: 15 }, (_, n) =>
    publication(String(n).padStart(2, '0'), `Person ${String(n).padStart(2, '0')}`),
  );
  const first = searchProfiles(many, {});
  const second = searchProfiles(many, { page: 2 });
  assert.equal(first.items.length, 12);
  assert.equal(second.items.length, 3);
  assert.equal(first.totalPages, 2);
  assert.equal(searchProfiles(many, { page: 99 }).page, 2);
  assert.equal(searchProfiles([], { page: 9 }).page, 1);
  assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 15);
  assert.throws(() => profileSearchInputSchema.parse({ q: 'a'.repeat(201) }));
});

test('person aliases remain searchable after conversion', () => {
  const record = publication('a', 'John Lewis', 'History');
  const aliased = { ...record, profile: { ...record.profile, aliases: ['Congressman Lewis'] } };
  assert.equal(searchProfiles([aliased], { q: 'Congressman Lewis' }).total, 1);
  assert.equal(searchProfiles([aliased], { name: 'Congressman' }).total, 1);
});
