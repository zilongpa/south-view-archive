import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  prepareProfileFile,
  parseProfileSubmission,
  profileMediaResponse,
} from '@southview/services/profile-service';
import { contentTypeFor, validateStorageKey } from '@southview/services/storage';
import { prepareProfileVetText } from '@southview/services/profile-vet';
const sharp = createRequire(new URL('../packages/services/package.json', import.meta.url))('sharp');
const profile = () => ({
  name: 'Ada Example',
  tags: [],
  bodyMarkdown: 'A sourced recollection.',
  bodySourceIds: ['memory'],
  sources: [{ id: 'memory', title: 'Family recollection', kind: 'memory', creator: 'Family' }],
  locations: [],
});
const submission = () => ({
  requestId: randomUUID(),
  receiptToken: 'a'.repeat(64),
  personId: null,
  baseVersion: null,
  profile: profile(),
  privateName: 'Private Person',
  email: 'private@example.org',
  publicCredit: 'Family',
  permission: true,
});

test('profile files decode images and remove metadata; PDF allowed only for evidence', async () => {
  const input = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ccc' } })
    .withMetadata()
    .png()
    .toBuffer();
  const image = await prepareProfileFile(
    new File([input], 'photo.png', { type: 'image/png' }),
    true,
  );
  assert.equal(image.contentType, 'image/jpeg');
  assert.equal((await sharp(image.bytes).metadata()).exif, undefined);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  assert.equal(
    (await prepareProfileFile(new File([pdf], 'record.pdf', { type: 'application/pdf' }), false))
      .contentType,
    'application/pdf',
  );
  await assert.rejects(
    prepareProfileFile(new File([pdf], 'record.pdf', { type: 'application/pdf' }), true),
    /portrait/i,
  );
  await assert.rejects(
    prepareProfileFile(
      new File([Buffer.from('arbitrary')], 'image.jpg', { type: 'image/jpeg' }),
      false,
    ),
    /JPEG|PNG|WebP|PDF/,
  );
  await assert.rejects(
    prepareProfileFile(
      new File([Buffer.from('%PDF-1.4\ntruncated')], 'record.pdf', { type: 'application/pdf' }),
      false,
    ),
    /PDF/,
  );
  await assert.rejects(
    prepareProfileFile(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversize.pdf', { type: 'application/pdf' }),
      false,
    ),
    /10 MiB/,
  );
});

test('profile multipart rejects duplicate, unreferenced, excessive and mismatched fields before storage', async () => {
  const form = new FormData();
  form.set('payload', JSON.stringify(submission()));
  assert.deepEqual((await parseProfileSubmission(form)).submission.profile, profile());
  form.append(
    'file:orphan',
    new File(['%PDF-1.4\n%%EOF'], 'evidence.pdf', { type: 'application/pdf' }),
  );
  await assert.rejects(parseProfileSubmission(form), /referenced/);
  form.delete('file:orphan');
  form.append('payload', JSON.stringify(submission()));
  await assert.rejects(parseProfileSubmission(form), /payload/);
});

test('PDF private storage supports opaque keys and download safety headers', async () => {
  const key = `evidence/${randomUUID()}.pdf`;
  assert.equal(validateStorageKey(key), key);
  assert.equal(contentTypeFor(key), 'application/pdf');
  assert.throws(() => validateStorageKey('evidence/../../secret.pdf'));
  const response = profileMediaResponse({
    bytes: Buffer.from('%PDF-1.4\n%%EOF'),
    contentType: 'application/pdf',
  });
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="evidence.pdf"');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'");
});

