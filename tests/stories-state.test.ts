import assert from 'node:assert/strict';
import test from 'node:test';
import { eventDateSchema, submissionInputSchema } from '../packages/validators/src/community';
import { restoreDraftEventDate } from '../apps/nextjs/src/lib/story-context';
import {
  parseStoriesState,
  storiesHref,
  withStoriesReturn,
  safeArchiveReturn,
} from '../apps/nextjs/src/lib/stories-state';

const origin = 'https://south-view.example';
function parseHref(href: string) {
  return parseStoriesState(Object.fromEntries(new URL(href, origin).searchParams));
}

test('stories URL parsing bounds profile filters and ignores obsolete content-type filters', () => {
  assert.deepEqual(parseStoriesState({}), {
    q: '',
    name: '',
    tag: 'all',
    place: '',
    personId: undefined,
    placeId: undefined,
    sort: 'relevance',
    page: 1,
  });
  const bounded = parseStoriesState({
    q: 'x'.repeat(1000),
    name: 'n'.repeat(500),
    tag: 'y'.repeat(500),
    personId: 'p'.repeat(500),
    placeId: 'l'.repeat(500),
    place: 'a'.repeat(500),
    page: '999999999',
    type: 'photo',
    featured: '1',
    sort: 'invalid',
  });
  assert.equal(bounded.q.length, 200);
  assert.equal(bounded.name.length, 160);
  assert.equal(bounded.tag.length, 80);
  assert.equal(bounded.place.length, 200);
  assert.equal(bounded.personId?.length, 120);
  assert.equal(bounded.placeId?.length, 250);
  assert.equal(bounded.page, 10000);
  assert.equal(bounded.sort, 'relevance');
  assert.equal('type' in bounded, false);
  assert.equal('featured' in bounded, false);
  for (const page of ['0', '-1', 'NaN', 'Infinity', '1.5', ''])
    assert.equal(parseStoriesState({ page }).page, 1);
  assert.deepEqual(
    parseStoriesState({ q: ['one', 'two'], name: ['a', 'b'], page: ['2', '3'] }),
    parseStoriesState({}),
  );
});

test('profile search filters and pagination survive refresh, sharing and clearing', () => {
  const state = parseStoriesState({
    q: 'family & church',
    name: 'John',
    tag: 'Civil Rights',
    personId: 'john-lewis',
    placeId: 'john-lewis:city-hall',
    place: 'Atlanta',
    sort: 'recent',
    page: '4',
  });
  const href = storiesHref(state);
  assert.deepEqual(parseHref(href), state);
  assert.equal(storiesHref(parseHref(href)), href);
  assert.deepEqual(parseHref(storiesHref(state, { page: 2 })), { ...state, page: 2 });
  const original = structuredClone(state);
  assert.deepEqual(
    parseHref(
      storiesHref(state, {
        q: '',
        name: '',
        tag: 'all',
        personId: undefined,
        placeId: undefined,
        place: '',
        page: 1,
      }),
    ),
    {
      ...state,
      q: '',
      name: '',
      tag: 'all',
      personId: undefined,
      placeId: undefined,
      place: '',
      page: 1,
    },
  );
  assert.deepEqual(state, original);
});

test('old theme URLs select tags and old record-type filters cannot hide people', () => {
  assert.equal(
    parseStoriesState({ theme: 'Community', type: 'story', featured: '1' }).tag,
    'Community',
  );
  assert.equal(
    new URL(storiesHref(parseStoriesState({ type: 'photo', featured: '1' })), origin).search,
    '',
  );
});

test('query punctuation and markup remain text instead of injecting filters', () => {
  const q = 'John &type=photo&personId=someone#<script>alert(1)</script>';
  const state = parseStoriesState({ q, tag: 'Arts + Music' });
  const url = new URL(storiesHref(state), origin);
  assert.equal(url.origin, origin);
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('q'), q);
  assert.equal(url.searchParams.has('personId'), false);
  assert.deepEqual(parseHref(url.href), state);
});

