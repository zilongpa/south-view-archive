import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createStore, migrateStore } from '../packages/db/src/connection';
import {
  createProfileRepository,
  getPublishedProfile,
  readPublishedProfiles,
  registerProfileMedia,
  markProfileMediaReady,
  authorizeProfileMedia,
  listProfileCleanup,
  completeProfileCleanup,
  beginProfileVet,
  finishProfileVet,
  latestProfileVet,
} from '../packages/db/src/profiles';
import {
  profileSchema,
  type PersonProfile,
  type Actor,
  type ProfileSubmission,
} from '../packages/validators/src/index';
const guest: Actor = { userId: null, email: null, reviewer: false };
const staff: Actor = { userId: 'staff', email: 'staff@example.org', reviewer: true };
const profile = (): PersonProfile =>
  profileSchema.parse({
    name: 'New Person',
    tags: [],
    bodyMarkdown: 'Complete biography',
    bodySourceIds: ['s'],
    sources: [{ id: 's', title: 'Source', kind: 'link', url: 'https://example.org' }],
    locations: [],
  });
const input = (overrides: Partial<ProfileSubmission> = {}): ProfileSubmission => ({
  requestId: randomUUID(),
  receiptToken: 'a'.repeat(64),
  personId: null,
  baseVersion: null,
  profile: profile(),
  privateName: 'Private Contact',
  email: 'private@example.org',
  publicCredit: 'Public Author',
  permission: true,
  ...overrides,
});
test('profile transactions preserve pending privacy, exact versions, receipts and immutable restore', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    await migrateStore(store);
    const repo = createProfileRepository(store);
    const initial = await readPublishedProfiles(store);
    assert.equal(initial.length, 3);
    const sub = input();
    const result = await repo.submit(sub, guest);
    assert.equal(result.status, 'pending');
    assert.equal((await readPublishedProfiles(store)).length, 3);
    await assert.rejects(repo.get(result.id, guest));
    await assert.rejects(repo.list(guest));
    await assert.rejects(repo.approve(result.id, 1, guest));
    const owner = { ...guest, receiptToken: sub.receiptToken };
    assert.equal((await repo.get(result.id, owner)).id, result.id);
    assert.deepEqual(await repo.submit(sub, guest), result);
    await assert.rejects(
      repo.submit({ ...sub, profile: { ...sub.profile, name: 'Changed' } }, guest),
      { code: 'CONFLICT' },
    );
    const edited = await repo.save(result.id, { ...sub.profile, name: 'Reviewed' }, 1, null, staff);
    assert.equal(edited.proposalVersion, 2);
    await assert.rejects(repo.save(result.id, sub.profile, 1, null, staff), { code: 'CONFLICT' });
    await assert.rejects(repo.approve(result.id, 1, staff), { code: 'CONFLICT' });
    const published = await repo.approve(result.id, 2, staff);
    assert.equal(published.version, 1);
    assert.equal(published.profile.name, 'Reviewed');
    assert.deepEqual(await repo.submit(sub, guest), {
      id: result.id,
      personId: published.id,
      status: 'published',
      version: 1,
    });
    assert.equal((await repo.get(result.id, owner)).version, 1);
    assert.equal((await repo.list(staff)).length, 0);
    const a = input({
        personId: published.id,
        baseVersion: 1,
        profile: { ...profile(), name: 'Replacement' },
      }),
      b = input({ personId: published.id, baseVersion: 1 });
    const ar = await repo.submit(a, guest),
      br = await repo.submit(b, guest);
    const next = await repo.approve(ar.id, 1, staff);
    assert.equal(next.version, 2);
    await assert.rejects(repo.approve(br.id, 1, staff), { code: 'CONFLICT' });
    await repo.save(br.id, b.profile, 1, 2, staff);
    assert.equal((await repo.approve(br.id, 2, staff)).version, 3);
    await assert.rejects(repo.restore(published.id, 1, 2, staff), { code: 'CONFLICT' });
    const restored = await repo.restore(published.id, 1, 3, staff);
    assert.equal(restored.version, 4);
    assert.equal(restored.profile.name, 'Reviewed');
    assert.equal((await repo.history(published.id, staff)).length, 4);
    await assert.rejects(repo.history(published.id, guest));
    const rejected = await repo.submit(input(), guest);
    await repo.reject(rejected.id, 1, staff);
    await assert.rejects(repo.get(rejected.id, staff));
    assert.equal(
      (await store.query('SELECT * FROM community.profile_revisions WHERE id=$1', [rejected.id]))
        .rows.length,
      0,
    );
  } finally {
    await store.close();
  }
});
test('media references and vet lifecycle are private, stale-aware and deletion safe', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const repo = createProfileRepository(store),
      sub = input(),
      owner = { ...guest, receiptToken: sub.receiptToken };
    const media = {
      id: randomUUID(),
      requestId: sub.requestId,
      receiptToken: sub.receiptToken,
      objectKey: 'private/key',
      contentType: 'application/pdf',
      bytes: 100,
      originalName: 'evidence.pdf',
      sha256: 'a'.repeat(64),
    };
    await registerProfileMedia(store, media, guest);
    const withMedia = {
      ...sub,
      profile: {
        ...sub.profile,
        sources: [
          ...sub.profile.sources,
          { id: 'attachment', title: 'Evidence', kind: 'attachment' as const, mediaId: media.id },
        ],
      },
    };
    await assert.rejects(repo.submit(withMedia, guest));
    await markProfileMediaReady(store, media.id, owner);
    const pending = await repo.submit(withMedia, guest);
    assert.equal(await authorizeProfileMedia(store, media.id, guest), null);
    assert.ok(await authorizeProfileMedia(store, media.id, owner));
    const run = await beginProfileVet(store, pending.id, 1, staff, {
      model: 'test-model',
      promptVersion: '1',
    });
    await finishProfileVet(store, run.id, staff, {
      report: { assessment: 'test' },
      attachments: [],
      sources: [],
      error: null,
    });
    assert.equal((await latestProfileVet(store, pending.id, staff))!.outdated, false);
    await repo.save(
      pending.id,
      { ...sub.profile, sources: withMedia.profile.sources, name: 'Edited' },
      1,
      null,
      staff,
    );
    assert.equal((await latestProfileVet(store, pending.id, staff))!.outdated, true);
    const published = await repo.approve(pending.id, 2, staff);
    assert.ok(await authorizeProfileMedia(store, media.id, guest));
    const replacement = await repo.submit(input({ personId: published.id, baseVersion: 1 }), guest);
    await repo.approve(replacement.id, 1, staff);
    assert.equal(await authorizeProfileMedia(store, media.id, guest), null);
    assert.equal((await listProfileCleanup(store)).length, 0, 'accepted history protects media');
    const other = input();
    const exclusive = {
      ...media,
      id: randomUUID(),
      requestId: other.requestId,
      objectKey: 'exclusive',
    };
    await registerProfileMedia(store, exclusive, guest);
    await markProfileMediaReady(store, exclusive.id, {
      ...guest,
      receiptToken: other.receiptToken,
    });
    const rejected = await repo.submit(
      {
        ...other,
        profile: {
          ...other.profile,
          sources: [
            ...other.profile.sources,
            { id: 'attachment', title: 'Attachment', kind: 'attachment', mediaId: exclusive.id },
          ],
        },
      },
      guest,
    );
    await repo.reject(rejected.id, 1, staff);
    const cleanup = await listProfileCleanup(store);
    assert.deepEqual(
      cleanup.map((m) => m.id),
      [exclusive.id],
    );
    await completeProfileCleanup(store, exclusive.id);
    assert.equal(await authorizeProfileMedia(store, exclusive.id, staff), null);
  } finally {
    await store.close();
  }
});
test('accepted uploads retry, PDF portraits fail atomically and abandoned cleanup retries', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const repo = createProfileRepository(store),
      sub = input(),
      owner = { ...guest, receiptToken: sub.receiptToken };
    const file = {
      id: randomUUID(),
      requestId: sub.requestId,
      receiptToken: sub.receiptToken,
      objectKey: 'pdf',
      contentType: 'application/pdf',
      bytes: 100,
      originalName: 'e.pdf',
      sha256: 'b'.repeat(64),
    };
    await registerProfileMedia(store, file, guest);
    await markProfileMediaReady(store, file.id, owner);
    await assert.rejects(
      repo.submit(
        {
          ...sub,
          profile: {
            ...sub.profile,
            portrait: {
              mediaId: file.id,
              alt: 'Portrait',
              credit: 'Author',
              rights: 'Permission',
              sourceIds: ['s'],
            },
          },
        },
        guest,
      ),
    );
    assert.equal((await repo.list(staff)).length, 0);
    const valid = {
      ...sub,
      profile: {
        ...sub.profile,
        sources: [
          ...sub.profile.sources,
          { id: 'pdf', title: 'Evidence', kind: 'attachment' as const, mediaId: file.id },
        ],
      },
    };
    const pending = await repo.submit(valid, guest);
    await repo.approve(pending.id, 1, staff);
    assert.equal((await registerProfileMedia(store, file, guest)).ready, true);
    const abandoned = input();
    const unused = {
      ...file,
      id: randomUUID(),
      requestId: abandoned.requestId,
      objectKey: 'unused',
    };
    await registerProfileMedia(store, unused, guest);
    const { abandonProfileUploads, failProfileCleanup } = await import(
      '../packages/db/src/profiles'
    );
    await abandonProfileUploads(store, new Date(Date.now() + 1000));
    const claimed = await listProfileCleanup(store);
    assert.equal(claimed.length, 1);
    await failProfileCleanup(store, unused.id);
    assert.equal((await listProfileCleanup(store)).length, 1);
    await store.query(
      "UPDATE community.profile_media SET cleanup_claimed_at=now()-interval '20 minutes' WHERE id=$1",
      [unused.id],
    );
    assert.equal((await listProfileCleanup(store)).length, 1, 'crashed worker claim expires');
  } finally {
    await store.close();
  }
});
test('legacy transition deletion removes private content and queues only exclusive assets', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const { deleteLegacySubmission } = await import('../packages/db/src/profiles');
    const { submissionInputSchema } = await import('../packages/validators/src/index');
    const sub = submissionInputSchema.parse({
      clientRequestId: randomUUID(),
      kind: 'addition',
      personId: 'john-lewis',
      title: 'Legacy pending',
      body: 'A legacy story remains private pending review.',
      privateName: 'Private',
      email: 'private@example.org',
      permission: true,
      anonymous: false,
      displayName: 'Public',
    });
    // Seed the retired transition shape without invoking retired write routes.
    const id = randomUUID();
    await store.query(
      "INSERT INTO community.submissions(id,client_request_id,input,receipt_hash,status) VALUES($1,$2,$3::jsonb,$4,'pending')",
      [id, sub.clientRequestId, JSON.stringify(sub), 'a'.repeat(64)],
    );
    await store.query(
      'INSERT INTO community.contacts(submission_id,private_name,email) VALUES($1,$2,$3)',
      [id, 'Private', 'private@example.org'],
    );
    await store.query(
      'INSERT INTO community.photos(id,submission_id,data) VALUES($1,$2,$3::jsonb)',
      [
        randomUUID(),
        id,
        JSON.stringify({ originalKey: 'legacy-original', publicKey: 'legacy-public' }),
      ],
    );
    await assert.rejects(deleteLegacySubmission(id, guest, store));
    await deleteLegacySubmission(id, staff, store);
    assert.equal(
      (await store.query('SELECT * FROM community.contacts WHERE submission_id=$1', [id])).rows
        .length,
      0,
    );
    assert.deepEqual(
      new Set((await listProfileCleanup(store)).map((m) => m.objectKey)),
      new Set(['legacy-original', 'legacy-public']),
    );
  } finally {
    await store.close();
  }
});
test('parallel approvals create one exact version and canonical reads do not resurrect legacy content', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const repo = createProfileRepository(store);
    const current = (await readPublishedProfiles(store))[0]!;
    const sub = input({
      personId: current.id,
      baseVersion: current.version,
      profile: { ...profile(), name: 'Replacement without old places' },
    });
    const pending = await repo.submit(sub, guest);
    const decisions = await Promise.allSettled([
      repo.approve(pending.id, 1, staff),
      repo.approve(pending.id, 1, staff),
    ]);
    assert.equal(decisions.filter((r) => r.status === 'fulfilled').length, 1);
    const { readStoreArchive } = await import('../packages/db/src/database');
    for (let i = 0; i < 2; i++) {
      const projected = await readStoreArchive(store);
      const p = projected.people.find((p) => p.id === current.id)!;
      assert.equal(p.summary, 'Complete biography');
      assert.equal(p.biography.length, 0);
      assert.equal(p.portrait, undefined);
      assert.equal(projected.relations.filter((r) => r.personId === current.id).length, 0);
    }
    assert.equal((await repo.history(current.id, staff)).length, 2);
    const account = { ...guest, userId: 'owner' };
    const own = input();
    const accepted = await repo.submit(own, account);
    await repo.approve(accepted.id, 1, staff);
    assert.equal((await repo.minePublications(account)).length, 1);
    assert.equal((await repo.minePublications({ ...account, userId: 'someone-else' })).length, 0);
  } finally {
    await store.close();
  }
});