test('full profile Vet covers body, portrait and locations while excluding private fields and unsafe URLs', () => {
  const input = submission();
  input.profile.bodyMarkdown =
    'Private Person says private@example.org. https://example.org/submissions/a#receipt=secret';
  const prepared = prepareProfileVetText(
    { ...input, id: 'proposal', proposalVersion: 1, createdAt: new Date().toISOString() },
    null,
  );
  assert.equal(prepared.text.includes('Private Person'), false);
  assert.equal(prepared.text.includes('private@example.org'), false);
  assert.equal(prepared.text.includes('receipt='), false);
  const parsed = JSON.parse(prepared.text);
  assert.equal(parsed.proposedProfile.name, 'Ada Example');
  assert.deepEqual(parsed.proposedProfile.bodySourceIds, ['memory']);
  assert.deepEqual(parsed.proposedProfile.locations, []);
});

test('profile media cleanup retries storage failures, expires abandoned reservations and retains accepted history', async (t) => {
  const { createStore } = await import('@southview/db/connection');
  const {
    createProfileRepository,
    registerProfileMedia,
    markProfileMediaReady,
    authorizeProfileMedia,
  } = await import('@southview/db/profiles');
  const { cleanupProfileMedia, submitProfileForm } = await import(
    '@southview/services/profile-service'
  );
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  t.after(() => store.close());
  const actor = { userId: null, email: null, reviewer: false, receiptToken: 'a'.repeat(64) },
    reviewer = { userId: 'reviewer', email: 'reviewer@example.org', reviewer: true };
  const files = new Map<string, { bytes: Buffer; contentType: 'application/pdf' | 'image/jpeg' }>();
  let failDelete = true;
  const storage = {
    async write(key: string, bytes: Buffer, contentType: any) {
      files.set(key, { bytes, contentType });
    },
    async read(key: string) {
      return files.get(key) ?? null;
    },
    async delete(key: string) {
      if (failDelete) throw Error('offline');
      files.delete(key);
    },
  };
  const input = submission(),
    id = randomUUID();
  input.profile.sources = [
    { id: 'memory', title: 'Record', kind: 'attachment', mediaId: id } as any,
  ];
  const form = new FormData();
  form.set('payload', JSON.stringify(input));
  form.set(
    `file:${id}`,
    new File(['%PDF-1.4\n%%EOF'], 'evidence.pdf', { type: 'application/pdf' }),
  );
  const result = await submitProfileForm(form, actor, { store, storage });
  assert.equal(files.size, 1);
  const repository = createProfileRepository(store);
  await repository.reject(result.id, 1, reviewer);
  assert.equal(await authorizeProfileMedia(store, id, actor), null);
  assert.deepEqual(await cleanupProfileMedia({ store, storage }), { deleted: 0, failed: 1 });
  assert.equal(files.size, 1);
  failDelete = false;
  assert.deepEqual(await cleanupProfileMedia({ store, storage }), { deleted: 1, failed: 0 });
  assert.equal(files.size, 0);
  const orphan = randomUUID(),
    objectKey = `evidence/${randomUUID()}.pdf`;
  await registerProfileMedia(
    store,
    {
      id: orphan,
      requestId: randomUUID(),
      receiptToken: actor.receiptToken,
      objectKey,
      contentType: 'application/pdf',
      bytes: 16,
      originalName: 'orphan.pdf',
      sha256: '0'.repeat(64),
    },
    actor,
  );
  files.set(objectKey, { bytes: Buffer.from('%PDF-1.4\n%%EOF'), contentType: 'application/pdf' });
  await markProfileMediaReady(store, orphan, actor);
  await store.query("UPDATE community.profile_requests SET created_at=now()-interval '25 hours'");
  assert.deepEqual(await cleanupProfileMedia({ store, storage }), { deleted: 1, failed: 0 });
  assert.equal(files.size, 0);
});

