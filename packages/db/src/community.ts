import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  submissionInputSchema,
  reviewInputSchema,
  photoMetadataSchema,
  contributionEntrySchema,
  personSchema,
  placeSchema,
  relationSchema,
  sourceSchema,
  type Actor,
  type SubmissionInput,
  type SubmissionPhoto,
  type SubmissionRecord,
  type ReviewInput,
  type ContributionEntry,
  type Person,
  type Source,
} from '@southview/validators';
import { getStore, type Store } from './connection';

export class DomainError extends Error {
  constructor(
    public readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'READ_ONLY',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
type SubmissionRow = {
  id: string;
  client_request_id: string;
  input: SubmissionInput;
  receipt_hash: string;
  user_id: string | null;
  status: SubmissionRecord['status'];
  published_entry_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  mail_status: string | null;
};
type ReviewRow = {
  id: string;
  reviewer_id: string;
  action: string;
  decision: ReviewInput;
  created_at: Date | string;
};
const privateSubmissionSelect = `SELECT s.id, s.client_request_id, s.receipt_hash, s.user_id, s.status, s.published_entry_id, s.created_at, s.updated_at, s.mail_status, s.input || jsonb_build_object('privateName', c.private_name, 'email', c.email) AS input FROM community.submissions s JOIN community.contacts c ON c.submission_id=s.id`;
function withoutContact(input: SubmissionInput) {
  const { privateName: _privateName, email: _email, ...content } = input;
  return content;
}
const iso = (value: Date | string) => new Date(value).toISOString();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const notFound = () =>
  new DomainError('NOT_FOUND', 'This contribution is unavailable or the receipt is invalid.');
function validReceipt(token: string | undefined, expected: string) {
  if (!token || token.length < 64 || token.length > 256) return false;
  const candidate = Buffer.from(hash(token), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
function requireReviewer(actor: Actor) {
  if (!actor.reviewer || !actor.userId)
    throw new DomainError('FORBIDDEN', 'A reviewer account is required.');
}
async function writableStore() {
  if (process.env.ARCHIVE_DATA_MODE === 'fixture')
    throw new DomainError(
      'READ_ONLY',
      'The fixture preview is read-only. Use local or database mode to contribute.',
    );
  return getStore();
}
async function rowFor(tx: Store, id: string, actor: Actor, lock = false) {
  const row = (
    await tx.query<SubmissionRow>(
      `${privateSubmissionSelect} WHERE s.id = $1${lock ? ' FOR UPDATE OF s' : ''}`,
      [id],
    )
  ).rows[0];
  if (
    !row ||
    !(
      actor.reviewer ||
      (actor.userId && row.user_id === actor.userId) ||
      validReceipt(actor.receiptToken, row.receipt_hash)
    )
  )
    throw notFound();
  return row;
}
async function recordFor(tx: Store, row: SubmissionRow, actor: Actor): Promise<SubmissionRecord> {
  const photos = (
    await tx.query<{ data: SubmissionPhoto }>(
      'SELECT data FROM community.photos WHERE submission_id = $1 ORDER BY created_at, id',
      [row.id],
    )
  ).rows.map((item) => item.data);
  const supplements = (
    await tx.query<{ id: string; body: string; created_at: Date | string }>(
      'SELECT id, body, created_at FROM community.supplements WHERE submission_id = $1 ORDER BY created_at, id',
      [row.id],
    )
  ).rows.map((item) => ({ id: item.id, body: item.body, createdAt: iso(item.created_at) }));
  const reviews = (
    await tx.query<ReviewRow>(
      'SELECT id, reviewer_id, action, decision, created_at FROM community.reviews WHERE submission_id = $1 ORDER BY created_at, id',
      [row.id],
    )
  ).rows.map((item) => ({
    action: item.action,
    authorMessage: item.decision.authorMessage,
    publicNote: item.decision.publicNote,
    createdAt: iso(item.created_at),
    ...(actor.reviewer
      ? { internalNote: item.decision.internalNote, reviewerId: item.reviewer_id }
      : {}),
  }));
  return {
    id: row.id,
    // Defaults keep older stored originals readable without mutating their history.
    input: submissionInputSchema.parse(row.input),
    status: row.status,
    userId: row.user_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    photos,
    supplements,
    reviews,
    publishedEntryId: row.published_entry_id,
    ...(row.mail_status ? { mailStatus: row.mail_status } : {}),
  };
}
async function checkPerson(tx: Store, id: string) {
  const person = (
    await tx.query<{ data: Person }>(
      'SELECT data FROM archive.persons WHERE id = $1 FOR NO KEY UPDATE',
      [id],
    )
  ).rows[0]?.data;
  if (!person)
    throw new DomainError(
      'BAD_REQUEST',
      'Select an existing person or create a new person explicitly.',
    );
  return personSchema.parse(person);
}

async function checkLinkedRecords(
  tx: Store,
  input: { personId: string | null; relatedPersonIds: string[]; placeIds: string[] },
) {
  const people = [
    ...new Set([...(input.personId ? [input.personId] : []), ...input.relatedPersonIds]),
  ].sort();
  const places = [...new Set(input.placeIds)].sort();
  // Hold referenced identities until the draft/publication transaction commits.
  // Key-share locks allow other contributions to cite the same entities concurrently.
  for (const [table, ids, label] of [
    ['persons', people, 'person'],
    ['places', places, 'place'],
  ] as const) {
    if (!ids.length) continue;
    const rows = (
      await tx.query<{ id: string }>(
        `SELECT id FROM archive.${table} WHERE id = ANY($1::text[]) ORDER BY id FOR KEY SHARE`,
        [ids],
      )
    ).rows;
    const found = new Set(rows.map((row) => row.id));
    if (ids.some((id) => !found.has(id)))
      throw new DomainError(
        'BAD_REQUEST',
        `A linked ${label} is unavailable. Review the selected archive records.`,
      );
  }
}

export async function createDraft(raw: SubmissionInput, actor: Actor, receiptToken: string) {
  const input = submissionInputSchema.parse(raw);
  if (!/^[A-Za-z0-9_-]{64,256}$/.test(receiptToken))
    throw new DomainError('BAD_REQUEST', 'Generate a secure receipt before submitting.');
  const store = await writableStore();
  return store.transaction(async (tx) => {
    await checkLinkedRecords(tx, input);
    const id = randomUUID();
    const inserted = await tx.query(
      'INSERT INTO community.submissions (id, client_request_id, input, receipt_hash, user_id) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (client_request_id) DO NOTHING RETURNING id',
      [
        id,
        input.clientRequestId,
        JSON.stringify(withoutContact(input)),
        hash(receiptToken),
        actor.userId,
      ],
    );
    if (inserted.rows.length)
      await tx.query(
        'INSERT INTO community.contacts (submission_id, private_name, email) VALUES ($1,$2,$3)',
        [id, input.privateName, input.email],
      );
    const row = (
      await tx.query<SubmissionRow>(
        `${privateSubmissionSelect} WHERE s.client_request_id = $1 FOR UPDATE OF s`,
        [input.clientRequestId],
      )
    ).rows[0]!;
    if (!validReceipt(receiptToken, row.receipt_hash)) throw notFound();
    if (JSON.stringify(submissionInputSchema.parse(row.input)) !== JSON.stringify(input))
      throw new DomainError(
        'CONFLICT',
        'This receipt already belongs to a different original submission. Start a new contribution.',
      );
    return { submission: await recordFor(tx, row, { ...actor, receiptToken }), receiptToken };
  });
}

export async function getSubmission(id: string, actor: Actor) {
  const store = await writableStore();
  return store.transaction(async (tx) => recordFor(tx, await rowFor(tx, id, actor), actor));
}
export async function listSubmissions(actor: Actor): Promise<SubmissionRecord[]> {
  if (!actor.userId) return [];
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const rows = (
      await tx.query<SubmissionRow>(
        `${privateSubmissionSelect} WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
        [actor.userId],
      )
    ).rows;
    return Promise.all(rows.map((row) => recordFor(tx, row, { ...actor, reviewer: false })));
  });
}
export async function listReviewSubmissions(actor: Actor): Promise<SubmissionRecord[]> {
  requireReviewer(actor);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const rows = (
      await tx.query<SubmissionRow>(
        `${privateSubmissionSelect} WHERE s.status <> 'draft' ORDER BY s.updated_at DESC`,
      )
    ).rows;
    return Promise.all(rows.map((row) => recordFor(tx, row, actor)));
  });
}

export async function attachPhoto(id: string, photo: SubmissionPhoto, actor: Actor) {
  photoMetadataSchema.parse(photo);
  if (
    !/^[a-zA-Z0-9-]{1,100}$/.test(photo.id) ||
    !photo.originalKey ||
    !photo.publicKey ||
    !Number.isSafeInteger(photo.bytes) ||
    photo.bytes <= 0 ||
    !Number.isSafeInteger(photo.width) ||
    !Number.isSafeInteger(photo.height) ||
    photo.width <= 0 ||
    photo.height <= 0 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType)
  )
    throw new DomainError('BAD_REQUEST', 'The processed photo is invalid.');
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    if (row.status !== 'draft' && row.status !== 'needs-information')
      throw new DomainError(
        'CONFLICT',
        'Photos can be added to a draft or a requested supplement.',
      );
    const existing = (
      await tx.query<{ submission_id: string; data: SubmissionPhoto }>(
        'SELECT submission_id, data FROM community.photos WHERE id = $1',
        [photo.id],
      )
    ).rows[0];
    if (existing) {
      if (existing.submission_id !== id || !isDeepStrictEqual(existing.data, photo))
        throw new DomainError('CONFLICT', 'A photo with that identity is already stored.');
      return recordFor(tx, row, actor);
    }
    const count = (
      await tx.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM community.photos WHERE submission_id = $1',
        [id],
      )
    ).rows[0]!.count;
    if (count >= 5)
      throw new DomainError('BAD_REQUEST', 'A contribution can include at most five photos.');
    await tx.query(
      'INSERT INTO community.photos (id, submission_id, data) VALUES ($1, $2, $3::jsonb)',
      [photo.id, id, JSON.stringify(photo)],
    );
    await tx.query('UPDATE community.submissions SET updated_at = now() WHERE id = $1', [id]);
    return recordFor(tx, await rowFor(tx, id, actor), actor);
  });
}

export async function finalizeSubmission(id: string, actor: Actor) {
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    if (row.status === 'pending') return recordFor(tx, row, actor);
    if (row.status !== 'draft')
      throw new DomainError('CONFLICT', 'This contribution has already been submitted.');
    await checkLinkedRecords(tx, submissionInputSchema.parse(row.input));
    await tx.query(
      "UPDATE community.submissions SET status = 'pending', updated_at = now() WHERE id = $1",
      [id],
    );
    return recordFor(tx, await rowFor(tx, id, actor), actor);
  });
}
export async function updateDraft(id: string, raw: SubmissionInput, actor: Actor) {
  const input = submissionInputSchema.parse(raw);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    if (row.status !== 'draft')
      throw new DomainError(
        'CONFLICT',
        'Submitted originals are immutable. Add a supplement instead.',
      );
    if (input.clientRequestId !== row.client_request_id)
      throw new DomainError('BAD_REQUEST', 'The request identity cannot change.');
    await checkLinkedRecords(tx, input);
    await tx.query(
      'UPDATE community.submissions SET input=$2::jsonb, updated_at=now() WHERE id=$1',
      [id, JSON.stringify(withoutContact(input))],
    );
    await tx.query(
      'UPDATE community.contacts SET private_name=$2, email=$3 WHERE submission_id=$1',
      [id, input.privateName, input.email],
    );
    return recordFor(tx, await rowFor(tx, id, actor), actor);
  });
}
export async function removePhoto(
  id: string,
  photoId: string,
  actor: Actor,
): Promise<SubmissionPhoto | null> {
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    if (row.status !== 'draft')
      throw new DomainError('CONFLICT', 'Photos can be removed only before submission.');
    const result = await tx.query<{ data: SubmissionPhoto }>(
      'DELETE FROM community.photos WHERE id=$1 AND submission_id=$2 RETURNING data',
      [photoId, id],
    );
    await tx.query('UPDATE community.submissions SET updated_at=now() WHERE id=$1', [id]);
    return result.rows[0]?.data ?? null;
  });
}
export async function addSupplement(id: string, body: string, actor: Actor) {
  const content = body.trim();
  if (content.length < 3 || content.length > 20000)
    throw new DomainError('BAD_REQUEST', 'Write between 3 and 20,000 characters.');
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    if (!['pending', 'needs-information'].includes(row.status))
      throw new DomainError('CONFLICT', 'This contribution is not accepting supplements.');
    await tx.query(
      'INSERT INTO community.supplements (id, submission_id, body) VALUES ($1, $2, $3)',
      [randomUUID(), id, content],
    );
    await tx.query(
      "UPDATE community.submissions SET status = 'pending', updated_at = now() WHERE id = $1",
      [id],
    );
    return recordFor(tx, await rowFor(tx, id, actor), actor);
  });
}
export async function claimSubmission(id: string, actor: Actor) {
  if (!actor.userId || !actor.receiptToken || !actor.email)
    throw new DomainError(
      'FORBIDDEN',
      'Sign in with a verified email and provide this contribution’s receipt to link it to your account.',
    );
  const verifiedEmail = actor.email.trim().toLowerCase();
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    if (!validReceipt(actor.receiptToken, row.receipt_hash)) throw notFound();
    if (verifiedEmail !== row.input.email.trim().toLowerCase())
      throw new DomainError('FORBIDDEN', 'Use the verified email supplied with this contribution.');
    if (row.user_id && row.user_id !== actor.userId)
      throw new DomainError('CONFLICT', 'This contribution is already linked to another account.');
    await tx.query(
      'UPDATE community.submissions SET user_id = $2, updated_at = now() WHERE id = $1',
      [id, actor.userId],
    );
    return recordFor(tx, await rowFor(tx, id, actor), actor);
  });
}

type PublicTable = 'persons' | 'places' | 'person_places' | 'contributions' | 'sources' | 'credits';
async function saveProjection(
  tx: Store,
  submissionId: string,
  reviewId: string,
  table: PublicTable,
  data: { id: string } & Record<string, unknown>,
) {
  const previous =
    (
      await tx.query<{ data: unknown }>(
        `SELECT data FROM archive.${table} WHERE id = $1 FOR NO KEY UPDATE`,
        [data.id],
      )
    ).rows[0]?.data ?? null;
  await tx.query(
    'INSERT INTO community.publication_revisions (id, submission_id, review_id, target_table, target_id, previous_data, published_data) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
    [
      randomUUID(),
      submissionId,
      reviewId,
      table,
      data.id,
      previous === null ? null : JSON.stringify(previous),
      JSON.stringify(data),
    ],
  );
  if (table === 'contributions')
    await tx.query(
      'INSERT INTO archive.contributions (id, person_id, credit_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET person_id=EXCLUDED.person_id, credit_id=EXCLUDED.credit_id, data=EXCLUDED.data',
      [data.id, data.personId, data.creditId, JSON.stringify(data)],
    );
  else if (table === 'person_places')
    await tx.query(
      'INSERT INTO archive.person_places (id, person_id, place_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET person_id=EXCLUDED.person_id, place_id=EXCLUDED.place_id, data=EXCLUDED.data',
      [data.id, data.personId, data.placeId, JSON.stringify(data)],
    );
  else
    await tx.query(
      `INSERT INTO archive.${table} (id, data) VALUES ($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`,
      [data.id, JSON.stringify(data)],
    );
}

async function publish(tx: Store, row: SubmissionRow, review: ReviewInput, reviewId: string) {
  const input = submissionInputSchema.parse(row.input);
  const now = new Date().toISOString();
  const entryId = row.published_entry_id ?? row.id;
  const creditId = `contributor-${row.id}`;
  const credit = {
    id: creditId,
    displayName: input.anonymous ? 'Anonymous contributor' : input.displayName,
    kind: 'community',
    date: now.slice(0, 10),
  };
  await saveProjection(tx, row.id, reviewId, 'credits', credit);
  const sourceId = `contribution-${row.id}`;
  const sourceCreator = review.sourceCreator ?? input.sourceCreator;
  const narrator = review.narrator ?? input.narrator;
  const holdingInstitution = review.holdingInstitution ?? input.holdingInstitution;
  const source = sourceSchema.parse({
    id: sourceId,
    title: review.title ?? input.title,
    creator: sourceCreator || credit.displayName,
    publisher: holdingInstitution || 'South-View community archive',
    url: `/contributions/${entryId}`,
    accessedAt: now.slice(0, 10),
    date: now.slice(0, 10),
    kind: input.kind === 'memory' ? 'community-memory' : 'community-contribution',
    creditIds: [creditId],
    note:
      input.kind === 'memory'
        ? 'A contributed personal memory. The author’s account is preserved separately from the curated biography.'
        : 'A community contribution reviewed for publication; see the original contribution and cited sources.',
  });
  await saveProjection(tx, row.id, reviewId, 'sources', source);
  const sourceIds = [sourceId];
  for (let index = 0; index < input.links.length; index++) {
    const link = input.links[index]!;
    const linkedSource = sourceSchema.parse({
      id: `${sourceId}-link-${index + 1}`,
      title: link.title,
      creator: sourceCreator || 'Creator not supplied',
      publisher: holdingInstitution || new URL(link.url).hostname,
      url: link.url,
      accessedAt: now.slice(0, 10),
      kind: 'document',
      creditIds: [creditId],
      note: 'Reference supplied with the contribution; retaining the link does not establish every claim in it.',
    });
    await saveProjection(tx, row.id, reviewId, 'sources', linkedSource);
    sourceIds.push(linkedSource.id);
  }
  for (const id of review.sourceIds) {
    if (
      !(await tx.query('SELECT id FROM archive.sources WHERE id = $1 FOR KEY SHARE', [id])).rows
        .length
    )
      throw new DomainError('BAD_REQUEST', 'A selected source is unavailable.');
    if (!sourceIds.includes(id)) sourceIds.push(id);
  }
  const citations = sourceIds.map((sourceId) => ({ sourceId }));
  let personId = review.personId === undefined ? input.personId : review.personId;
  const title = review.title ?? input.title;
  const body = review.body ?? input.body;
  if (!personId) {
    const name = review.newPersonName?.trim();
    if (!name)
      throw new DomainError(
        'BAD_REQUEST',
        'A reviewer must explicitly name the new person before publication.',
      );
    personId = `person-${row.id}`;
    const person = personSchema.parse({
      id: personId,
      name,
      aliases: [],
      themes: ['Community'],
      summary: `Community materials about ${name}.`,
      summaryCitations: [{ sourceId }],
      biography: [],
      creditIds: [creditId],
    });
    await saveProjection(tx, row.id, reviewId, 'persons', person);
  }
  const relatedPersonIds = [...new Set(review.relatedPersonIds ?? input.relatedPersonIds)].filter(
    (id) => id !== personId,
  );
  const placeIds = [...new Set(review.placeIds ?? input.placeIds)];
  // A newly approved map place may be linked in the same transaction that creates it.
  const newPlaceId = review.applyTo === 'place' ? review.placePatch?.placeId : undefined;
  await checkLinkedRecords(tx, {
    personId,
    relatedPersonIds,
    placeIds: placeIds.filter((id) => id !== newPlaceId),
  });
  if (review.applyTo === 'biography') {
    if (input.kind === 'memory')
      throw new DomainError(
        'BAD_REQUEST',
        'Personal memories must remain attributed community entries.',
      );
    const person = await checkPerson(tx, personId);
    const paragraph = {
      id: `contribution-${row.id}`,
      text: body,
      citations,
      creditIds: [creditId],
    };
    person.biography = [...person.biography.filter((p) => p.id !== paragraph.id), paragraph];
    await saveProjection(tx, row.id, reviewId, 'persons', person);
  }
  if (review.applyTo === 'place') {
    if (input.kind === 'memory')
      throw new DomainError('BAD_REQUEST', 'A personal memory cannot change a mapped place.');
    if (!review.placePatch)
      throw new DomainError('BAD_REQUEST', 'Provide the complete place correction.');
    const patch = review.placePatch;
    if (
      (patch.coordinates && patch.precision === 'unmapped') ||
      (!patch.coordinates && patch.precision !== 'unmapped')
    )
      throw new DomainError(
        'BAD_REQUEST',
        'The location precision must agree with the presence of coordinates.',
      );
    if (
      patch.coordinates &&
      (patch.coordinates[0] < -84.65 ||
        patch.coordinates[0] > -84.1 ||
        patch.coordinates[1] < 33.5 ||
        patch.coordinates[1] > 33.95)
    )
      throw new DomainError(
        'BAD_REQUEST',
        'Place coordinates must be in metropolitan Atlanta, longitude first.',
      );
    const current = (
      await tx.query<{ data: Record<string, unknown> }>(
        'SELECT data FROM archive.places WHERE id = $1 FOR NO KEY UPDATE',
        [patch.placeId],
      )
    ).rows[0]?.data;
    const place = placeSchema.parse({
      ...current,
      id: patch.placeId,
      name: patch.name,
      scope: patch.scope,
      coordinates: patch.coordinates,
      precision: patch.precision,
      locationNote: patch.locationNote,
      coordinateCitations: patch.coordinates ? citations : [],
      creditIds: [
        ...new Set([
          ...(Array.isArray(current?.creditIds) ? (current.creditIds as string[]) : []),
          creditId,
        ]),
      ],
    });
    await saveProjection(tx, row.id, reviewId, 'places', place);
    const relationId = `relation-${row.id}`;
    const relation = relationSchema.parse({
      id: relationId,
      personId,
      placeId: place.id,
      label: patch.relationship,
      description: body,
      citations,
      creditIds: [creditId],
    });
    await saveProjection(tx, row.id, reviewId, 'person_places', relation);
  }
  const allPhotos = (
    await tx.query<{ data: SubmissionPhoto }>(
      'SELECT data FROM community.photos WHERE submission_id = $1 ORDER BY created_at, id',
      [row.id],
    )
  ).rows.map((photo) => photo.data);
  if (review.approvedPhotoIds?.some((id) => !allPhotos.some((photo) => photo.id === id)))
    throw new DomainError('BAD_REQUEST', 'A selected photo does not belong to this contribution.');
  if (review.photoEdits?.some((edit) => !allPhotos.some((photo) => photo.id === edit.id)))
    throw new DomainError('BAD_REQUEST', 'A photo edit does not belong to this contribution.');
  const photos = allPhotos
    .filter(
      (photo) =>
        review.approvedPhotoIds === undefined || review.approvedPhotoIds.includes(photo.id),
    )
    .map((photo) => ({
      id: photo.id,
      url: `/api/community/media/${photo.id}`,
      caption: photo.caption,
      creator: photo.creator,
      rights: photo.rights,
      ...review.photoEdits?.find((edit) => edit.id === photo.id),
      creditId,
      width: photo.width,
      height: photo.height,
    }));
  const existing = (
    await tx.query<{ data: ContributionEntry }>(
      'SELECT data FROM archive.contributions WHERE id = $1',
      [entryId],
    )
  ).rows[0]?.data;
  const entry = contributionEntrySchema.parse({
    id: entryId,
    featured: review.featured ?? false,
    personId,
    relatedPersonIds,
    placeIds,
    eventDate: review.eventDate ?? input.eventDate,
    kind: input.kind,
    title,
    body,
    context: review.context ?? input.context,
    sourceCreator,
    narrator,
    holdingInstitution,
    creditId,
    sourceIds,
    photos,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
    publicNote: review.publicNote || undefined,
  });
  await saveProjection(tx, row.id, reviewId, 'contributions', entry);
  await tx.query(
    "UPDATE community.submissions SET status='published', published_entry_id=$2, updated_at=now() WHERE id=$1",
    [row.id, entryId],
  );
  return entryId;
}

async function withdraw(tx: Store, row: SubmissionRow) {
  // Curated edits are reverted only if no later reviewer has changed them.
  const revisions = (
    await tx.query<{
      target_table: PublicTable;
      target_id: string;
      previous_data: Record<string, unknown> | null;
      published_data: Record<string, unknown>;
    }>(
      'SELECT target_table, target_id, previous_data, published_data FROM community.publication_revisions WHERE submission_id = $1 ORDER BY sequence DESC',
      [row.id],
    )
  ).rows;
  await tx.query('DELETE FROM archive.contributions WHERE id = $1', [row.published_entry_id]);
  for (const revision of revisions) {
    if (!['persons', 'places', 'person_places'].includes(revision.target_table)) continue;
    const matches =
      (
        await tx.query(
          `SELECT id FROM archive.${revision.target_table} WHERE id=$1 AND data=$2::jsonb FOR UPDATE`,
          [revision.target_id, JSON.stringify(revision.published_data)],
        )
      ).rows.length > 0;
    if (!matches)
      throw new DomainError(
        'CONFLICT',
        'A later publication changed this curated record. Resolve its dependent edits before withdrawing this contribution.',
      );
    if (revision.previous_data)
      await tx.query(`UPDATE archive.${revision.target_table} SET data=$2::jsonb WHERE id=$1`, [
        revision.target_id,
        JSON.stringify(revision.previous_data),
      ]);
    else {
      if (revision.target_table === 'persons' || revision.target_table === 'places') {
        const field = revision.target_table === 'persons' ? 'relatedPersonIds' : 'placeIds';
        // These optional references live in public JSON, so a primary-ID FK alone
        // cannot protect them when a newly created person/place is withdrawn.
        for (const table of ['contributions', 'materials'] as const) {
          const reference = await tx.query(
            `SELECT id FROM archive.${table} WHERE data->$1 @> $2::jsonb LIMIT 1`,
            [field, JSON.stringify([revision.target_id])],
          );
          if (reference.rows.length)
            throw new DomainError(
              'CONFLICT',
              'Another published record links to this person or place. Resolve that reference before withdrawing it.',
            );
        }
      }
      try {
        await tx.query(`DELETE FROM archive.${revision.target_table} WHERE id=$1`, [
          revision.target_id,
        ]);
      } catch {
        throw new DomainError(
          'CONFLICT',
          'Another published record depends on this contribution. Resolve that reference before withdrawing it.',
        );
      }
    }
  }
  // Delete this contribution's source/credit projection only after checking every public dependency.
  // A failed check rolls back the entire withdrawal, including preceding curated reversions.
  for (const table of ['sources', 'credits'] as const) {
    for (const revision of revisions.filter(
      (item) => item.target_table === table && item.previous_data === null,
    )) {
      const dependentTables =
        table === 'sources'
          ? ['persons', 'places', 'person_places', 'materials', 'issues', 'contributions']
          : ['persons', 'places', 'person_places', 'materials', 'sources', 'contributions'];
      for (const dependentTable of dependentTables) {
        const dependency = await tx.query(
          `SELECT id FROM archive.${dependentTable} WHERE jsonb_path_exists(data, '$.** ? (@ == $value)', jsonb_build_object('value', $1::text)) LIMIT 1`,
          [revision.target_id],
        );
        if (dependency.rows.length)
          throw new DomainError(
            'CONFLICT',
            'Another public record cites this contribution. Resolve that dependency before withdrawing it.',
          );
      }
      await tx.query(`DELETE FROM archive.${table} WHERE id=$1`, [revision.target_id]);
    }
  }
  await tx.query(
    "UPDATE community.submissions SET status='withdrawn', updated_at=now() WHERE id=$1",
    [row.id],
  );
}

export async function reviewSubmission(
  id: string,
  raw: ReviewInput,
  actor: Actor,
): Promise<{ submission: SubmissionRecord; entryId?: string; changed: boolean }> {
  requireReviewer(actor);
  const review = reviewInputSchema.parse(raw);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const row = await rowFor(tx, id, actor, true);
    const targetStatus = {
      publish: 'published',
      'needs-information': 'needs-information',
      reject: 'rejected',
      withdraw: 'withdrawn',
    }[review.action];
    if (row.status === targetStatus) {
      // Retrying a completed decision is harmless. Further edits need a new contribution.
      return {
        submission: await recordFor(tx, row, actor),
        changed: false,
        ...(row.published_entry_id && row.status === 'published'
          ? { entryId: row.published_entry_id }
          : {}),
      };
    }
    if (
      review.action === 'withdraw'
        ? row.status !== 'published'
        : !['pending', 'needs-information'].includes(row.status)
    )
      throw new DomainError(
        'CONFLICT',
        'This decision is not available for the contribution’s current status.',
      );
    if (review.action === 'needs-information' && !review.authorMessage.trim())
      throw new DomainError('BAD_REQUEST', 'Tell the contributor what information is needed.');
    const reviewId = randomUUID();
    await tx.query(
      'INSERT INTO community.reviews (id, submission_id, reviewer_id, action, decision) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [reviewId, id, actor.userId, review.action, JSON.stringify(review)],
    );
    const entryId =
      review.action === 'publish' ? await publish(tx, row, review, reviewId) : undefined;
    if (review.action === 'withdraw') await withdraw(tx, row);
    else if (review.action !== 'publish')
      await tx.query('UPDATE community.submissions SET status=$2, updated_at=now() WHERE id=$1', [
        id,
        targetStatus,
      ]);
    return {
      submission: await recordFor(tx, await rowFor(tx, id, actor), actor),
      changed: true,
      ...(entryId ? { entryId } : {}),
    };
  });
}

export async function getPublicContribution(id: string): Promise<ContributionEntry | null> {
  const store = await getStore();
  const entry = (
    await store.query<{ data: ContributionEntry }>(
      'SELECT data FROM archive.contributions WHERE id=$1',
      [id],
    )
  ).rows[0]?.data;
  return entry ? contributionEntrySchema.parse(entry) : null;
}
/** Server-only media authorization result. Never serialize storage keys into a public DTO. */
export async function getPublicPhoto(id: string): Promise<SubmissionPhoto | null> {
  const store = await getStore();
  const row = (
    await store.query<{ data: SubmissionPhoto }>(
      "SELECT p.data FROM community.photos p JOIN community.submissions s ON s.id=p.submission_id JOIN archive.contributions c ON c.id=s.published_entry_id WHERE p.id=$1 AND s.status='published' AND c.data->'photos' @> $2::jsonb",
      [id, JSON.stringify([{ id }])],
    )
  ).rows[0];
  return row?.data ?? null;
}
export async function setMailStatus(id: string, status: string) {
  const store = await writableStore();
  await store.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO community.mail_events (id, submission_id, status) VALUES ($1,$2,$3)',
      [randomUUID(), id, status.slice(0, 200)],
    );
    await tx.query('UPDATE community.submissions SET mail_status=$2 WHERE id=$1', [
      id,
      status.slice(0, 200),
    ]);
  });
}
/** Review notifications append delivery evidence without changing receipt delivery status. */
export async function recordMailEvent(id: string, status: string) {
  const store = await writableStore();
  await store.query(
    'INSERT INTO community.mail_events (id, submission_id, status) VALUES ($1,$2,$3)',
    [randomUUID(), id, status.slice(0, 200)],
  );
}
/** Finalization is durable before delivery. Only one concurrent request may start receipt delivery. */
export async function claimReceiptMail(id: string): Promise<boolean> {
  const store = await writableStore();
  const result = await store.query(
    "UPDATE community.submissions SET mail_status='sending' WHERE id=$1 AND mail_status IS NULL AND status='pending' RETURNING id",
    [id],
  );
  return result.rows.length === 1;
}
/** The key may include an IP/email, but only its hash is persisted. */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1000
  )
    throw new Error('Invalid rate-limit configuration.');
  const store = await writableStore();
  const result = await store.query<{ hits: number }>(
    `INSERT INTO community.rate_limits (key_hash,hits,expires_at) VALUES ($1,1,now()+($2 * interval '1 millisecond')) ON CONFLICT(key_hash) DO UPDATE SET hits=CASE WHEN community.rate_limits.expires_at<=now() THEN 1 ELSE community.rate_limits.hits+1 END, expires_at=CASE WHEN community.rate_limits.expires_at<=now() THEN now()+($2 * interval '1 millisecond') ELSE community.rate_limits.expires_at END RETURNING hits`,
    [hash(key), windowMs],
  );
  return result.rows[0]!.hits <= limit;
}
