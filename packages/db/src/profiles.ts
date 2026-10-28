import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  profileSchema,
  managedProfileMediaURL,
  profileBodyMediaURLs,
  profileSubmissionSchema,
  validateArchive,
  type Actor,
  type ArchiveData,
  type PersonProfile,
  type ProfileProposal,
  type ProfileSubmission,
  type PublishedProfile,
} from '@southview/validators';
import { getStore, type Store } from './connection';
import { DomainError } from './community';
import { convertArchiveProfiles, projectProfilesToArchive } from './profile-conversion';
import { fixtureArchive } from './fixtures';
import { correctedHistoricalProfile, repairConvertedMapNotes } from './profile-map-notes';
export { convertArchiveProfiles, projectProfilesToArchive } from './profile-conversion';
export { DomainError } from './community';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const iso = (v: Date | string) => new Date(v).toISOString();
const fail = (code: ConstructorParameters<typeof DomainError>[0], message: string): never => {
  throw new DomainError(code, message);
};
const reviewer = (actor: Actor) => {
  if (!actor.reviewer || !actor.userId) fail('FORBIDDEN', 'Staff review access is required.');
};
function receipt(token: string | undefined, expected: string) {
  if (!token || token.length < 64 || token.length > 256) return false;
  const a = Buffer.from(hash(token), 'hex'),
    b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
function owns(row: { receipt_hash: string; user_id: string | null }, actor: Actor) {
  return !!(
    (actor.reviewer && actor.userId) ||
    (actor.userId && actor.userId === row.user_id) ||
    receipt(actor.receiptToken, row.receipt_hash)
  );
}
const parse = (p: PersonProfile) => {
  const result = profileSchema.safeParse(p);
  if (!result.success) fail('BAD_REQUEST', 'The profile or its evidence references are invalid.');
  return result.data!;
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
function fingerprint(input: ProfileSubmission) {
  const { receiptToken, ...rest } = input;
  return hash(canonical(rest));
}
type RequestRow = {
  request_id: string;
  receipt_hash: string;
  user_id: string | null;
  payload_hash: string | null;
  revision_id: string | null;
  person_id: string | null;
  version: number | null;
  expires_at: Date | string;
};
type RevisionRow = {
  id: string;
  request_id: string;
  person_id: string | null;
  base_version: number | null;
  proposal_version: number;
  profile: PersonProfile;
  private_name: string;
  email: string;
  public_credit: string;
  created_at: Date | string;
  updated_at: Date | string;
  receipt_hash: string;
  user_id: string | null;
};
type PersonRow = {
  id: string;
  version: number;
  data: PersonProfile;
  updated_at: Date | string;
  public_credit?: string;
};
const pub = (row: PersonRow): PublishedProfile => ({
  ...(row.public_credit ? { publicCredit: row.public_credit } : {}),
  id: row.id,
  version: row.version,
  profile: parse(row.data),
  updatedAt: iso(row.updated_at),
});
const proposal = (r: RevisionRow): ProfileProposal => ({
  id: r.id,
  requestId: r.request_id,
  personId: r.person_id,
  baseVersion: r.base_version,
  proposalVersion: r.proposal_version,
  profile: parse(r.profile),
  privateName: r.private_name,
  email: r.email,
  publicCredit: r.public_credit,
  userId: r.user_id,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const revisionSQL =
  'SELECT r.*,q.receipt_hash,q.user_id FROM community.profile_revisions r JOIN community.profile_requests q ON q.request_id=r.request_id';
async function revision(tx: Store, id: string, actor: Actor, lock = false) {
  const r = (
    await tx.query<RevisionRow>(`${revisionSQL} WHERE r.id=$1${lock ? ' FOR UPDATE OF r,q' : ''}`, [
      id,
    ])
  ).rows[0];
  if (!r || !owns(r, actor))
    fail('NOT_FOUND', 'This submission is unavailable or the receipt is invalid.');
  return r!;
}
async function request(tx: Store, id: string, lock = false) {
  return (
    await tx.query<RequestRow>(
      `SELECT * FROM community.profile_requests WHERE request_id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
}
/** Caller supplies a transaction; version-zero rows are converted exactly once. */
export async function ensureCanonicalProfiles(tx: Store) {
  const needs = (await tx.query('SELECT id FROM archive.persons WHERE version=0 LIMIT 1')).rows
    .length;
  if (!needs) {
    await repairConvertedMapNotes(tx);
    return;
  }
  if (tx.dialect === 'database') await tx.query('SELECT pg_advisory_xact_lock(731864220)');
  const old = (
    await tx.query<{ id: string; version: number; data: unknown }>(
      'SELECT id,version,data FROM archive.persons WHERE version=0 ORDER BY id FOR UPDATE',
    )
  ).rows;
  if (!old.length) {
    await repairConvertedMapNotes(tx);
    return;
  }
  const rows = [
    ...old,
    ...(
      await tx.query<{ id: string; version: number; data: unknown }>(
        'SELECT id,version,data FROM archive.persons WHERE version>0 ORDER BY id',
      )
    ).rows,
  ];
  const discarded = (
    await tx.query<{ id: string }>(
      "SELECT id FROM community.submissions WHERE status IN('draft','rejected') AND published_entry_id IS NULL ORDER BY id FOR UPDATE",
    )
  ).rows;
  for (const row of discarded) await deleteLegacyInTransaction(tx, row.id);
  const read = async (table: string) =>
    (await tx.query<{ data: unknown }>(`SELECT data FROM archive.${table} ORDER BY id`)).rows.map(
      (r) => r.data,
    );
  const ids = new Set(old.map((r) => r.id));
  const people = old.map((r) => r.data),
    allPlaces = await read('places'),
    allRelations = await read('person_places'),
    allMaterials = await read('materials'),
    sources = await read('sources'),
    credits = await read('credits'),
    allContributions = await read('contributions'),
    allIssues = await read('issues');
  // Convert a coherent original archive. Canonical people are projected solely to satisfy legacy cross references.
  const current = rows
    .filter((r) => r.version > 0)
    .map((r) => ({
      id: r.id,
      version: r.version,
      profile: r.data as PersonProfile,
      updatedAt: new Date().toISOString(),
    }));
  const projected = projectProfilesToArchive(current);
  const data = validateArchive({
    people: [...people, ...projected.people],
    places: allPlaces,
    relations: (allRelations as ArchiveData['relations']).filter((r) => ids.has(r.personId)),
    materials: (allMaterials as ArchiveData['materials']).filter((m) => ids.has(m.personId)),
    sources: [...sources, ...projected.sources],
    credits: credits.length ? credits : fixtureArchive.credits,
    contributions: (allContributions as ArchiveData['contributions']).filter((c) =>
      ids.has(c.personId),
    ),
    issues: (allIssues as ArchiveData['issues']).filter((i) => ids.has(i.personId)),
    crosswalk: [],
  });
  for (const p of convertArchiveProfiles(data).filter((p) => ids.has(p.id))) {
    await tx.query(
      'UPDATE archive.persons SET data=$2::jsonb,version=1,updated_at=$3 WHERE id=$1 AND version=0',
      [p.id, JSON.stringify({ ...p.profile, id: p.id }), p.updatedAt],
    );
    await tx.query(
      "INSERT INTO community.profile_versions(person_id,version,profile,public_credit,created_at) VALUES($1,1,$2::jsonb,'Initial archive compilation',$3) ON CONFLICT DO NOTHING",
      [p.id, JSON.stringify(p.profile), p.updatedAt],
    );
  }
  for (const c of allContributions as ArchiveData['contributions'])
    await tx.query(
      'INSERT INTO archive.profile_legacy_links(id,person_id,anchor) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [c.id, c.personId, `story-${c.id}`],
    );
  await repairConvertedMapNotes(tx);
}
export async function readPublishedProfiles(store?: Store): Promise<PublishedProfile[]> {
  if (!store && process.env.ARCHIVE_DATA_MODE === 'fixture')
    return convertArchiveProfiles(fixtureArchive);
  const db = store ?? (await getStore());
  return db.transaction(async (tx) => {
    await ensureCanonicalProfiles(tx);
    return (
      await tx.query<PersonRow>(
        'SELECT p.*,v.public_credit FROM archive.persons p JOIN community.profile_versions v ON v.person_id=p.id AND v.version=p.version WHERE p.version>=1 ORDER BY p.id',
      )
    ).rows.map(pub);
  });
}
export async function getPublishedProfile(
  id: string,
  store?: Store,
): Promise<PublishedProfile | null> {
  return (await readPublishedProfiles(store)).find((p) => p.id === id) ?? null;
}
export async function resolveLegacyContribution(
  id: string,
  store?: Store,
): Promise<{ personId: string; anchor?: string } | null> {
  if (!store && process.env.ARCHIVE_DATA_MODE === 'fixture') {
    const c = fixtureArchive.contributions.find((c) => c.id === id);
    return c ? { personId: c.personId, anchor: `story-${c.id}` } : null;
  }
  const db = store ?? (await getStore());
  return db.transaction(async (tx) => {
    await ensureCanonicalProfiles(tx);
    const r = (
      await tx.query<{ person_id: string; anchor: string | null }>(
        'SELECT * FROM archive.profile_legacy_links WHERE id=$1',
        [id],
      )
    ).rows[0];
    return r ? { personId: r.person_id, ...(r.anchor ? { anchor: r.anchor } : {}) } : null;
  });
}
const mediaIds = (p: PersonProfile) =>
  [
    ...new Set([
      ...p.sources.flatMap((s) => (s.mediaId ? [s.mediaId] : [])),
      ...(p.portrait?.mediaId ? [p.portrait.mediaId] : []),
    ]),
  ].sort();
async function attachMedia(tx: Store, p: PersonProfile, actor: Actor, revisionId: string) {
  const legacyURLs = [
    ...p.sources.flatMap((s) => (s.url ? [s.url] : [])),
    ...(p.portrait?.url ? [p.portrait.url] : []),
    ...profileBodyMediaURLs(p.bodyMarkdown),
  ];
  for (const url of [...new Set(legacyURLs)]) {
    const ref = managedProfileMediaURL(url);
    if (!ref || ref.namespace !== 'community') continue;
    if (!ref.canonical) fail('BAD_REQUEST', 'Legacy media must use its exact approved URL.');
    const existing = (
      await tx.query<{ data: { mimeType?: string; publicKey?: string } }>(
        "SELECT p.data FROM community.photos p JOIN community.submissions s ON s.id=p.submission_id JOIN archive.contributions c ON c.id=s.published_entry_id WHERE p.id=$1 AND s.status='published' AND c.data->'photos' @> $2::jsonb FOR KEY SHARE OF p,s,c",
        [ref.id, JSON.stringify([{ id: ref.id }])],
      )
    ).rows[0];
    if (!existing?.data.publicKey || !/^image\/(jpeg|png|webp)$/.test(existing.data.mimeType ?? ''))
      fail('BAD_REQUEST', 'A legacy evidence file must already be an approved published image.');
  }
  for (const id of mediaIds(p)) {
    const m = await authorizedMedia(tx, id, actor, true);
    if (!m || !m.ready)
      fail('BAD_REQUEST', 'An evidence file is unavailable or has not finished uploading.');
    if (p.portrait?.mediaId === id && !/^image\/(jpeg|png|webp)$/.test(m!.contentType))
      fail('BAD_REQUEST', 'A portrait must reference an approved image.');
    await tx.query(
      'INSERT INTO community.profile_media_refs(media_id,revision_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, revisionId],
    );
  }
}
/** Every reference writer locks media first. Lock candidates, then check refs in a fresh statement. */
async function queueMedia(tx: Store, ids: string[]) {
  if (!ids.length) return;
  const rows = (
    await tx.query<{ id: string }>(
      "SELECT id FROM community.profile_media WHERE id=ANY($1::text[]) AND state='active' ORDER BY id FOR UPDATE SKIP LOCKED",
      [ids],
    )
  ).rows;
  for (const row of rows)
    await tx.query(
      "UPDATE community.profile_media m SET state='queued' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM community.profile_media_refs r WHERE r.media_id=m.id)",
      [row.id],
    );
}
async function queueOrphans(tx: Store) {
  const candidates = (
    await tx.query<{ id: string }>(
      "SELECT m.id FROM community.profile_media m JOIN community.profile_requests q ON q.request_id=m.request_id WHERE m.state='active' AND (q.expires_at<=now() OR q.revision_id IS NULL AND q.payload_hash IS NOT NULL) ORDER BY m.id",
    )
  ).rows;
  await queueMedia(
    tx,
    candidates.map((r) => r.id),
  );
}
async function publication(tx: Store, id: string, version: number) {
  const r = (
    await tx.query<{ profile: PersonProfile; created_at: Date | string; public_credit: string }>(
      'SELECT profile,created_at,public_credit FROM community.profile_versions WHERE person_id=$1 AND version=$2',
      [id, version],
    )
  ).rows[0];
  if (!r) fail('NOT_FOUND', 'This published version is unavailable.');
  return {
    id,
    version,
    profile: await correctedHistoricalProfile(tx, id, parse(r!.profile)),
    updatedAt: iso(r!.created_at),
    publicCredit: r!.public_credit,
  };
}
export function createProfileRepository(store: Store) {
  return {
    async submit(raw: ProfileSubmission, actor: Actor) {
      const checked = profileSubmissionSchema.safeParse(raw);
      if (!checked.success) fail('BAD_REQUEST', 'The profile submission is invalid.');
      const input = checked.data!;
      return store.transaction(async (tx) => {
        await ensureCanonicalProfiles(tx);
        await tx.query(
          'INSERT INTO community.profile_requests(request_id,receipt_hash,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [input.requestId, hash(input.receiptToken), actor.userId],
        );
        const q = (await request(tx, input.requestId, true))!;
        if (!receipt(input.receiptToken, q.receipt_hash))
          fail('NOT_FOUND', 'This receipt is invalid.');
        const digest = fingerprint(input);
        if (q.payload_hash && q.payload_hash !== digest)
          fail('CONFLICT', 'This request already belongs to a different submission.');
        if (q.person_id && q.version)
          return {
            id: q.revision_id!,
            personId: q.person_id,
            status: 'published' as const,
            version: q.version,
          };
        if (q.payload_hash && q.revision_id)
          return { id: q.revision_id, personId: input.personId, status: 'pending' as const };
        if (input.personId) {
          const p = (
            await tx.query<PersonRow>(
              'SELECT * FROM archive.persons WHERE id=$1 FOR NO KEY UPDATE',
              [input.personId],
            )
          ).rows[0];
          if (!p)
            fail('BAD_REQUEST', 'Select an existing person or explicitly create a new person.');
          if (p!.version !== input.baseVersion)
            fail('CONFLICT', 'This person has changed. Reload the current published profile.');
        }
        const id = randomUUID();
        await tx.query(
          'INSERT INTO community.profile_revisions(id,request_id,person_id,base_version,profile,private_name,email,public_credit) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',
          [
            id,
            input.requestId,
            input.personId,
            input.baseVersion,
            JSON.stringify(input.profile),
            input.privateName,
            input.email,
            input.publicCredit,
          ],
        );
        await attachMedia(tx, input.profile, { ...actor, receiptToken: input.receiptToken }, id);
        await tx.query(
          'UPDATE community.profile_requests SET payload_hash=$2,revision_id=$3 WHERE request_id=$1',
          [input.requestId, digest, id],
        );
        return { id, personId: input.personId, status: 'pending' as const };
      });
    },
    async list(actor: Actor) {
      await store.transaction(ensureCanonicalProfiles);
      if (!actor.userId) fail('FORBIDDEN', 'Sign in to view your submissions.');
      return (
        await store.query<RevisionRow>(
          `${revisionSQL}${actor.reviewer ? '' : ' WHERE q.user_id=$1'} ORDER BY r.created_at DESC,r.id`,
          actor.reviewer ? [] : [actor.userId],
        )
      ).rows.map(proposal);
    },
    async minePublications(actor: Actor) {
      if (!actor.userId) fail('FORBIDDEN', 'Sign in to view your accepted submissions.');
      const requests = (
        await store.query<RequestRow>(
          'SELECT * FROM community.profile_requests WHERE user_id=$1 AND person_id IS NOT NULL AND version IS NOT NULL ORDER BY created_at DESC,request_id',
          [actor.userId],
        )
      ).rows;
      return Promise.all(
        requests.map(async (q) => ({
          ...(await publication(store, q.person_id!, q.version!)),
          submissionId: q.revision_id,
        })),
      );
    },
    async get(id: string, actor: Actor): Promise<ProfileProposal | PublishedProfile> {
      await store.transaction(ensureCanonicalProfiles);
      const r = (await store.query<RevisionRow>(`${revisionSQL} WHERE r.id=$1`, [id])).rows[0];
      if (r && owns(r, actor)) return proposal(r);
      const q = (
        await store.query<RequestRow>(
          'SELECT * FROM community.profile_requests WHERE revision_id=$1',
          [id],
        )
      ).rows[0];
      if (q && q.person_id && q.version && owns(q, actor))
        return publication(store, q.person_id, q.version);
      return fail('NOT_FOUND', 'This submission is unavailable or the receipt is invalid.');
    },
    async save(
      id: string,
      raw: PersonProfile,
      proposalVersion: number,
      baseVersion: number | null,
      actor: Actor,
    ) {
      reviewer(actor);
      const p = parse(raw);
      return store.transaction(async (tx) => {
        await ensureCanonicalProfiles(tx);
        const r = await revision(tx, id, actor, true);
        if (r.proposal_version !== proposalVersion)
          fail('CONFLICT', 'Another reviewer changed this proposal. Reload before saving.');
        if (r.person_id) {
          const current = (
            await tx.query<PersonRow>(
              'SELECT * FROM archive.persons WHERE id=$1 FOR NO KEY UPDATE',
              [r.person_id],
            )
          ).rows[0];
          if (current?.version !== baseVersion)
            fail('CONFLICT', 'Reconcile against the current published version before saving.');
        } else if (baseVersion !== null) fail('BAD_REQUEST', 'A new person has no base version.');
        await tx.query('DELETE FROM community.profile_media_refs WHERE revision_id=$1', [id]);
        await attachMedia(tx, p, actor, id);
        await tx.query(
          'UPDATE community.profile_revisions SET profile=$2::jsonb,proposal_version=proposal_version+1,base_version=$3,updated_at=now() WHERE id=$1',
          [id, JSON.stringify(p), baseVersion],
        );
        const removed = mediaIds(r.profile).filter((mediaId) => !mediaIds(p).includes(mediaId));
        await queueMedia(tx, removed);
        await queueOrphans(tx);
        return proposal(await revision(tx, id, actor));
      });
    },
    async approve(id: string, proposalVersion: number, actor: Actor) {
      reviewer(actor);
      return store.transaction(async (tx) => {
        await ensureCanonicalProfiles(tx);
        const r = await revision(tx, id, actor, true);
        if (r.proposal_version !== proposalVersion)
          fail('CONFLICT', 'Another reviewer changed this proposal. Reload before approving.');
        const p = parse(r.profile);
        const personId = r.person_id ?? randomUUID();
        let version = 1;
        if (r.person_id) {
          const current = (
            await tx.query<PersonRow>(
              'SELECT * FROM archive.persons WHERE id=$1 FOR NO KEY UPDATE',
              [personId],
            )
          ).rows[0];
          if (!current || current.version !== r.base_version)
            fail(
              'CONFLICT',
              'The published profile changed. Reconcile the proposal before approving.',
            );
          version = current!.version + 1;
        }
        // Recheck durable media in the same transaction as the accepted snapshot.
        await attachMedia(tx, p, actor, id);
        if (r.person_id)
          await tx.query(
            'UPDATE archive.persons SET data=$2::jsonb,version=$3,updated_at=now() WHERE id=$1',
            [personId, JSON.stringify({ ...p, id: personId }), version],
          );
        else
          await tx.query('INSERT INTO archive.persons(id,data,version) VALUES($1,$2::jsonb,$3)', [
            personId,
            JSON.stringify({ ...p, id: personId }),
            version,
          ]);
        await tx.query(
          'INSERT INTO community.profile_versions(person_id,version,profile,reviewer_id,public_credit,request_id) VALUES($1,$2,$3::jsonb,$4,$5,$6)',
          [personId, version, JSON.stringify(p), actor.userId, r.public_credit, r.request_id],
        );
        await tx.query(
          'INSERT INTO community.profile_media_refs(media_id,person_id,version) SELECT media_id,$2,$3 FROM community.profile_media_refs WHERE revision_id=$1',
          [id, personId, version],
        );
        await tx.query(
          'UPDATE community.profile_requests SET person_id=$2,version=$3 WHERE request_id=$1',
          [r.request_id, personId, version],
        );
        await tx.query('DELETE FROM community.profile_revisions WHERE id=$1', [id]);
        await queueOrphans(tx);
        return publication(tx, personId, version);
      });
    },
    async reject(id: string, proposalVersion: number, actor: Actor) {
      reviewer(actor);
      return store.transaction(async (tx) => {
        const r = await revision(tx, id, actor, true);
        if (r.proposal_version !== proposalVersion)
          fail('CONFLICT', 'Another reviewer changed this proposal. Reload before deleting.');
        await tx.query('DELETE FROM community.profile_revisions WHERE id=$1', [id]);
        await tx.query(
          'UPDATE community.profile_requests SET revision_id=NULL,expires_at=now() WHERE request_id=$1',
          [r.request_id],
        );
        await queueOrphans(tx);
        await tx.query(
          'DELETE FROM community.profile_requests q WHERE request_id=$1 AND NOT EXISTS(SELECT 1 FROM community.profile_media m WHERE m.request_id=q.request_id)',
          [r.request_id],
        );
        return { deleted: true as const };
      });
    },
    async history(personId: string, actor: Actor) {
      reviewer(actor);
      return store.transaction(async (tx) => {
        await ensureCanonicalProfiles(tx);
        const rows = (
          await tx.query<{
            version: number;
            profile: PersonProfile;
            created_at: Date | string;
            public_credit: string;
            reviewer_id: string | null;
          }>('SELECT * FROM community.profile_versions WHERE person_id=$1 ORDER BY version DESC', [
            personId,
          ])
        ).rows;
        return Promise.all(
          rows.map(async (r) => ({
            id: personId,
            version: r.version,
            profile: await correctedHistoricalProfile(tx, personId, parse(r.profile)),
            updatedAt: iso(r.created_at),
            publicCredit: r.public_credit,
            reviewerId: r.reviewer_id,
          })),
        );
      });
    },
    async restore(personId: string, version: number, currentVersion: number, actor: Actor) {
      reviewer(actor);
      return store.transaction(async (tx) => {
        await ensureCanonicalProfiles(tx);
        const current = (
          await tx.query<PersonRow>('SELECT * FROM archive.persons WHERE id=$1 FOR NO KEY UPDATE', [
            personId,
          ])
        ).rows[0];
        if (!current) fail('NOT_FOUND', 'This person is unavailable.');
        if (current!.version !== currentVersion)
          fail('CONFLICT', 'This person changed. Reload before restoring.');
        const old = await publication(tx, personId, version),
          next = currentVersion + 1;
        await tx.query(
          'UPDATE archive.persons SET data=$2::jsonb,version=$3,updated_at=now() WHERE id=$1',
          [personId, JSON.stringify({ ...old.profile, id: personId }), next],
        );
        await tx.query(
          'INSERT INTO community.profile_versions(person_id,version,profile,reviewer_id,public_credit) VALUES($1,$2,$3::jsonb,$4,$5)',
          [
            personId,
            next,
            JSON.stringify(old.profile),
            actor.userId,
            old.publicCredit ?? 'Initial archive compilation',
          ],
        );
        await tx.query(
          'INSERT INTO community.profile_media_refs(media_id,person_id,version) SELECT media_id,person_id,$3 FROM community.profile_media_refs WHERE person_id=$1 AND version=$2',
          [personId, version, next],
        );
        return publication(tx, personId, next);
      });
    },
  };
}
export type ProfileMedia = {
  id: string;
  requestId: string;
  objectKey: string;
  contentType: string;
  bytes: number;
  originalName: string;
  sha256: string;
  ready: boolean;
  uploaded: boolean;
};
type MediaRow = {
  id: string;
  request_id: string;
  object_key: string;
  content_type: string;
  bytes: number;
  original_name: string;
  sha256: string;
  ready: boolean;
  state: string;
};
const media = (r: MediaRow): ProfileMedia => ({
  id: r.id,
  requestId: r.request_id,
  objectKey: r.object_key,
  contentType: r.content_type,
  bytes: r.bytes,
  originalName: r.original_name,
  sha256: r.sha256,
  ready: r.ready,
  uploaded: r.ready,
});
async function authorizedMedia(
  tx: Store,
  id: string,
  actor: Actor,
  lock = false,
): Promise<ProfileMedia | null> {
  const m = (
    await tx.query<MediaRow>(
      `SELECT * FROM community.profile_media WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!m || m.state !== 'active') return null;
  const current =
    (
      await tx.query(
        'SELECT 1 FROM community.profile_media_refs r JOIN archive.persons p ON p.id=r.person_id AND p.version=r.version WHERE r.media_id=$1',
        [id],
      )
    ).rows.length > 0;
  if (current && m.ready) return media(m);
  const q = await request(tx, m.request_id);
  if (q && owns(q, actor) && (q.revision_id || new Date(q.expires_at).getTime() > Date.now()))
    return media(m);
  const pending = (
    await tx.query<{ receipt_hash: string; user_id: string | null }>(
      `SELECT q.receipt_hash,q.user_id FROM community.profile_media_refs f JOIN community.profile_revisions r ON r.id=f.revision_id JOIN community.profile_requests q ON q.request_id=r.request_id WHERE f.media_id=$1`,
      [id],
    )
  ).rows;
  return pending.some((r) => owns(r, actor)) ? media(m) : null;
}
export async function registerProfileMedia(
  store: Store,
  input: {
    id: string;
    requestId: string;
    receiptToken: string;
    objectKey: string;
    contentType: string;
    bytes: number;
    originalName: string;
    sha256: string;
  },
  actor: Actor,
): Promise<ProfileMedia> {
  return store.transaction(async (tx) => {
    if (
      !input.id ||
      input.id.length > 120 ||
      !input.requestId ||
      input.requestId.length > 120 ||
      !input.objectKey ||
      !Number.isInteger(input.bytes) ||
      input.bytes < 1 ||
      input.bytes > 10 * 1024 * 1024 ||
      !/^([a-f0-9]{64})$/i.test(input.sha256)
    )
      fail('BAD_REQUEST', 'Invalid upload metadata.');
    let q = await request(tx, input.requestId, true);
    if (!q) {
      if (!/^[A-Za-z0-9_-]{64,256}$/.test(input.receiptToken))
        fail('BAD_REQUEST', 'Generate a secure receipt before uploading.');
      await tx.query(
        'INSERT INTO community.profile_requests(request_id,receipt_hash,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [input.requestId, hash(input.receiptToken), actor.userId],
      );
      q = await request(tx, input.requestId, true);
    }
    if (!q || !owns(q, { ...actor, receiptToken: input.receiptToken || actor.receiptToken }))
      fail('NOT_FOUND', 'This upload request is unavailable.');
    if (!q!.revision_id && !q!.person_id && new Date(q!.expires_at).getTime() <= Date.now())
      fail('CONFLICT', 'This upload reservation expired. Start a new submission.');
    const existing = (
      await tx.query<MediaRow>('SELECT * FROM community.profile_media WHERE id=$1 FOR UPDATE', [
        input.id,
      ])
    ).rows[0];
    if (existing) {
      if (
        existing.state !== 'active' ||
        existing.request_id !== input.requestId ||
        existing.sha256 !== input.sha256 ||
        existing.content_type !== input.contentType ||
        existing.bytes !== input.bytes ||
        existing.original_name !== input.originalName
      )
        fail('CONFLICT', 'This file ID already belongs to a different upload.');
      return media(existing);
    }
    if (q!.version) fail('CONFLICT', 'This request has already been published.');
    const existingCount = Number(
      (
        await tx.query<{ count: string }>(
          'SELECT count(*) FROM community.profile_media WHERE request_id=$1',
          [input.requestId],
        )
      ).rows[0]!.count,
    );
    if (existingCount >= 10) fail('BAD_REQUEST', 'A submission accepts at most ten new files.');
    const total = Number(
      (
        await tx.query<{ total: string }>(
          'SELECT coalesce(sum(bytes),0) AS total FROM community.profile_media WHERE request_id=$1',
          [input.requestId],
        )
      ).rows[0]!.total,
    );
    if (total + input.bytes > 50 * 1024 * 1024)
      fail('BAD_REQUEST', 'Submission files exceed 50 MiB.');
    const row = (
      await tx.query<MediaRow>(
        'INSERT INTO community.profile_media(id,request_id,object_key,content_type,bytes,original_name,sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [
          input.id,
          input.requestId,
          input.objectKey,
          input.contentType,
          input.bytes,
          input.originalName,
          input.sha256,
        ],
      )
    ).rows[0]!;
    return media(row);
  });
}
export async function markProfileMediaReady(store: Store, id: string, actor: Actor) {
  return store.transaction(async (tx) => {
    const m = await authorizedMedia(tx, id, actor, true);
    if (!m) fail('NOT_FOUND', 'This upload is unavailable.');
    await tx.query('UPDATE community.profile_media SET ready=true WHERE id=$1', [id]);
  });
}
export const markProfileMediaUploaded = markProfileMediaReady;
export async function authorizeProfileMedia(store: Store, id: string, actor: Actor) {
  return store.transaction((tx) => authorizedMedia(tx, id, actor));
}
/** Claims lock out all later references until the worker succeeds or releases its claim. */
export async function listProfileCleanup(store: Store): Promise<ProfileMedia[]> {
  return store.transaction(async (tx) => {
    await queueOrphans(tx);
    await tx.query(
      "UPDATE community.profile_media SET state='queued',cleanup_claimed_at=NULL WHERE state='deleting' AND cleanup_claimed_at<=now()-interval '10 minutes'",
    );
    const rows = (
      await tx.query<MediaRow>(
        "UPDATE community.profile_media m SET state='deleting',cleanup_claimed_at=now() WHERE m.id IN(SELECT x.id FROM community.profile_media x WHERE x.state='queued' AND NOT EXISTS(SELECT 1 FROM community.profile_media_refs r WHERE r.media_id=x.id) ORDER BY x.id FOR UPDATE SKIP LOCKED) RETURNING m.*",
      )
    ).rows;
    return rows.map(media);
  });
}
export async function completeProfileCleanup(store: Store, id: string) {
  await store.transaction(async (tx) => {
    await tx.query(
      "DELETE FROM community.profile_media m WHERE id=$1 AND state='deleting' AND NOT EXISTS(SELECT 1 FROM community.profile_media_refs r WHERE r.media_id=m.id)",
      [id],
    );
    await tx.query(
      'DELETE FROM community.profile_requests q WHERE revision_id IS NULL AND payload_hash IS NOT NULL AND person_id IS NULL AND NOT EXISTS(SELECT 1 FROM community.profile_media m WHERE m.request_id=q.request_id)',
    );
  });
}
export async function failProfileCleanup(store: Store, id: string) {
  await store.query(
    "UPDATE community.profile_media SET state='queued',cleanup_claimed_at=NULL WHERE id=$1 AND state='deleting'",
    [id],
  );
}
export async function abandonProfileUploads(store: Store, before?: Date) {
  await store.transaction(async (tx) => {
    await tx.query(
      'UPDATE community.profile_requests SET expires_at=now() WHERE revision_id IS NULL AND person_id IS NULL AND created_at<=$1',
      [before ?? new Date(Date.now() - 24 * 60 * 60 * 1000)],
    );
    await queueOrphans(tx);
    await tx.query(
      'DELETE FROM community.profile_requests q WHERE revision_id IS NULL AND person_id IS NULL AND expires_at<=now() AND NOT EXISTS(SELECT 1 FROM community.profile_media m WHERE m.request_id=q.request_id)',
    );
  });
}
export type ProfileVetRun = {
  id: string;
  submissionId: string;
  proposalId: string;
  proposalVersion: number;
  status: 'running' | 'completed' | 'failed';
  model: string;
  promptVersion: string;
  inputRevision: string;
  startedAt: string;
  completedAt: string | null;
  report: unknown;
  attachments: unknown[];
  sources: unknown[];
  error: string | null;
  outdated: boolean;
};
type VetRow = {
  id: string;
  revision_id: string;
  proposal_version: number;
  status: ProfileVetRun['status'];
  model: string;
  prompt_version: string;
  input_revision: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  report: unknown;
  attachments: unknown[];
  sources: unknown[];
  error: string | null;
};
const vet = (r: VetRow, current?: RevisionRow): ProfileVetRun => ({
  id: r.id,
  submissionId: r.revision_id,
  proposalId: r.revision_id,
  proposalVersion: r.proposal_version,
  status: r.status,
  model: r.model,
  promptVersion: r.prompt_version,
  inputRevision: r.input_revision,
  startedAt: iso(r.started_at),
  completedAt: r.completed_at ? iso(r.completed_at) : null,
  report: r.report,
  attachments: r.attachments,
  sources: r.sources,
  error: r.error,
  outdated:
    !!current &&
    (current.proposal_version !== r.proposal_version ||
      hash(canonical(current.profile)) !== r.input_revision),
});
const expireVet =
  "UPDATE community.profile_vet_runs SET status='failed',completed_at=now(),error='The check was interrupted or timed out. Run Vet again.' WHERE status='running' AND expires_at<=now()";
export async function beginProfileVet(
  store: Store,
  id: string,
  proposalVersion: number,
  actor: Actor,
  options: { model: string; promptVersion: string },
) {
  reviewer(actor);
  try {
    return await store.transaction(async (tx) => {
      const r = await revision(tx, id, actor, true);
      if (r.proposal_version !== proposalVersion)
        fail('CONFLICT', 'This proposal changed. Save and reload before running Vet.');
      await tx.query(expireVet);
      const row = (
        await tx.query<VetRow>(
          "INSERT INTO community.profile_vet_runs(id,revision_id,proposal_version,reviewer_id,status,model,prompt_version,input_revision) VALUES($1,$2,$3,$4,'running',$5,$6,$7) RETURNING *",
          [
            randomUUID(),
            id,
            proposalVersion,
            actor.userId,
            options.model,
            options.promptVersion,
            hash(canonical(r.profile)),
          ],
        )
      ).rows[0]!;
      return vet(row, r);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      fail('CONFLICT', 'Another Vet check is running. Wait for it to finish.');
    throw e;
  }
}
export async function finishProfileVet(
  store: Store,
  id: string,
  actor: Actor,
  result: { report: unknown; attachments: unknown[]; sources: unknown[]; error: string | null },
) {
  reviewer(actor);
  return store.transaction(async (tx) => {
    const row = (
      await tx.query<VetRow>(
        "UPDATE community.profile_vet_runs SET status=$2,report=$3::jsonb,attachments=$4::jsonb,sources=$5::jsonb,error=$6,completed_at=now() WHERE id=$1 AND status='running' AND expires_at>now() RETURNING *",
        [
          id,
          result.error ? 'failed' : 'completed',
          JSON.stringify(result.report),
          JSON.stringify(result.attachments),
          JSON.stringify(result.sources),
          result.error,
        ],
      )
    ).rows[0];
    if (!row) fail('CONFLICT', 'This check expired or its proposal was deleted.');
    return vet(row!, await revision(tx, row!.revision_id, actor));
  });
}
export async function latestProfileVet(store: Store, id: string, actor: Actor) {
  reviewer(actor);
  return store.transaction(async (tx) => {
    const r = await revision(tx, id, actor);
    await tx.query(expireVet);
    const row = (
      await tx.query<VetRow>(
        'SELECT * FROM community.profile_vet_runs WHERE revision_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1',
        [id],
      )
    ).rows[0];
    return row ? vet(row, r) : null;
  });
}
async function deleteLegacyInTransaction(tx: Store, id: string) {
  const row = (
    await tx.query<{ status: string; published_entry_id: string | null }>(
      'SELECT status,published_entry_id FROM community.submissions WHERE id=$1 FOR UPDATE',
      [id],
    )
  ).rows[0];
  if (!row) fail('NOT_FOUND', 'This legacy submission is unavailable.');
  if (
    !['draft', 'pending', 'needs-information', 'rejected'].includes(row!.status) ||
    row!.published_entry_id
  )
    fail(
      'CONFLICT',
      'Accepted legacy publications cannot be deleted through the transition queue.',
    );
  const photos = (
    await tx.query<{ data: { originalKey?: string; publicKey?: string } }>(
      'SELECT data FROM community.photos WHERE submission_id=$1',
      [id],
    )
  ).rows;
  for (const table of [
    'vet_runs',
    'publication_revisions',
    'reviews',
    'mail_events',
    'supplements',
    'photos',
    'contacts',
  ])
    await tx.query(`DELETE FROM community.${table} WHERE submission_id=$1`, [id]);
  await tx.query('DELETE FROM community.submissions WHERE id=$1', [id]);
  for (const key of [
    ...new Set(
      photos.flatMap((p) => [p.data.originalKey, p.data.publicKey]).filter((k): k is string => !!k),
    ),
  ]) {
    // Retain shared pending and accepted legacy objects, and objects used by canonical media.
    const shared = (
      await tx.query(
        "SELECT 1 FROM community.photos WHERE data->>'originalKey'=$1 OR data->>'publicKey'=$1 UNION ALL SELECT 1 FROM community.profile_media WHERE object_key=$1 LIMIT 1",
        [key],
      )
    ).rows.length;
    if (shared) continue;
    const requestId = `legacy-cleanup-${hash(key).slice(0, 64)}`;
    await tx.query(
      "INSERT INTO community.profile_requests(request_id,receipt_hash,payload_hash,expires_at) VALUES($1,$2,'legacy-cleanup',now()) ON CONFLICT DO NOTHING",
      [requestId, hash(randomUUID())],
    );
    await tx.query(
      "INSERT INTO community.profile_media(id,request_id,object_key,content_type,bytes,original_name,sha256,ready,state) VALUES($1,$2,$3,'application/octet-stream',0,'Removed legacy upload',$4,true,'queued') ON CONFLICT DO NOTHING",
      [requestId, requestId, key, '0'.repeat(64)],
    );
  }
}
export async function deleteLegacySubmission(id: string, actor: Actor, store?: Store) {
  reviewer(actor);
  await (store ?? (await getStore())).transaction((tx) => deleteLegacyInTransaction(tx, id));
  return { deleted: true as const };
}
export async function purgeLegacyDiscarded(store: Store) {
  await store.transaction(async (tx) => {
    const rows = (
      await tx.query<{ id: string }>(
        "SELECT id FROM community.submissions WHERE status IN('draft','rejected') AND published_entry_id IS NULL ORDER BY id FOR UPDATE",
      )
    ).rows;
    for (const row of rows) await deleteLegacyInTransaction(tx, row.id);
  });
}