test('profile Vet supplies PDF bytes and complete fields, records unread evidence, becomes stale and never publishes', async (t) => {
  const { createStore, setStoreForTests } = await import('@southview/db/connection');
  const { createProfileRepository } = await import('@southview/db/profiles');
  const { submitProfileForm } = await import('@southview/services/profile-service');
  const { runProfileVet, getProfileVet } = await import('@southview/services/profile-vet');
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  setStoreForTests(store);
  const previousKey = process.env.OPENAI_API_KEY,
    previousMode = process.env.ARCHIVE_DATA_MODE;
  process.env.OPENAI_API_KEY = 'fake-test-key';
  process.env.ARCHIVE_DATA_MODE = 'local';
  t.after(async () => {
    setStoreForTests(undefined);
    await store.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  });
  const actor = { userId: null, email: null, reviewer: false, receiptToken: 'a'.repeat(64) },
    reviewer = { userId: 'reviewer', email: 'reviewer@example.org', reviewer: true };
  const files = new Map<string, any>();
  const storage = {
    async write(key: string, bytes: Buffer, contentType: any) {
      files.set(key, { bytes, contentType });
    },
    async read(key: string) {
      return files.get(key) ?? null;
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
  const input = submission(),
    mediaId = randomUUID();
  input.profile.sources = [
    { id: 'memory', title: 'Selected record', kind: 'attachment', mediaId } as any,
  ];
  (input.profile as any).portrait = {
    url: 'https://example.org/photo.jpg',
    alt: 'Historical portrait',
    credit: 'Family',
    rights: 'Family permission',
    sourceIds: ['memory'],
  };
  const form = new FormData();
  form.set('payload', JSON.stringify(input));
  form.set(
    `file:${mediaId}`,
    new File(['%PDF-1.4\n%%EOF'], 'selected.pdf', { type: 'application/pdf' }),
  );
  const result = await submitProfileForm(form, actor, { store, storage });
  let requests = 0;
  const report = {
    summary: 'Human review needed.',
    spam_flag: false,
    claims: [],
    follow_up_questions: [],
    limitations: ['PDF text could not be read; not verified.'],
  };
  const client = {
    responses: {
      async create(request: any) {
        requests++;
        assert.equal(request.model, 'gpt-6-luna');
        assert.equal(request.store, false);
        const context = JSON.stringify(request.input);
        assert.equal(context.includes('private@example.org'), false);
        assert.equal(context.includes('Private Person'), false);
        assert.match(context, /input_file/);
        assert.match(context, /data:application\/pdf;base64/);
        assert.match(context, /proposedProfile/);
        return {
          status: 'completed',
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { type: 'search', sources: [] },
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(report), annotations: [] }],
            },
          ],
        };
      },
    },
  };
  const run = await runProfileVet(result.id, 1, reviewer, {
    store,
    storage,
    client: client as any,
  });
  assert.equal(requests, 1);
  assert.equal(run.status, 'completed');
  assert.equal(run.outdated, false);
  assert.equal((run.attachments[0] as any).status, 'provided');
  assert.ok(
    run.attachments.some(
      (item: any) => item.label === 'portrait-url' && item.status === 'unsupported',
    ),
  );
  assert.ok((run.report as any).limitations.some((item: string) => item.includes('portrait-url')));
  assert.equal((await store.query('SELECT * FROM archive.persons')).rows.length, 0);
  await createProfileRepository(store).save(
    result.id,
    { ...input.profile, bodyMarkdown: 'An updated sourced recollection.' },
    1,
    null,
    reviewer,
  );
  assert.equal((await getProfileVet(result.id, reviewer, store))?.outdated, true);
  await assert.rejects(
    runProfileVet(result.id, 1, reviewer, { store, storage, client: client as any }),
    /changed/,
  );
  assert.equal(requests, 1);
  files.clear();
  const failureClient = {
    responses: {
      async create() {
        throw Error('provider secret never saved');
      },
    },
  };
  const failed = await runProfileVet(result.id, 2, reviewer, {
    store,
    storage,
    client: failureClient as any,
  });
  assert.equal(failed.status, 'failed');
  assert.equal((failed.attachments[0] as any).status, 'unavailable');
  assert.equal(failed.error?.includes('provider secret'), false);
});
