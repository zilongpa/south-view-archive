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

test('stories URL parsing bounds untrusted input and defaults ambiguous or invalid parameters', () => {
  assert.deepEqual(parseStoriesState({}), {
    q: '',
    type: 'all',
    theme: 'all',
    personId: undefined,
    placeId: undefined,
    sort: 'relevance',
    featured: false,
    page: 1,
  });
  const bounded = parseStoriesState({
    q: 'x'.repeat(1000),
    theme: 'y'.repeat(500),
    personId: 'p'.repeat(500),
    placeId: 'l'.repeat(500),
    page: '999999999',
    type: 'external',
    sort: 'malicious',
  });
  assert.equal(bounded.q.length, 200);
  assert.equal(bounded.theme.length, 80);
  assert.equal(bounded.personId?.length, 120);
  assert.equal(bounded.placeId?.length, 120);
  assert.equal(bounded.page, 10000);
  assert.equal(bounded.type, 'all');
  assert.equal(bounded.sort, 'relevance');
  for (const page of ['0', '-1', 'NaN', 'Infinity', '1.5', ''])
    assert.equal(parseStoriesState({ page }).page, 1);
  assert.deepEqual(
    parseStoriesState({
      q: ['private', 'public'],
      type: ['story', 'photo'],
      personId: ['one', 'two'],
      page: ['2', '3'],
    }),
    parseStoriesState({}),
  );
});

test('all public discovery filters and pagination survive refresh and sharing', () => {
  const state = parseStoriesState({
    q: 'family & church',
    type: 'story',
    theme: 'Civil Rights',
    personId: 'john-lewis',
    placeId: 'atlanta-city-hall',
    sort: 'recent',
    featured: '1',
    page: '4',
  });
  const href = storiesHref(state);
  assert.equal(new URL(href, origin).pathname, '/stories');
  assert.deepEqual(parseHref(href), state);
  assert.equal(storiesHref(parseHref(href)), href);
});

test('editorial selection is an explicit URL filter that can be cleared without losing the query', () => {
  const state = parseStoriesState({ q: 'family', type: 'story', featured: '1', page: '2' });
  assert.equal(state.featured, true);
  assert.equal(new URL(storiesHref(state), origin).searchParams.get('featured'), '1');
  const cleared = storiesHref(state, { featured: false, page: 1 });
  assert.equal(new URL(cleared, origin).searchParams.has('featured'), false);
  assert.deepEqual(parseHref(cleared), { ...state, featured: false, page: 1 });
  for (const featured of ['true', 'yes', '0', '', '1&personId=private'])
    assert.equal(parseStoriesState({ featured }).featured, false);
  assert.equal(parseStoriesState({ featured: ['1', '0'] }).featured, false);
});

test('tab changes and page navigation retain other filters without mutating the active state', () => {
  const state = parseStoriesState({
    q: 'family photograph',
    type: 'story',
    theme: 'Community',
    personId: 'john-lewis',
    placeId: 'city-hall',
    sort: 'recent',
    page: '3',
  });
  const copy = structuredClone(state);
  assert.deepEqual(parseHref(storiesHref(state, { type: 'photo', page: 1 })), {
    ...state,
    type: 'photo',
    page: 1,
  });
  assert.deepEqual(parseHref(storiesHref(state, { page: 4 })), { ...state, page: 4 });
  assert.deepEqual(
    parseHref(
      storiesHref(state, { q: '', theme: 'all', personId: undefined, placeId: undefined, page: 1 }),
    ),
    { ...state, q: '', theme: 'all', personId: undefined, placeId: undefined, page: 1 },
  );
  assert.deepEqual(state, copy);
});

test('query punctuation and markup remain query text instead of injecting filters or fragments', () => {
  const q = 'John &type=photo&personId=someone#<script>alert("x")</script>';
  const state = parseStoriesState({ q, type: 'story', theme: 'Arts + Music' });
  const url = new URL(storiesHref(state), origin);
  assert.equal(url.origin, origin);
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('q'), q);
  assert.deepEqual(url.searchParams.getAll('type'), ['story']);
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
