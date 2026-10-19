import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createStore, projectRoot, setStoreForTests } from '@southview/db/connection';
import { getPublicContribution } from '@southview/db/community';
import { getAuth } from '@southview/services/auth';
import { getStorage } from '@southview/services/storage';
import { createUploadTicket } from '@southview/services/upload-ticket';
import { submissionInputSchema, photoMetadataSchema } from '@southview/validators';
import { GET, POST, PATCH } from '../apps/nextjs/src/app/api/community/[...path]/route';

const sharp = createRequire(new URL('../packages/services/package.json', import.meta.url))('sharp');
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
    params: Promise.resolve({ path: path.split('/') }),
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
async function draft(email = 'visitor@example.org') {
  const receipt = randomBytes(48).toString('base64url');
  const input = draftInput(email);
  const response = await call('submissions', 'POST', { input, receiptToken: receipt });
  assert.equal(response.status, 201);
  const result = await response.json();
  return { id: result.id as string, receipt, input };
}
async function photoForm(
  bytes: Buffer,
  metadata = JSON.stringify({
    caption: 'Family photograph',
    creator: 'Family collection',
    rights: 'Permission supplied by contributor',
    permission: true,
  }),
) {
  const form = new FormData();
  form.set('clientPhotoId', randomUUID());
  form.set('metadata', metadata);
  form.set(
    'file',
    new File([new Uint8Array(bytes)], 'untrusted-original-name.svg', { type: 'image/svg+xml' }),
  );
  return form;
}
async function signIn(directory: string, email: string, address: string) {
  const auth = await getAuth();
  const request = (path: string, body: unknown) =>
    new Request(`${origin}/api/auth/${path}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': address },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await auth.handler(request('email-otp/send-verification-otp', { email, type: 'sign-in' })))
      .status,
    200,
  );
  const letters = await Promise.all(
    (await readdir(join(directory, 'outbox'))).map(async (filename) =>
      JSON.parse(await readFile(join(directory, 'outbox', filename), 'utf8')),
    ),
  );
  const letter = letters.find(
    (letter) => letter.to === email && letter.subject === 'Your South-View sign-in code',
  );
  assert.ok(letter);
  const otp = letter.text.match(/code is (\d{6})/)?.[1];
  assert.ok(otp);
  const response = await auth.handler(
    request('sign-in/email-otp', { email, otp, name: 'Account Visitor', reviewer: true }),
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  return {
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
    userId: data.user.id as string,
  };
}

test('direct photo completion verifies receipt, ticket, metadata and image, then attaches only once', async (t) => {
  await setup(t);
  const item = await draft();
  const access = { receipt: item.receipt };
  const metadata = photoMetadataSchema.parse({
    caption: 'A test photo',
    creator: 'Test photographer',
    rights: 'Test permission',
    permission: true,
  });
  const bytes: Buffer = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#70513f' },
  })
    .png()
    .toBuffer();
  const clientPhotoId = randomUUID();
  const input = { clientPhotoId, metadata, size: bytes.length, contentType: 'image/png' };
  const path = `submissions/${item.id}/photos`;
  assert.equal((await call(`${path}/upload`, 'POST', input)).status, 404);
  assert.deepEqual(await (await call(`${path}/upload`, 'POST', input, access)).json(), {
    mode: 'proxy',
  });
  const { token, ticket } = await createUploadTicket({
    submissionId: item.id,
    photoId: clientPhotoId,
    size: bytes.length,
    contentType: 'image/png',
    metadata,
  });
  await getStorage().write(ticket.key, bytes, 'image/png');
  const complete = { clientPhotoId, metadata, ticket: token };
  assert.equal((await call(`${path}/complete`, 'POST', complete)).status, 404);
  assert.equal(
    (
      await call(
        `${path}/complete`,
        'POST',
        { ...complete, metadata: { ...metadata, caption: 'Tampered' } },
        access,
      )
    ).status,
    400,
  );
  assert.equal(
    (await call(`${path}/complete`, 'POST', { ...complete, ticket: token + 'x' }, access)).status,
    400,
  );
  const result = await call(`${path}/complete`, 'POST', complete, access);
  assert.equal(result.status, 201);
  const publicMetadata = await result.json();
  assert.equal(publicMetadata.photo.id, clientPhotoId);
  assert.equal(JSON.stringify(publicMetadata).includes('originals/'), false);
  assert.equal(await getStorage().read(ticket.key), null);
  assert.equal((await call(`${path}/complete`, 'POST', complete, access)).status, 200);
  assert.equal(
    (await (await call(`submissions/${item.id}`, 'GET', undefined, access)).json()).submission
      .photos.length,
    1,
  );
  assert.equal((await call(`media/${clientPhotoId}`)).status, 404);
  const badId = randomUUID();
  const bad = await createUploadTicket({
    submissionId: item.id,
    photoId: badId,
    size: 4,
    contentType: 'image/png',
    metadata,
  });
  await getStorage().write(bad.ticket.key, Buffer.from('oops'), 'image/png');
  assert.equal(
    (
      await call(
        `${path}/complete`,
        'POST',
        { clientPhotoId: badId, metadata, ticket: bad.token },
        access,
      )
    ).status,
    400,
  );
  assert.equal(await getStorage().read(bad.ticket.key), null);
});

test('community HTTP keeps draft text private and intact across invalid uploads and retries', async (t) => {
  const { store } = await setup(t);
  const item = await draft();
  const receipt = { receipt: item.receipt };
  assert.equal((await call(`submissions/${item.id}`)).status, 404);
  assert.equal(
    (await call(`submissions/${item.id}`, 'GET', undefined, { receipt: 'x'.repeat(64) })).status,
    404,
  );
  assert.equal((await call('mine')).status, 401);
  assert.equal((await call('review')).status, 403);
  assert.equal(
    (await call(`review/${item.id}`, 'POST', { action: 'publish' }, receipt)).status,
    403,
  );
  assert.equal((await call(`submissions/${item.id}/claim`, 'POST', {}, receipt)).status, 403);
  assert.equal(
    (
      await call(
        `submissions/${item.id}/submit`,
        'POST',
        {},
        { ...receipt, origin: 'https://attacker.example' },
      )
    ).status,
    403,
  );
  const invalid = await call(
    `submissions/${item.id}/photos`,
    'POST',
    await photoForm(Buffer.from('<svg>bad</svg>')),
    receipt,
  );
  assert.equal(invalid.status, 400);
  const invalidMetadata = await call(
    `submissions/${item.id}/photos`,
    'POST',
    await photoForm(Buffer.from('not an image'), '{broken'),
    receipt,
  );
  assert.equal(invalidMetadata.status, 400);
  const brokenMultipart = new Request(`${origin}/api/community/submissions/${item.id}/photos`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Receipt-Token': item.receipt,
      'Content-Type': 'multipart/form-data; boundary=missing',
    },
    body: 'malformed upload',
  });
  assert.equal(
    (
      await POST(brokenMultipart, {
        params: Promise.resolve({ path: ['submissions', item.id, 'photos'] }),
      })
    ).status,
    400,
  );
  const oversized = new Request(`${origin}/api/community/submissions/${item.id}/photos`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Receipt-Token': item.receipt,
      'Content-Length': String(12 * 1024 * 1024),
    },
    body: 'short actual body',
  });
  assert.equal(
    (
      await POST(oversized, {
        params: Promise.resolve({ path: ['submissions', item.id, 'photos'] }),
      })
    ).status,
    413,
  );
  const retained = await (await call(`submissions/${item.id}`, 'GET', undefined, receipt)).json();
  assert.equal(retained.submission.input.body, item.input.body);
  assert.equal(retained.submission.photos.length, 0);
  assert.equal(retained.submission.status, 'draft');
  const initial = await call(`submissions/${item.id}/submit`, 'POST', {}, receipt);
  assert.equal(initial.status, 200);
  const submitted = await initial.json();
  assert.equal(submitted.submission.status, 'pending');
  assert.equal(submitted.mailStatus, 'local');
  assert.ok(submitted.receiptUrl.endsWith(`#receipt=${item.receipt}`));
  assert.equal(await getPublicContribution(item.id), null);
  assert.equal((await call(`submissions/${item.id}/submit`, 'POST', {}, receipt)).status, 200);
  assert.equal(
    (await store.query('SELECT id FROM community.mail_events WHERE submission_id=$1', [item.id]))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await call(
        `submissions/${item.id}`,
        'PATCH',
        {
          input: {
            ...item.input,
            body: 'Attempt to alter submitted original after review begins.',
          },
        },
        receipt,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        `submissions/${item.id}/supplements`,
        'POST',
        { body: 'Here is additional private context.' },
        receipt,
      )
    ).status,
    200,
  );
  const finalResponse = await call(`submissions/${item.id}`, 'GET', undefined, receipt);
  assert.equal(finalResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal((await finalResponse.json()).submission.input.body, item.input.body);
});

