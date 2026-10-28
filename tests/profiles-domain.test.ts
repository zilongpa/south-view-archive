import assert from 'node:assert/strict';
import test from 'node:test';
import {
  profileSchema,
  profileSubmissionSchema,
  type PersonProfile,
} from '../packages/validators/src/index';
import {
  convertArchiveProfiles,
  projectProfilesToArchive,
} from '../packages/db/src/profile-conversion';
import { fixtureArchive } from '../packages/db/src/fixtures';
export function profile(): PersonProfile {
  return {
    name: 'Person',
    tags: ['Community'],
    bodyMarkdown: 'A sourced biography.',
    bodySourceIds: ['s'],
    sources: [{ id: 's', title: 'Record', kind: 'link', url: 'https://example.org/record' }],
    locations: [],
  };
}
test('profile evidence validates every reference, unique identity, years and coordinates', () => {
  assert.deepEqual(profileSchema.parse(profile()), profile());
  for (const bad of [
    { ...profile(), bodySourceIds: [] },
    { ...profile(), bodySourceIds: ['missing'] },
    { ...profile(), birthYear: 2000, deathYear: 1900 },
    { ...profile(), sources: [...profile().sources, ...profile().sources] },
    {
      ...profile(),
      portrait: {
        url: 'https://example.org/a.jpg',
        alt: 'Person',
        credit: 'Creator',
        rights: 'Permission',
        sourceIds: [],
      },
    },
    {
      ...profile(),
      locations: [
        {
          id: 'l',
          name: 'Place',
          label: 'Worked',
          description: 'Connection',
          scope: 'atlanta',
          coordinates: [-84, 33],
          precision: 'verified',
          sourceIds: ['s'],
          coordinateSourceIds: [],
          locationNote: '',
        },
      ],
    },
  ])
    assert.equal(profileSchema.safeParse(bad).success, false);
  assert.equal(
    profileSubmissionSchema.safeParse({
      requestId: 'r',
      receiptToken: 'a'.repeat(64),
      personId: null,
      baseVersion: 1,
      profile: profile(),
      privateName: 'Private',
      email: 'a@example.org',
      publicCredit: 'Public',
      permission: true,
    }).success,
    false,
  );
});
test('conversion is deterministic and projection never resurrects removed legacy content', () => {
  const converted = convertArchiveProfiles(fixtureArchive);
  assert.deepEqual(converted, convertArchiveProfiles(fixtureArchive));
  assert.equal(converted.length, fixtureArchive.people.length);
  converted.forEach((p) => profileSchema.parse(p.profile));
  const first = converted[0]!;
  assert.equal(first.id, fixtureArchive.people[0]!.id);
  assert.match(
    first.profile.bodyMarkdown,
    new RegExp(fixtureArchive.people[0]!.summary.slice(0, 20)),
  );
  const changed = {
    ...first,
    profile: {
      ...first.profile,
      bodyMarkdown: 'Replacement body',
      locations: [],
      portrait: undefined,
      sources: [first.profile.sources[0]!],
      bodySourceIds: [first.profile.sources[0]!.id],
    },
  };
  const projected = projectProfilesToArchive([changed], fixtureArchive);
  assert.equal(projected.people[0]!.summary, 'Replacement body');
  assert.equal(projected.people[0]!.portrait, undefined);
  assert.equal(projected.relations.length, 0);
  assert.equal(projected.materials.length, 0);
  assert.equal(projected.contributions.length, 0);
});
test('migration preserves source provenance and public paragraph/story/photo credits', () => {
  const archive = structuredClone(fixtureArchive),
    person = archive.people[0]!;
  archive.credits.push({ id: 'author', displayName: 'Public Story Author', kind: 'community' });
  person.biography.push({
    text: 'Attributed community paragraph.',
    citations: [person.summaryCitations[0]!],
    creditIds: ['author'],
  });
  archive.sources[0]!.publisher = 'Original Repository';
  archive.sources[0]!.accessedAt = '2024-01-02';
  archive.contributions.push({
    id: 'story',
    featured: false,
    personId: person.id,
    relatedPersonIds: [],
    placeIds: [],
    eventDate: { kind: 'unknown' },
    kind: 'memory',
    title: 'Community recollection',
    body: 'Remembered details',
    context: 'Public context',
    creditId: 'author',
    sourceCreator: 'Recorder',
    narrator: 'Narrator',
    holdingInstitution: 'Archive',
    sourceIds: [person.summaryCitations[0]!.sourceId],
    photos: [
      {
        id: 'photo',
        url: '/api/community/media/photo',
        caption: 'Historical photograph',
        creator: 'Photographer',
        rights: 'Family permission',
        creditId: 'author',
        width: 800,
        height: 600,
      },
    ],
    publishedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  const converted = convertArchiveProfiles(archive)[0]!;
  assert.match(
    converted.profile.bodyMarkdown,
    /Attributed community paragraph\.\n\nPublic contribution by Public Story Author\./,
  );
  assert.match(converted.profile.bodyMarkdown, /Photographer; Family permission/);
  assert.equal(
    converted.profile.sources.find((s) => s.id === 'photo-photo')!.url,
    '/api/community/media/photo',
  );
  assert.match(
    converted.profile.sources.find((s) => s.id === archive.sources[0]!.id)!.locator!,
    /Original Repository/,
  );
  assert.match(
    converted.profile.sources.find((s) => s.id === archive.sources[0]!.id)!.locator!,
    /2024-01-02/,
  );
});

test('migration retains citation locators and names the person when content exceeds new limits', () => {
  const archive = structuredClone(fixtureArchive);
  archive.people[0]!.summaryCitations[0]!.locator = 'Page 47';
  const converted = convertArchiveProfiles(archive)[0]!;
  assert.match(
    converted.profile.sources.find(
      (s) => s.id === archive.people[0]!.summaryCitations[0]!.sourceId,
    )!.locator!,
    /Page 47/,
  );
  archive.people[0]!.summary = 'A'.repeat(20001);
  assert.throws(
    () => convertArchiveProfiles(archive),
    new RegExp(`Cannot convert legacy profile ${archive.people[0]!.id}`),
  );
});

test('profile identity and filter metadata obey shared editor and search limits', () => {
  for (const bad of [
    { ...profile(), name: 'N'.repeat(161) },
    { ...profile(), aliases: ['A'.repeat(161)] },
    { ...profile(), tags: ['T'.repeat(81)] },
    { ...profile(), sources: [{ ...profile().sources[0]!, title: 'S'.repeat(201) }] },
    { ...profile(), sources: [{ ...profile().sources[0]!, creator: 'C'.repeat(201) }] },
    {
      ...profile(),
      locations: [
        {
          id: 'place',
          name: 'L'.repeat(201),
          label: 'Connection',
          description: '',
          scope: 'cemetery',
          coordinates: null,
          precision: 'unmapped',
          sourceIds: ['s'],
          coordinateSourceIds: [],
          locationNote: '',
        },
      ],
    },
  ])
    assert.equal(profileSchema.safeParse(bad).success, false);
});

test('managed media URL references require explicit same-profile media identity', () => {
  const portrait = { alt: 'Person', credit: 'Creator', rights: 'Permission', sourceIds: ['s'] };
  for (const url of [
    '/api/profiles/media/private-file',
    'https://archive.example/api/profiles/media/private-file',
    '/api/profiles/media/%70rivate-file',
    '/api/profiles/media/private-file?download=1',
    '/api/profiles/media/',
    '/api/profiles/media/%zz',
    '/%61pi/profiles/media/%zz',
  ]) {
    assert.equal(
      profileSchema.safeParse({
        ...profile(),
        sources: [...profile().sources, { id: 'file', title: 'File', kind: 'attachment', url }],
      }).success,
      false,
    );
    assert.equal(
      profileSchema.safeParse({ ...profile(), portrait: { ...portrait, url } }).success,
      false,
    );
    assert.equal(
      profileSchema.safeParse({ ...profile(), bodyMarkdown: `Biography [file](${url})` }).success,
      false,
    );
  }
  const source = {
    id: 'file',
    title: 'File',
    kind: 'attachment' as const,
    mediaId: 'public-file',
    url: '/api/profiles/media/public-file',
  };
  assert.equal(
    profileSchema.safeParse({
      ...profile(),
      sources: [...profile().sources, source],
      bodyMarkdown: 'Biography [file](/api/profiles/media/public-file)',
    }).success,
    true,
  );
  assert.equal(
    profileSchema.safeParse({
      ...profile(),
      sources: [...profile().sources, source],
      portrait: { ...portrait, url: '/api/profiles/media/public-file' },
    }).success,
    false,
    'portrait needs its own mediaId for image validation',
  );
  assert.equal(
    profileSchema.safeParse({
      ...profile(),
      portrait: { ...portrait, mediaId: 'public-file', url: '/api/profiles/media/public-file' },
    }).success,
    true,
  );
});

test('both displayed citation syntaxes reject removed source IDs', () => {
  for (const marker of ['[^missing]', '[source:missing]'])
    assert.equal(
      profileSchema.safeParse({ ...profile(), bodyMarkdown: `Biography ${marker}` }).success,
      false,
    );
  assert.equal(
    profileSchema.safeParse({ ...profile(), bodyMarkdown: 'Biography [source:s] and [^s]' })
      .success,
    true,
  );
});

test('coordinate archive issues live only in matching map locations while body note headings are readable', () => {
  const converted = convertArchiveProfiles(fixtureArchive);
  for (const issue of fixtureArchive.issues.filter((i) => /coordinates/i.test(i.field))) {
    const person = converted.find((p) => p.id === issue.personId)!;
    assert.equal(person.profile.bodyMarkdown.includes(issue.note), false);
    assert.equal(person.profile.bodyMarkdown.includes(issue.field), false);
    const cemetery = person.profile.locations.find((l) => l.scope === 'cemetery')!;
    assert.ok(cemetery.locationNote.includes(issue.note));
    for (const id of issue.sourceIds) assert.ok(cemetery.coordinateSourceIds.includes(id));
    const projected = projectProfilesToArchive([person], fixtureArchive);
    assert.ok(projected.places.some((p) => p.locationNote.includes(issue.note)));
  }
  const king = converted.find((p) => p.id === 'martin-luther-king-sr')!;
  assert.match(king.profile.bodyMarkdown, /Archive note: Oral history access/);
  assert.equal(king.profile.bodyMarkdown.includes('oralHistoryAccess'), false);
});
