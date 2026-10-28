import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersonProfile } from '@southview/validators';
import {
  previewMediaUrls,
  profileMultipart,
  prepareProfileAttempt,
} from '../apps/nextjs/src/lib/profile-preview.ts';
const profile: PersonProfile = {
  name: 'A Person',
  tags: [],
  bodyMarkdown: 'A sourced life.',
  bodySourceIds: ['source'],
  sources: [{ id: 'source', title: 'Evidence', kind: 'attachment', mediaId: 'evidence' }],
  portrait: {
    mediaId: 'portrait',
    alt: 'Portrait',
    credit: 'Photographer',
    rights: 'Permission',
    sourceIds: ['source'],
  },
  locations: [],
};
const files = {
  portrait: new File(['portrait'], 'portrait.jpg', { type: 'image/jpeg' }),
  evidence: new File(['evidence'], 'evidence.pdf', { type: 'application/pdf' }),
  removed: new File(['private unused file'], 'unused.pdf', { type: 'application/pdf' }),
};
test('unsent file previews suppress server media requests until object URLs exist', () => {
  assert.deepEqual(previewMediaUrls(profile, files, {}), { portrait: '', evidence: '' });
  assert.deepEqual(previewMediaUrls(profile, files, { portrait: 'blob:local' }), {
    portrait: 'blob:local',
    evidence: '',
  });
});
test('guest pending preview waits for receipt-authorized object URLs', () => {
  assert.deepEqual(previewMediaUrls(profile, {}, {}, true), { portrait: '', evidence: '' });
  assert.deepEqual(previewMediaUrls(profile, {}, {}), {});
});
test('removing a portrait excludes its in-memory bytes from the actual submission', () => {
  const replacement = { ...profile, portrait: undefined };
  const payload = { profile: replacement, requestId: 'request' };
  const form = profileMultipart(payload, files, replacement);
  assert.equal(form.has('file:portrait'), false);
  assert.equal(form.has('file:removed'), false);
  assert.equal((form.get('file:evidence') as File).name, 'evidence.pdf');
  assert.deepEqual(JSON.parse(String(form.get('payload'))), JSON.parse(JSON.stringify(payload)));
});
test('removed evidence is never transmitted or exposed in preview', () => {
  const replacement = { ...profile, portrait: undefined, sources: [] };
  assert.deepEqual(previewMediaUrls(replacement, files, {}), {});
  assert.deepEqual(
    [...profileMultipart({ profile: replacement }, files, replacement).keys()],
    ['payload'],
  );
});

test('editing after a reserved upload fails renews every local media reference without reselecting files', () => {
  let sequence = 0;
  const nextId = () => `fresh-${++sequence}`;
  const details = {
    personId: null,
    baseVersion: null,
    profile,
    privateName: 'Private Name',
    email: 'person@example.org',
    publicCredit: 'Public Name',
    permission: true,
  };
  const first = prepareProfileAttempt(details, files, { id: '', token: '', signature: '' }, nextId);
  // A storage failure can leave all of these IDs reserved to the first request.
  const reserved = new Set(Object.keys(first.files));
  const edited = {
    ...details,
    profile: {
      ...first.details.profile,
      name: 'Corrected Name',
      bodyMarkdown: 'Corrected sourced life.',
    },
  };
  const second = prepareProfileAttempt(edited, first.files, first.request, nextId);
  assert.notEqual(second.request.id, first.request.id);
  assert.notEqual(second.request.token, first.request.token);
  const portraitId = second.details.profile.portrait!.mediaId!;
  const evidenceId = second.details.profile.sources[0]!.mediaId!;
  assert.ok(!reserved.has(portraitId));
  assert.ok(!reserved.has(evidenceId));
  assert.equal(second.files[portraitId], files.portrait);
  assert.equal(second.files[evidenceId], files.evidence);
  assert.deepEqual(second.details.profile.bodySourceIds, ['source']);
  assert.deepEqual(second.details.profile.portrait!.sourceIds, ['source']);
  assert.equal(second.details.profile.sources[0]!.id, 'source');
  const form = profileMultipart(
    { ...second.details, requestId: second.request.id, receiptToken: second.request.token },
    second.files,
    second.details.profile,
  );
  assert.ok(form.has(`file:${portraitId}`));
  assert.ok(form.has(`file:${evidenceId}`));
  assert.ok(!form.has('file:portrait'));
  assert.ok(!form.has('file:evidence'));
  assert.ok(!form.has('file:removed'));
  assert.equal(profile.portrait!.mediaId, 'portrait');
  const retry = prepareProfileAttempt(second.details, second.files, second.request, nextId);
  assert.deepEqual(retry.request, second.request);
  assert.equal(retry.details.profile, second.details.profile);
  assert.equal(retry.files, second.files);
});
test('renewed uploads preserve shared file references and existing published media IDs', () => {
  let sequence = 0;
  const nextId = () => `fresh-${++sequence}`;
  const shared = {
    ...profile,
    sources: [
      ...profile.sources,
      {
        id: 'portrait-source',
        title: 'Portrait evidence',
        kind: 'attachment' as const,
        mediaId: 'portrait',
      },
      {
        id: 'approved-source',
        title: 'Previously published evidence',
        kind: 'attachment' as const,
        mediaId: 'published-media',
      },
    ],
  };
  const details = {
    personId: 'person',
    baseVersion: 2,
    profile: shared,
    privateName: 'Name',
    email: 'person@example.org',
    publicCredit: 'Name',
    permission: true,
  };
  const renewed = prepareProfileAttempt(
    details,
    files,
    { id: 'reserved-request', token: 'old-token', signature: 'older-payload' },
    nextId,
  );
  assert.equal(
    renewed.details.profile.portrait!.mediaId,
    renewed.details.profile.sources[1]!.mediaId,
  );
  assert.equal(renewed.details.profile.sources[2]!.mediaId, 'published-media');
  assert.equal(Object.keys(renewed.files).length, 2);
});