test('community HTTP rejects production host spoofing and sends one receipt for concurrent finalization', async (t) => {
  const { store, directory } = await setup(t);
  const item = await draft();
  process.env.NODE_ENV = 'production';
  const spoofed = new Request('https://attacker.example/api/community/submissions', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: draftInput(),
      receiptToken: randomBytes(48).toString('base64url'),
    }),
  });
  assert.equal(
    (await POST(spoofed, { params: Promise.resolve({ path: ['submissions'] }) })).status,
    403,
  );
  process.env.NODE_ENV = 'test';
  const results = await Promise.all(
    [0, 1].map(() => call(`submissions/${item.id}/submit`, 'POST', {}, { receipt: item.receipt })),
  );
  assert.ok(results.every((result) => result.status === 200));
  const events = await store.query('SELECT id FROM community.mail_events WHERE submission_id=$1', [
    item.id,
  ]);
  assert.equal(events.rows.length, 1);
  const receipts = await Promise.all(
    (await readdir(join(directory, 'outbox'))).map(async (filename) =>
      JSON.parse(await readFile(join(directory, 'outbox', filename), 'utf8')),
    ),
  );
  assert.equal(
    receipts.filter((letter) => letter.subject === 'Your South-View contribution receipt').length,
    1,
  );
});

test('community HTTP verifies account claims and gates originals, review, publication, and withdrawal', async (t) => {
  const { store, directory } = await setup(t);
  const item = await draft('owner@example.org');
  const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#8c7654' } })
    .png()
    .toBuffer();
  const upload = await call(`submissions/${item.id}/photos`, 'POST', await photoForm(image), {
    receipt: item.receipt,
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  const photoId = uploadBody.photo.id as string;
  assert.equal(uploadBody.photo.originalKey, undefined);
  assert.equal(uploadBody.photo.publicKey, undefined);
  assert.equal((await call(`media/${photoId}`)).status, 404);
  assert.equal((await call(`submissions/${item.id}/photos/${photoId}`)).status, 404);
  assert.equal(
    (
      await call(`submissions/${item.id}/photos/${photoId}`, 'GET', undefined, {
        receipt: item.receipt,
      })
    ).status,
    200,
  );
  const owner = await signIn(directory, 'owner@example.org', '192.0.2.20');
  const other = await signIn(directory, 'other@example.org', '192.0.2.21');
  assert.equal((await call('review', 'GET', undefined, owner)).status, 403);
  assert.equal(
    (await call(`submissions/${item.id}/claim`, 'POST', {}, { ...other, receipt: item.receipt }))
      .status,
    403,
  );
  assert.equal((await call(`submissions/${item.id}/claim`, 'POST', {}, owner)).status, 403);
  assert.equal(
    (await call(`submissions/${item.id}/claim`, 'POST', {}, { ...owner, receipt: item.receipt }))
      .status,
    200,
  );
  assert.equal((await call(`submissions/${item.id}`, 'GET', undefined, other)).status, 404);
  const mine = await (await call('mine', 'GET', undefined, owner)).json();
  assert.equal(mine.submissions.length, 1);
  assert.equal(mine.submissions[0].photos[0].originalKey, undefined);
  assert.equal((await call(`submissions/${item.id}/submit`, 'POST', {}, owner)).status, 200);
  await store.query('INSERT INTO community.reviewers (user_id, granted_by) VALUES ($1, $2)', [
    other.userId,
    'test-operator',
  ]);
  const publish = {
    action: 'publish',
    newPersonName: 'Community Test Person',
    applyTo: 'entry',
    internalNote: 'Private staff deliberation',
    publicNote: 'A family memory, shared with permission.',
    approvedPhotoIds: [photoId],
  };
  const approved = await call(`review/${item.id}`, 'POST', publish, other);
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json();
  assert.equal(approvedBody.submission.status, 'published');
  assert.equal((await call(`review/${item.id}`, 'POST', publish, other)).status, 200);
  assert.equal(
    (await store.query('SELECT id FROM community.reviews WHERE submission_id=$1', [item.id])).rows
      .length,
    1,
  );
  const published = await getPublicContribution(approvedBody.entryId);
  assert.ok(published);
  const publicJSON = JSON.stringify(published);
  for (const privateValue of [
    item.input.email,
    item.input.privateName,
    item.receipt,
    'Private staff deliberation',
    'originals/',
    'processed/',
  ])
    assert.equal(publicJSON.includes(privateValue), false);
  const publicImage = await call(`media/${photoId}`);
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get('content-type'), 'image/jpeg');
  assert.equal(publicImage.headers.get('x-content-type-options'), 'nosniff');
  const ownerView = await (await call(`submissions/${item.id}`, 'GET', undefined, owner)).json();
  assert.equal(ownerView.submission.reviews[0].internalNote, undefined);
  assert.equal(ownerView.submission.reviews[0].reviewerId, undefined);
  assert.equal(
    (await call(`review/${item.id}`, 'POST', { action: 'withdraw' }, other)).status,
    200,
  );
  assert.equal(await getPublicContribution(approvedBody.entryId), null);
  assert.equal((await call(`media/${photoId}`)).status, 404);
  assert.equal(
    (await call(`submissions/${item.id}/photos/${photoId}`, 'GET', undefined, owner)).status,
    200,
  );
});