test('reviewer removing pending evidence revokes access and schedules deletion immediately', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const repo = createProfileRepository(store),
      sub = input(),
      owner = { ...guest, receiptToken: sub.receiptToken };
    const upload = {
      id: randomUUID(),
      requestId: sub.requestId,
      receiptToken: sub.receiptToken,
      objectKey: 'removed-evidence',
      contentType: 'application/pdf',
      bytes: 100,
      originalName: 'e.pdf',
      sha256: 'c'.repeat(64),
    };
    await registerProfileMedia(store, upload, guest);
    await markProfileMediaReady(store, upload.id, owner);
    const pending = await repo.submit(
      {
        ...sub,
        profile: {
          ...sub.profile,
          sources: [
            ...sub.profile.sources,
            { id: 'attachment', title: 'File', kind: 'attachment', mediaId: upload.id },
          ],
        },
      },
      guest,
    );
    await repo.save(pending.id, sub.profile, 1, null, staff);
    assert.equal(await authorizeProfileMedia(store, upload.id, owner), null);
    assert.deepEqual(
      (await listProfileCleanup(store)).map((m) => m.id),
      [upload.id],
    );
  } finally {
    await store.close();
  }
});

test('canonical conversion survives migrations twice and disk restart without resurrecting deleted fields', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'southview-profiles-'));
  const dbPath = join(dir, 'db');
  let store = await createStore({ mode: 'local', path: dbPath });
  try {
    await migrateStore(store);
    await migrateStore(store);
    const current = (await readPublishedProfiles(store))[0]!;
    const repo = createProfileRepository(store);
    const pending = await repo.submit(input({ personId: current.id, baseVersion: 1 }), guest);
    await repo.approve(pending.id, 1, staff);
    await store.close();
    store = await createStore({ mode: 'local', path: dbPath });
    const restored = await getPublishedProfile(current.id, store);
    assert.equal(restored!.version, 2);
    assert.deepEqual(restored!.profile.locations, []);
    assert.equal(restored!.profile.bodyMarkdown, 'Complete biography');
    assert.equal((await createProfileRepository(store).history(current.id, staff)).length, 2);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('publication failure rolls back person replacement and preserves pending proposal', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const current = (await readPublishedProfiles(store))[0]!,
      repo = createProfileRepository(store);
    const pending = await repo.submit(input({ personId: current.id, baseVersion: 1 }), guest);
    await store.exec(
      "CREATE FUNCTION community.fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated snapshot failure'; END $$; CREATE TRIGGER fail_snapshot BEFORE INSERT ON community.profile_versions FOR EACH ROW EXECUTE FUNCTION community.fail_snapshot();",
    );
    await assert.rejects(repo.approve(pending.id, 1, staff), /simulated snapshot failure/);
    assert.equal((await getPublishedProfile(current.id, store))!.version, 1);
    assert.equal((await repo.get(pending.id, staff)).id, pending.id);
    await store.exec(
      'DROP TRIGGER fail_snapshot ON community.profile_versions; DROP FUNCTION community.fail_snapshot();',
    );
    assert.equal((await repo.approve(pending.id, 1, staff)).version, 2);
  } finally {
    await store.close();
  }
});

