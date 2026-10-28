import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createStore, setStoreForTests } from '@southview/db/connection';
import { GET, POST, PATCH } from '../apps/nextjs/src/app/api/profiles/[...path]/route';
const origin = 'http://localhost:3000';
function call(
  path: string,
  method = 'GET',
  body?: unknown,
  receipt?: string,
  requestOrigin = origin,
) {
  const headers = new Headers({ origin: requestOrigin });
  if (receipt) headers.set('X-Receipt-Token', receipt);
  if (body !== undefined && !(body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const request = new Request(`${origin}/api/profiles/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  return (method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST)(request, {
    params: Promise.resolve({ path: path.split('/') }),
  });
}
test('profile API submits once, isolates pending data, authenticates receipt and review, and enforces origins', async (t) => {
  const before = {
    ARCHIVE_DATA_MODE: process.env.ARCHIVE_DATA_MODE,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };
  Object.assign(process.env, {
    ARCHIVE_DATA_MODE: 'local',
    NODE_ENV: 'test',
    NEXT_PUBLIC_SITE_URL: origin,
  });
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  setStoreForTests(store);
  t.after(async () => {
    setStoreForTests(undefined);
    await store.close();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const token = randomBytes(48).toString('base64url');
  const input = {
    requestId: randomUUID(),
    receiptToken: token,
    personId: null,
    baseVersion: null,
    profile: {
      name: 'HTTP Example',
      tags: ['Educator'],
      bodyMarkdown: 'A sourced firsthand memory.',
      bodySourceIds: ['memory'],
      sources: [{ id: 'memory', title: 'Family recollection', kind: 'memory', creator: 'Family' }],
      locations: [],
    },
    privateName: 'Private Name',
    email: 'private@example.org',
    publicCredit: 'Family',
    permission: true,
  };
  const form = () => {
    const data = new FormData();
    data.set('payload', JSON.stringify(input));
    return data;
  };
  assert.equal(
    (await call('submissions', 'POST', form(), undefined, 'https://evil.example')).status,
    403,
  );
  const submitted = await call('submissions', 'POST', form());
  assert.equal(submitted.status, 201);
  const result = await submitted.json();
  assert.equal(result.status, 'pending');
  assert.ok(result.id);
  assert.equal((await (await call('published')).json()).profiles.length, 0);
  assert.equal((await call(`submissions/${result.id}`)).status, 404);
  const receipt = await call(`submissions/${result.id}`, 'GET', undefined, token);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).proposal.profile.name, input.profile.name);
  assert.equal((await call('submissions', 'POST', form())).status, 201);
  assert.equal((await store.query('SELECT id FROM community.profile_revisions')).rows.length, 1);
  assert.equal((await call('review')).status, 403);
  assert.equal((await call('mine')).status, 403);
  assert.equal(
    (
      await call(
        `review/${result.id}`,
        'PATCH',
        { profile: input.profile, proposalVersion: 1, baseVersion: null },
        token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(`review/${result.id}/approve`, 'POST', { proposalVersion: 1 }, token)).status,
    403,
  );
  assert.equal((await call(`review/${result.id}/vet`, 'GET', undefined, token)).status, 403);
  assert.equal((await call('history/fake')).status, 403);
  assert.equal((await call('media/fake')).status, 404);
  const invalid = form();
  invalid.set('payload', '{');
  assert.equal((await call('submissions', 'POST', invalid)).status, 400);
  const unavailable = form();
  unavailable.set(
    'payload',
    JSON.stringify({
      ...input,
      requestId: randomUUID(),
      profile: {
        ...input.profile,
        sources: [
          { id: 'memory', title: 'Unavailable record', kind: 'attachment', mediaId: 'missing' },
        ],
      },
    }),
  );
  assert.equal((await call('submissions', 'POST', unavailable)).status, 400);
  const tooLarge = new Request(`${origin}/api/profiles/submissions`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'multipart/form-data; boundary=x',
      'Content-Length': String(53 * 1024 * 1024),
    },
    body: '--x--',
  });
  assert.equal(
    (await POST(tooLarge, { params: Promise.resolve({ path: ['submissions'] }) })).status,
    413,
  );
});

test('reviewer HTTP edits, approval, accepted retries, rejection and history preserve exact versions and media privacy', async (t) => {
  const { mkdir, mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
  const { resolve, join } = await import('node:path');
  const { getAuth } = await import('@southview/services/auth');
  const { cleanupProfileMedia } = await import('@southview/services/profile-service');
  const root = resolve('.southview/tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'profile-http-'));
  const environment = {
    ARCHIVE_DATA_MODE: 'local',
    NODE_ENV: 'test',
    NEXT_PUBLIC_SITE_URL: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'test-only-secret-at-least-thirty-two-bytes',
    SOUTHVIEW_DATA_DIR: directory,
    PHOTO_STORAGE: 'local',
    MAIL_MODE: 'local',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  };
  const before = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  setStoreForTests(store);
  t.after(async () => {
    setStoreForTests(undefined);
    await store.close();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const auth = await getAuth();
  const authPost = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (
      await authPost('email-otp/send-verification-otp', {
        email: 'reviewer@example.org',
        type: 'sign-in',
      })
    ).status,
    200,
  );
  const names = await readdir(join(directory, 'outbox'));
  const letters = await Promise.all(
    names.map((name) => readFile(join(directory, 'outbox', name), 'utf8').then(JSON.parse)),
  );
  const letter = letters.find((item) => item.to === 'reviewer@example.org');
  assert.ok(letter);
  const signedIn = await authPost('sign-in/email-otp', {
    email: 'reviewer@example.org',
    otp: letter.text.match(/code is (\d{6})/)[1],
    name: 'Reviewer',
  });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const user = (await signedIn.json()).user;
  await store.query('INSERT INTO community.reviewers(user_id,granted_by) VALUES($1,$2)', [
    user.id,
    'test',
  ]);
  const staffCall = (path: string, method = 'GET', body?: unknown) => {
    const headers = new Headers({ Origin: origin, Cookie: cookie });
    if (body !== undefined && !(body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    const request = new Request(`${origin}/api/profiles/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    return (method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST)(request, {
      params: Promise.resolve({ path: path.split('/') }),
    });
  };
  const mediaId = randomUUID(),
    token = randomBytes(48).toString('base64url');
  const input = {
    requestId: randomUUID(),
    receiptToken: token,
    personId: null as string | null,
    baseVersion: null as number | null,
    profile: {
      name: 'Staff Example',
      tags: [],
      bodyMarkdown: 'A sourced archival record.',
      bodySourceIds: ['document'],
      sources: [{ id: 'document', title: 'Archival document', kind: 'attachment', mediaId }],
      locations: [],
    },
    privateName: 'Private Contributor',
    email: 'contributor@example.org',
    publicCredit: 'Family',
    permission: true,
  };
  const form = () => {
    const value = new FormData();
    value.set('payload', JSON.stringify(input));
    value.set(
      `file:${mediaId}`,
      new File(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'], 'evidence.pdf', {
        type: 'application/pdf',
      }),
    );
    return value;
  };
  const submitted = await call('submissions', 'POST', form());
  assert.equal(submitted.status, 201);
  const { id } = await submitted.json();
  assert.equal((await call(`media/${mediaId}`)).status, 404);
  const preview = await call(`media/${mediaId}`, 'GET', undefined, token);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-disposition') ?? '', /^attachment/);
  assert.equal((await (await staffCall('review')).json()).proposals.length, 1);
  const redactedMediaId = randomUUID();
  const reviewerProfile = {
    ...input.profile,
    sources: [
      ...input.profile.sources,
      {
        id: 'redacted',
        title: 'Staff redacted record',
        kind: 'attachment',
        mediaId: redactedMediaId,
      },
    ],
  };
  const reviewerForm = new FormData();
  reviewerForm.set(
    'payload',
    JSON.stringify({ profile: reviewerProfile, proposalVersion: 1, baseVersion: null }),
  );
  reviewerForm.set(
    `file:${redactedMediaId}`,
    new File(['%PDF-1.4\n%%EOF'], 'redacted.pdf', { type: 'application/pdf' }),
  );
  const multipartSaved = await staffCall(`review/${id}`, 'PATCH', reviewerForm);
  assert.equal(multipartSaved.status, 200);
  assert.equal((await multipartSaved.json()).proposal.proposalVersion, 2);
  assert.equal((await call(`media/${redactedMediaId}`)).status, 404);
  assert.equal((await staffCall(`media/${redactedMediaId}`)).status, 200);
  const edited = { ...reviewerProfile, bodyMarkdown: 'An edited sourced archival record.' };
  const saved = await staffCall(`review/${id}`, 'PATCH', {
    profile: edited,
    proposalVersion: 2,
    baseVersion: null,
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).proposal.proposalVersion, 3);
  assert.equal(
    (
      await staffCall(`review/${id}`, 'PATCH', {
        profile: edited,
        proposalVersion: 1,
        baseVersion: null,
      })
    ).status,
    409,
  );
  assert.equal(
    (await staffCall(`review/${id}/approve`, 'POST', { proposalVersion: 1 })).status,
    409,
  );
  assert.deepEqual(await (await staffCall(`review/${id}/vet`)).json(), { run: null });
  const approved = await staffCall(`review/${id}/approve`, 'POST', { proposalVersion: 3 });
  assert.equal(approved.status, 200);
  const publication = (await approved.json()).publication;
  assert.equal(publication.version, 1);
  assert.equal((await call(`media/${mediaId}`)).status, 200);
  const retry = await call('submissions', 'POST', form());
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).status, 'published');
  assert.equal(
    (await (await call(`submissions/${id}`, 'GET', undefined, token)).json()).publication.id,
    publication.id,
  );
  const history = await staffCall(`history/${publication.id}`);
  assert.equal(history.status, 200);
  assert.equal((await history.json()).versions.length, 1);
  const next = {
    ...input,
    requestId: randomUUID(),
    personId: publication.id,
    baseVersion: 1,
    profile: {
      ...edited,
      sources: [
        { id: 'document', title: 'Family recollection', kind: 'memory', creator: 'Family' },
      ],
    },
  };
  const nextForm = new FormData();
  nextForm.set('payload', JSON.stringify(next));
  const nextSubmit = await call('submissions', 'POST', nextForm);
  assert.equal(nextSubmit.status, 201);
  const nextId = (await nextSubmit.json()).id;
  assert.equal(
    (await staffCall(`review/${nextId}/approve`, 'POST', { proposalVersion: 1 })).status,
    200,
  );
  assert.equal((await call(`media/${mediaId}`)).status, 404);
  assert.deepEqual(await cleanupProfileMedia({ store }), { deleted: 0, failed: 0 });
  const restored = await staffCall(`history/${publication.id}/restore`, 'POST', {
    version: 1,
    currentVersion: 2,
  });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).publication.version, 3);
  assert.equal((await call(`media/${mediaId}`)).status, 200);
  const rejectedInput = { ...next, requestId: randomUUID(), personId: null, baseVersion: null };
  const rejectedForm = new FormData();
  rejectedForm.set('payload', JSON.stringify(rejectedInput));
  const rejected = (await (await call('submissions', 'POST', rejectedForm)).json()).id;
  assert.equal(
    (await staffCall(`review/${rejected}/reject`, 'POST', { proposalVersion: 2 })).status,
    409,
  );
  assert.equal(
    (await staffCall(`review/${rejected}/reject`, 'POST', { proposalVersion: 1 })).status,
    200,
  );
  assert.equal((await call(`submissions/${rejected}`, 'GET', undefined, token)).status, 404);
  const accountForm = new FormData();
  accountForm.set('payload', JSON.stringify({ ...rejectedInput, requestId: randomUUID() }));
  const accountSubmitted = await staffCall('submissions', 'POST', accountForm);
  assert.equal(accountSubmitted.status, 201);
  const accountId = (await accountSubmitted.json()).id;
  const accountPending = await (await staffCall('mine')).json();
  assert.equal(accountPending.proposals.length, 1);
  assert.deepEqual(accountPending.publications, []);
  assert.equal(
    (await staffCall(`review/${accountId}/approve`, 'POST', { proposalVersion: 1 })).status,
    200,
  );
  const accountAccepted = await (await staffCall('mine')).json();
  assert.deepEqual(accountAccepted.proposals, []);
  assert.equal(accountAccepted.publications.length, 1);
  assert.equal(accountAccepted.publications[0].submissionId, accountId);
  process.env.NODE_ENV = 'production';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://archive.example.org';
  assert.equal((await call('submissions', 'POST', form(), undefined, origin)).status, 403);
});
