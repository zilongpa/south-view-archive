import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createStore, projectRoot, setStoreForTests } from '@southview/db/connection';
import { createDraft, attachPhoto } from '@southview/db/community';
import { getStorage } from '@southview/services/storage';
import { submissionInputSchema } from '@southview/validators';
import { GET, POST, PATCH } from '../apps/nextjs/src/app/api/community/[...path]/route';

const origin = 'http://127.0.0.1:3000';
const privateRoot = resolve(projectRoot(), '.southview', 'tests');
type Access = { receipt?: string; cookie?: string; origin?: string };
async function setup(t: TestContext) {
  await mkdir(privateRoot, { recursive: true });
  const directory = await mkdtemp(join(privateRoot, 'community-api-'));
  const environment = {
    NODE_ENV: 'test',
    ARCHIVE_DATA_MODE: 'local',
    SOUTHVIEW_DATA_DIR: directory,
    MAIL_MODE: 'local',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    PHOTO_STORAGE: 'local',
    BETTER_AUTH_URL: origin,
    NEXT_PUBLIC_SITE_URL: origin,
    BETTER_AUTH_SECRET: 'transport-test-secret-at-least-thirty-two-bytes',
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment);
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  setStoreForTests(store);
  t.after(async () => {
    setStoreForTests(undefined);
    await store.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.ok(resolve(directory).startsWith(privateRoot + sep));
    await rm(directory, { recursive: true, force: true });
  });
  return { store, directory };
}
function call(path: string, method = 'GET', body?: unknown, access: Access = {}) {
  const headers = new Headers({ Origin: access.origin ?? origin });
  if (access.receipt) headers.set('X-Receipt-Token', access.receipt);
  if (access.cookie) headers.set('Cookie', access.cookie);
  let requestBody: BodyInit | undefined;
  if (body instanceof FormData) requestBody = body;
  else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }
  const request = new Request(`${origin}/api/community/${path}`, {
    method,
    headers,
    body: requestBody,
  });
  return (method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST)(request, {
    params: Promise.resolve({ path: path.split('?')[0]!.split('/') }),
  });
}
function draftInput(email = 'visitor@example.org') {
  return submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'memory',
    personId: null,
    proposedPersonName: 'Community Test Person',
    title: 'A family memory',
    body: 'This is a privately submitted family memory, awaiting staff review.',
    privateName: 'Private Visitor Name',
    email,
    anonymous: true,
    displayName: '',
    permission: true,
  });
}

test('session exposes independent sign-in methods without credentials and fixture disables both', async (t) => {
  await setup(t);
  let response = await call('session');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  let session = await response.json();
  assert.deepEqual(session.signInMethods, { emailOtp: true, google: false });
  assert.equal(session.authAvailable, true);
  process.env.MAIL_MODE = 'disabled';
  process.env.GOOGLE_CLIENT_ID = 'south-view-test.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'private-google-test-secret';
  response = await call('session');
  const serialized = await response.text();
  session = JSON.parse(serialized);
  assert.deepEqual(session.signInMethods, { emailOtp: false, google: true });
  assert.equal(session.authAvailable, false);
  assert.equal(serialized.includes(process.env.GOOGLE_CLIENT_ID), false);
  assert.equal(serialized.includes(process.env.GOOGLE_CLIENT_SECRET), false);
  process.env.ARCHIVE_DATA_MODE = 'fixture';
  session = await (await call('session')).json();
  assert.deepEqual(session.signInMethods, { emailOtp: false, google: false });
  assert.equal(session.user, null);
});
test('retired contribution writes cannot create drafts, publish additions, or attach files', async (t) => {
  const { store } = await setup(t);
  for (const [path, method] of [
    ['submissions', 'POST'],
    ['submissions/missing', 'PATCH'],
    ['submissions/missing/submit', 'POST'],
    ['submissions/missing/photos', 'POST'],
    ['submissions/missing/supplements', 'POST'],
    ['review/missing', 'POST'],
  ] as const) {
    const response = await call(path, method, {
      action: 'publish',
      input: draftInput(),
      receiptToken: 'x'.repeat(64),
    });
    assert.equal(response.status, 410, `${method} ${path}`);
  }
  assert.equal((await store.query('SELECT id FROM community.submissions')).rows.length, 0);
  assert.equal((await store.query('SELECT id FROM community.profile_revisions')).rows.length, 0);
});

test('legacy transition queue and deletion require staff authorization', async (t) => {
  await setup(t);
  assert.equal((await call('review')).status, 403);
  assert.equal((await call('review/missing', 'POST', { action: 'reject' })).status, 403);
  assert.equal((await call('submissions/missing')).status, 404);
  assert.equal((await call('media/missing')).status, 404);
});

test('legacy transition writes reject cross-origin and spoofed production requests', async (t) => {
  await setup(t);
  assert.equal(
    (await call('review/missing', 'POST', { action: 'reject' }, { origin: 'https://evil.example' }))
      .status,
    403,
  );
  process.env.NODE_ENV = 'production';
  assert.equal(
    (
      await call(
        'review/missing',
        'POST',
        { action: 'reject' },
        { origin: 'http://attacker.example' },
      )
    ).status,
    403,
  );
});

test('legacy attachment downloads remain authorized and read-only for transition', async (t) => {
  await setup(t);
  const receipt = randomUUID() + randomUUID();
  const actor = { userId: null, email: null, reviewer: false, receiptToken: receipt };
  const draft = await createDraft(draftInput(), actor, receipt);
  const id = randomUUID();
  const originalKey = `originals/${randomUUID()}.jpg`;
  const publicKey = `processed/${randomUUID()}.jpg`;
  const storage = getStorage();
  await storage.write(originalKey, Buffer.from('private original'), 'image/jpeg');
  await storage.write(publicKey, Buffer.from('processed preview'), 'image/jpeg');
  await attachPhoto(
    draft.submission.id,
    {
      id,
      originalKey,
      publicKey,
      width: 1,
      height: 1,
      mimeType: 'image/jpeg',
      bytes: 16,
      caption: 'Legacy clipping',
      creator: 'Family',
      rights: 'Permission supplied',
      permission: true,
    },
    actor,
  );
  const path = `submissions/${draft.submission.id}/photos/${id}`;
  assert.equal((await call(path)).status, 404);
  assert.equal((await call(path, 'GET', undefined, { receipt: 'wrong'.repeat(20) })).status, 404);
  const preview = await call(path, 'GET', undefined, { receipt });
  assert.equal(preview.status, 200);
  assert.equal(await preview.text(), 'processed preview');
  const original = await call(`${path}?original=1`, 'GET', undefined, { receipt });
  assert.equal(original.status, 200);
  assert.equal(await original.text(), 'private original');
  assert.match(original.headers.get('content-disposition') || '', /^attachment/);
  assert.equal(original.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call(path, 'PATCH', {}, { receipt })).status, 410);
});