test('URL aliases cannot publish another pending request media or missing legacy evidence', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const repo = createProfileRepository(store),
      a = input(),
      owner = { ...guest, receiptToken: a.receiptToken };
    const upload = {
      id: randomUUID(),
      requestId: a.requestId,
      receiptToken: a.receiptToken,
      objectKey: 'pending-private',
      contentType: 'application/pdf',
      bytes: 100,
      originalName: 'private.pdf',
      sha256: 'd'.repeat(64),
    };
    await registerProfileMedia(store, upload, guest);
    await markProfileMediaReady(store, upload.id, owner);
    const pending = await repo.submit(
      {
        ...a,
        profile: {
          ...a.profile,
          sources: [
            ...a.profile.sources,
            { id: 'file', title: 'Private', kind: 'attachment', mediaId: upload.id },
          ],
        },
      },
      guest,
    );
    for (const url of [
      `/api/profiles/media/${upload.id}`,
      `https://archive.example/api/profiles/media/${upload.id}`,
      '/api/community/media/missing-private',
      'https://archive.example/api/community/media/missing-private',
    ]) {
      for (const patch of [
        {
          sources: [
            ...profile().sources,
            { id: 'bypass', title: 'Bypass', kind: 'attachment' as const, url },
          ],
        },
        {
          portrait: {
            url,
            alt: 'Portrait',
            credit: 'Creator',
            rights: 'Permission',
            sourceIds: ['s'],
          },
        },
        { bodyMarkdown: `Biography [file](${url})` },
      ])
        await assert.rejects(
          repo.submit(
            input({ receiptToken: 'b'.repeat(64), profile: { ...profile(), ...patch } }),
            guest,
          ),
          { code: 'BAD_REQUEST' },
        );
    }
    await assert.rejects(
      repo.submit(
        input({
          receiptToken: 'b'.repeat(64),
          profile: {
            ...profile(),
            sources: [
              ...profile().sources,
              {
                id: 'file',
                title: 'File',
                kind: 'attachment',
                mediaId: upload.id,
                url: `/api/profiles/media/${upload.id}`,
              },
            ],
          },
        }),
        guest,
      ),
      { code: 'BAD_REQUEST' },
    );
    assert.equal((await repo.list(staff)).length, 1);
    assert.equal(await authorizeProfileMedia(store, upload.id, guest), null);
    await repo.reject(pending.id, 1, staff);
    assert.deepEqual(
      (await listProfileCleanup(store)).map((m) => m.id),
      [upload.id],
    );
  } finally {
    await store.close();
  }
});

