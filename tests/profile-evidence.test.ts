import assert from 'node:assert/strict';
import test from 'node:test';
import { profileSchema, type PersonProfile } from '@southview/validators';
import {
  addBodySource,
  pruneEvidenceSources,
  evidenceSources,
  removeEvidence,
  setDirectEvidence,
} from '../apps/nextjs/src/lib/profile-evidence';

const profile = (): PersonProfile => ({
  name: 'A Person',
  tags: [],
  bodyMarkdown: 'A sourced life. [^body]',
  bodySourceIds: ['body'],
  sources: [
    { id: 'body', title: 'Biography', kind: 'link', url: 'https://example.org/bio' },
    { id: 'image', title: 'Portrait credit', kind: 'link', url: 'https://example.org/image' },
    { id: 'map', title: 'Map record', kind: 'link', url: 'https://example.org/map' },
  ],
  portrait: {
    url: 'https://example.org/portrait.jpg',
    alt: 'Portrait',
    credit: 'Archive',
    rights: 'Permission',
    sourceIds: ['image'],
  },
  locations: [
    {
      id: 'place',
      name: 'A Place',
      label: 'Lived here',
      description: 'A documented connection',
      scope: 'atlanta',
      coordinates: [-84.38, 33.75],
      precision: 'address',
      sourceIds: ['body'],
      coordinateSourceIds: ['map'],
      locationNote: 'Retained map note',
    },
  ],
});
test('body sources appear once and new body evidence is linked automatically', () => {
  const p = profile();
  assert.deepEqual(
    evidenceSources(p, 'body').map((s) => s.id),
    ['body'],
  );
  const next = addBodySource(p, {
    id: 'new',
    title: 'New evidence',
    kind: 'link',
    url: 'https://example.org/new',
  });
  assert.deepEqual(next.bodySourceIds, ['body', 'new']);
  assert.ok(profileSchema.safeParse(next).success);
  assert.equal(p.sources.length, 3);
});
test('a direct portrait source link changes image evidence without changing the selected image or biography', () => {
  const p = profile();
  const next = setDirectEvidence(
    p,
    'portrait',
    'image',
    { url: 'https://example.org/original' },
    () => 'unused',
  );
  assert.equal(next.portrait!.url, p.portrait!.url);
  assert.equal(next.sources.find((s) => s.id === 'image')!.url, 'https://example.org/original');
  assert.deepEqual(next.bodySourceIds, ['body']);
  assert.equal(p.sources[1]!.url, 'https://example.org/image');
  assert.ok(profileSchema.safeParse(next).success);
});
test('one direct location source satisfies the location evidence contract without another picker', () => {
  const p = profile();
  p.locations[0]!.sourceIds = [];
  p.locations[0]!.coordinateSourceIds = [];
  const next = setDirectEvidence(
    p,
    { locationId: 'place' },
    undefined,
    { url: 'https://example.org/place' },
    () => 'place-source',
  );
  assert.deepEqual(next.locations[0]!.sourceIds, ['place-source']);
  assert.deepEqual(next.locations[0]!.coordinateSourceIds, ['place-source']);
  assert.equal(next.locations[0]!.locationNote, 'Retained map note');
  assert.ok(profileSchema.safeParse(next).success);
});
test('uploading direct evidence retains media ownership references and replaces its old link', () => {
  const next = setDirectEvidence(
    profile(),
    'portrait',
    'image',
    { mediaId: 'clipping', fileName: 'clipping.pdf' },
    () => 'unused',
  );
  const source = next.sources.find((s) => s.id === 'image')!;
  assert.equal(source.kind, 'attachment');
  assert.equal(source.mediaId, 'clipping');
  assert.equal(source.url, undefined);
  assert.deepEqual(next.portrait!.sourceIds, ['image']);
  assert.ok(profileSchema.safeParse(next).success);
});
test('removing evidence clears its associations while retaining a source used by other fields', () => {
  const p = profile();
  const bodyRemoved = removeEvidence(p, 'body', 'body');
  assert.deepEqual(bodyRemoved.bodySourceIds, []);
  assert.equal(bodyRemoved.bodyMarkdown.includes('[^body]'), false);
  assert.ok(bodyRemoved.sources.some((s) => s.id === 'body')); // Still used by the location.
  const imageRemoved = removeEvidence(p, 'portrait', 'image');
  assert.deepEqual(imageRemoved.portrait!.sourceIds, []);
  assert.ok(!imageRemoved.sources.some((s) => s.id === 'image'));
  assert.deepEqual(
    evidenceSources(p, { locationId: 'place' }).map((s) => s.id),
    ['body', 'map'],
  );
});

test('removing a portrait or location drops its exclusive evidence and pending upload references', () => {
  const p = profile();
  const withFile = setDirectEvidence(
    p,
    'portrait',
    'image',
    { mediaId: 'unused-file', fileName: 'image.pdf' },
    () => 'unused',
  );
  const removed = pruneEvidenceSources({ ...withFile, portrait: undefined });
  assert.ok(!removed.sources.some((s) => s.mediaId === 'unused-file'));
  assert.ok(removed.sources.some((s) => s.id === 'body'));
  const removedPlace = pruneEvidenceSources({ ...p, locations: [] });
  assert.ok(!removedPlace.sources.some((s) => s.id === 'map'));
  assert.ok(removedPlace.sources.some((s) => s.id === 'image'));
});

test('changing a location link does not rewrite a source shared by the body', () => {
  const p = profile();
  const next = setDirectEvidence(
    p,
    { locationId: 'place' },
    'body',
    { url: 'https://example.org/new-place' },
    () => 'new-location-source',
  );
  assert.equal(next.sources.find((s) => s.id === 'body')!.url, 'https://example.org/bio');
  assert.ok(!next.locations[0]!.sourceIds.includes('body'));
  assert.ok(next.locations[0]!.sourceIds.includes('new-location-source'));
  assert.deepEqual(next.bodySourceIds, ['body']);
  assert.ok(profileSchema.safeParse(next).success);
});
test('replacement evidence does not inherit the previous source author and publication details', () => {
  const p = profile();
  p.sources[1] = { ...p.sources[1]!, creator: 'Previous author', locator: 'Previous publication' };
  const next = setDirectEvidence(
    p,
    'portrait',
    'image',
    { url: 'https://example.org/new-image' },
    () => 'unused',
  );
  const source = next.sources.find((s) => s.id === 'image')!;
  assert.equal(source.title, 'https://example.org/new-image');
  assert.equal(source.creator, undefined);
  assert.equal(source.locator, undefined);
});