test('return links admit only local discovery/map routes and never carry a receipt fragment', () => {
  const blocked: unknown[] = [
    undefined,
    null,
    42,
    ['/stories'],
    'https://evil.example/stories',
    '//evil.example/stories',
    '/\\evil.example/stories',
    'javascript:alert(1)',
    '/people/john-lewis',
    '/api/community/submissions/private',
    '/stories/../sign-in',
    '/stories-extra',
    '/stories/',
    `/stories?q=${'x'.repeat(3000)}`,
  ];
  for (const value of blocked) assert.equal(safeArchiveReturn(value), '/stories', String(value));
  assert.equal(
    safeArchiveReturn('/stories?q=family&type=photo&page=3#receipt=private-secret'),
    '/stories?q=family&type=photo&page=3',
  );
  assert.equal(
    safeArchiveReturn('/explore?scope=atlanta&person=john-lewis&lng=-84.38&lat=33.75&z=13'),
    '/explore?scope=atlanta&person=john-lewis&lng=-84.38&lat=33.75&z=13',
  );
  assert.equal(safeArchiveReturn('/sign-in', '/explore'), '/explore');
});

test('record URLs carry the complete return state while preserving their source anchor', () => {
  const state = parseStoriesState({
    q: 'Herndon & family',
    type: 'material',
    theme: 'Community',
    sort: 'recent',
    page: '2',
  });
  const returnTo = storiesHref(state);
  const href = withStoriesReturn('/people/alonzo-herndon?from=old#source-herndon-home', returnTo);
  const url = new URL(href, origin);
  assert.equal(url.pathname, '/people/alonzo-herndon');
  assert.equal(url.hash, '#source-herndon-home');
  assert.equal(url.searchParams.getAll('from').length, 1);
  assert.equal(safeArchiveReturn(url.searchParams.get('from')), returnTo);
  assert.deepEqual(parseHref(safeArchiveReturn(url.searchParams.get('from'))), state);
});

function submissionWithDate(eventDate: unknown) {
  return submissionInputSchema.safeParse({
    clientRequestId: '245c2635-705b-4e8b-8d27-81b074d21884',
    kind: 'memory',
    personId: 'john-lewis',
    title: 'A family memory',
    body: 'A memory that should keep an unfinished date until its author is ready.',
    privateName: 'Private Contributor',
    email: 'private@example.org',
    anonymous: true,
    permission: true,
    eventDate,
  });
}

test('unfinished event-date drafts survive restoration but cannot become submitted or public dates', () => {
  const range = restoreDraftEventDate({ kind: 'range', startYear: 1960, endYear: 0 });
  assert.deepEqual(range, { kind: 'range', startYear: 1960, endYear: 0 });
  assert.equal(eventDateSchema.safeParse(range).success, false);
  assert.equal(submissionWithDate(range).success, false);
  const approximate = restoreDraftEventDate({ kind: 'approximate', year: 0 });
  assert.deepEqual(approximate, { kind: 'approximate', year: 0 });
  assert.equal(submissionWithDate(approximate).success, false);
  assert.deepEqual(
    restoreDraftEventDate({ kind: 'range', startYear: 1960, endYear: '<script>' }),
    range,
  );
  assert.deepEqual(restoreDraftEventDate({ kind: 'year', year: Number.POSITIVE_INFINITY }), {
    kind: 'year',
    year: 0,
  });
});

test('reversed ranges stay available for author correction rather than silently becoming unknown', () => {
  const saved = { kind: 'range' as const, startYear: 1970, endYear: 1960 };
  const restored = restoreDraftEventDate(saved);
  assert.deepEqual(restored, saved);
  assert.equal(eventDateSchema.safeParse(restored).success, false);
  assert.equal(submissionWithDate(restored).success, false);
  const corrected = { ...saved, endYear: 1975 };
  assert.deepEqual(restoreDraftEventDate(corrected), corrected);
  assert.equal(submissionWithDate(corrected).success, true);
  assert.deepEqual(saved, { kind: 'range', startYear: 1970, endYear: 1960 });
});