test('public accepted versions expose chosen public credit without contact metadata', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const repo = createProfileRepository(store),
      sub = input({ publicCredit: 'Chosen Public Credit' }),
      pending = await repo.submit(sub, guest);
    const published = await repo.approve(pending.id, 1, staff);
    assert.equal(published.publicCredit, 'Chosen Public Credit');
    const publicRead = await getPublishedProfile(published.id, store);
    assert.equal(publicRead!.publicCredit, 'Chosen Public Credit');
    assert.equal(JSON.stringify(publicRead).includes(sub.email), false);
    assert.equal(JSON.stringify(publicRead).includes(sub.privateName), false);
    assert.equal(
      (await readPublishedProfiles(store)).find((p) => p.id === published.id)!.publicCredit,
      'Chosen Public Credit',
    );
  } finally {
    await store.close();
  }
});

test('legacy media URLs require an approved published photo and preserve valid relative evidence', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    await readPublishedProfiles(store);
    const repo = createProfileRepository(store),
      legacyId = randomUUID(),
      photoId = randomUUID(),
      entryId = randomUUID();
    await store.query(
      "INSERT INTO community.submissions(id,client_request_id,input,receipt_hash,status,published_entry_id) VALUES($1,$2,'{}'::jsonb,$3,'pending',NULL)",
      [legacyId, randomUUID(), 'e'.repeat(64)],
    );
    await store.query(
      'INSERT INTO community.photos(id,submission_id,data) VALUES($1,$2,$3::jsonb)',
      [
        photoId,
        legacyId,
        JSON.stringify({ mimeType: 'image/jpeg', publicKey: 'approved-photo-key' }),
      ],
    );
    const url = `/api/community/media/${photoId}`;
    const sourced = {
      ...profile(),
      sources: [
        ...profile().sources,
        { id: 'legacy', title: 'Legacy photo', kind: 'attachment' as const, url },
      ],
      bodyMarkdown: `Biography [approved photo](${url})`,
    };
    await assert.rejects(repo.submit(input({ profile: sourced }), guest), { code: 'BAD_REQUEST' });
    await store.query(
      "UPDATE community.submissions SET status='published',published_entry_id=$2 WHERE id=$1",
      [legacyId, entryId],
    );
    await assert.rejects(repo.submit(input({ profile: sourced }), guest), { code: 'BAD_REQUEST' });
    await store.query(
      'INSERT INTO archive.contributions(id,person_id,credit_id,data) VALUES($1,$2,$3,$4::jsonb)',
      [
        entryId,
        'john-lewis',
        'initial-compilation',
        JSON.stringify({
          id: entryId,
          personId: 'john-lewis',
          creditId: 'initial-compilation',
          photos: [{ id: photoId }],
        }),
      ],
    );
    const accepted = await repo.submit(input({ profile: sourced }), guest);
    assert.equal((await repo.approve(accepted.id, 1, staff)).profile.sources[1]!.url, url);
    await store.query(
      "UPDATE community.photos SET data=jsonb_set(data,'{mimeType}','\"application/pdf\"'::jsonb) WHERE id=$1",
      [photoId],
    );
    await assert.rejects(
      repo.submit(
        input({
          profile: {
            ...profile(),
            portrait: {
              url,
              alt: 'Portrait',
              credit: 'Creator',
              rights: 'Permission',
              sourceIds: ['s'],
            },
          },
        }),
        guest,
      ),
      { code: 'BAD_REQUEST' },
    );
  } finally {
    await store.close();
  }
});

test('exact converter note repair versions publication and proposals while preserving authored prose and immutable snapshots', async () => {
  const store = await createStore({ mode: 'local', path: 'memory://' });
  try {
    const { fixtureArchive } = await import('../packages/db/src/fixtures');
    const initial = (await readPublishedProfiles(store)).find((p) => p.id === 'john-lewis')!,
      issue = fixtureArchive.issues.find(
        (i) => i.personId === initial.id && i.field === 'burialCoordinates',
      )!;
    const fragment = `### Archive note: ${issue.field}\n\n${issue.note}`;
    const authored = 'An authored paragraph discussing burialCoordinates remains as written.';
    const old = {
      ...initial.profile,
      bodyMarkdown: `${initial.profile.bodyMarkdown}\n\n${fragment}\n\n${authored}`,
    };
    await store.query('UPDATE archive.persons SET data=$2::jsonb WHERE id=$1', [
      initial.id,
      JSON.stringify({ ...old, id: initial.id }),
    ]);
    await store.query(
      'UPDATE community.profile_versions SET profile=$2::jsonb WHERE person_id=$1 AND version=1',
      [initial.id, JSON.stringify(old)],
    );
    // Seed a pending copy before the corrective reader runs, as an earlier application release did.
    const requestId = randomUUID(),
      revisionId = randomUUID();
    await store.query(
      'INSERT INTO community.profile_requests(request_id,receipt_hash,revision_id,payload_hash) VALUES($1,$2,$3,$4)',
      [requestId, 'f'.repeat(64), revisionId, 'legacy-test'],
    );
    await store.query(
      'INSERT INTO community.profile_revisions(id,request_id,person_id,base_version,profile,private_name,email,public_credit) VALUES($1,$2,$3,1,$4::jsonb,$5,$6,$7)',
      [
        revisionId,
        requestId,
        initial.id,
        JSON.stringify(old),
        'Private',
        'private@example.org',
        'Public',
      ],
    );
    const repo = createProfileRepository(store);
    const fixed = await getPublishedProfile(initial.id, store);
    assert.equal(fixed!.version, 2);
    assert.equal(fixed!.profile.bodyMarkdown.includes(fragment), false);
    assert.ok(fixed!.profile.bodyMarkdown.includes(authored));
    assert.ok(
      fixed!.profile.locations
        .find((l) => l.scope === 'cemetery')!
        .locationNote.includes(issue.note),
    );
    const pending = await repo.get(revisionId, staff);
    assert.ok('proposalVersion' in pending);
    if ('proposalVersion' in pending) {
      assert.equal(pending.proposalVersion, 2);
      assert.equal(pending.baseVersion, 1);
      assert.equal(pending.profile.bodyMarkdown.includes(fragment), false);
    }
    await assert.rejects(repo.approve(revisionId, 1, staff), { code: 'CONFLICT' });
    assert.equal(
      (await getPublishedProfile(initial.id, store))!.version,
      2,
      'repair is idempotent',
    );
    const raw = (
      await store.query<{ profile: PersonProfile }>(
        'SELECT profile FROM community.profile_versions WHERE person_id=$1 AND version=1',
        [initial.id],
      )
    ).rows[0]!.profile;
    assert.ok(raw.bodyMarkdown.includes(fragment), 'original accepted snapshot remains immutable');
    const history = await repo.history(initial.id, staff);
    assert.equal(
      history.find((v) => v.version === 1)!.profile.bodyMarkdown.includes(fragment),
      false,
    );
    const restored = await repo.restore(initial.id, 1, 2, staff);
    assert.equal(restored.version, 3);
    assert.equal(restored.profile.bodyMarkdown.includes(fragment), false);
    assert.ok(restored.profile.bodyMarkdown.includes(authored));
    assert.equal((await getPublishedProfile(initial.id, store))!.version, 3);
  } finally {
    await store.close();
  }
});
