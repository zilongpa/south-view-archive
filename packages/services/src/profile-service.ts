import { createHash, randomUUID } from 'node:crypto';
import { getStore, type Store } from '@southview/db/connection';
import { DomainError } from '@southview/db/community';
import {
  abandonProfileUploads,
  authorizeProfileMedia,
  completeProfileCleanup,
  createProfileRepository,
  failProfileCleanup,
  listProfileCleanup,
  markProfileMediaReady,
  purgeLegacyDiscarded,
  registerProfileMedia,
} from '@southview/db/profiles';
import {
  profileSubmissionSchema,
  profileSchema,
  type Actor,
  type PersonProfile,
} from '@southview/validators';
import { processPhoto } from './photos';
import {
  getStorage,
  MAX_PHOTO_BYTES,
  type MediaContentType,
  type PrivateObject,
  type PrivateStorage,
} from './storage';

export const MAX_PROFILE_FILES = 10;
export const MAX_PROFILE_FILE_BYTES = 50 * 1024 * 1024;
export const PROFILE_REQUEST_BYTES = MAX_PROFILE_FILE_BYTES + 2 * 1024 * 1024;
const bad = (message: string): never => {
  throw new DomainError('BAD_REQUEST', message);
};
export type PreparedProfileFile = {
  bytes: Buffer;
  contentType: MediaContentType;
  extension: 'jpg' | 'pdf';
  sha256: string;
  originalName: string;
};

/** Decode from bytes, rather than trusting names or the browser's MIME declaration. */
export async function prepareProfileFile(
  file: File,
  portrait: boolean,
): Promise<PreparedProfileFile> {
  if (!file.size || file.size > MAX_PHOTO_BYTES)
    return bad('Each evidence file must be between 1 byte and 10 MiB.');
  const input = Buffer.from(await file.arrayBuffer());
  let bytes: Buffer, contentType: MediaContentType, extension: 'jpg' | 'pdf';
  if (input.subarray(0, 5).toString('ascii') === '%PDF-') {
    if (portrait) return bad('Choose a JPEG, PNG, or WebP image for the portrait.');
    if (
      !/^%PDF-\d\.\d[\r\n]/.test(input.subarray(0, 16).toString('ascii')) ||
      !/%%EOF\s*$/.test(input.subarray(-2048).toString('ascii'))
    )
      return bad('Choose a complete PDF evidence document.');
    bytes = input;
    contentType = 'application/pdf';
    extension = 'pdf';
  } else {
    try {
      bytes = (await processPhoto(input)).processed;
    } catch {
      return bad('Choose a valid JPEG, PNG, WebP image or PDF evidence document.');
    }
    contentType = 'image/jpeg';
    extension = 'jpg';
  }
  return {
    bytes,
    contentType,
    extension,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    originalName: file.name.slice(0, 255),
  };
}
function mediaIds(profile: PersonProfile) {
  return new Set(
    [profile.portrait?.mediaId, ...profile.sources.map((source) => source.mediaId)].filter(
      (id): id is string => !!id,
    ),
  );
}
function formPayload(form: FormData): unknown {
  const payloads = form.getAll('payload');
  if (payloads.length !== 1 || typeof payloads[0] !== 'string')
    return bad('Supply one profile payload.');
  if (payloads[0].length > 2 * 1024 * 1024) return bad('This profile payload is too large.');
  try {
    return JSON.parse(payloads[0]);
  } catch {
    return bad('The profile payload could not be read.');
  }
}
async function prepareFiles(form: FormData, profile: PersonProfile) {
  const entries = [...form.entries()].filter(([key]) => key !== 'payload');
  if (entries.length > MAX_PROFILE_FILES) return bad('Submit at most 10 new files.');
  const references = mediaIds(profile),
    seen = new Set<string>();
  let total = 0;
  const selected: { id: string; file: File }[] = [];
  for (const [key, value] of entries) {
    if (!key.startsWith('file:') || typeof value === 'string')
      return bad('Unsupported profile form field.');
    const id = key.slice(5);
    if (!id || id.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id))
      return bad('Each uploaded file needs a unique media ID.');
    if (!references.has(id)) return bad('Every uploaded file must be referenced by the profile.');
    seen.add(id);
    total += value.size;
    if (total > MAX_PROFILE_FILE_BYTES) return bad('Submit at most 50 MiB of new files.');
    selected.push({ id, file: value });
  }
  // Validate all files before reserving or writing the first object.
  const files = [];
  for (const item of selected)
    files.push({
      id: item.id,
      ...(await prepareProfileFile(item.file, profile.portrait?.mediaId === item.id)),
    });
  return files;
}
export async function parseProfileSubmission(form: FormData) {
  const submission = profileSubmissionSchema.parse(formPayload(form));
  return { submission, files: await prepareFiles(form, submission.profile) };
}
type Dependencies = { store?: Store; storage?: PrivateStorage };
async function persistFiles(
  files: Awaited<ReturnType<typeof prepareFiles>>,
  requestId: string,
  receiptToken: string,
  actor: Actor,
  store: Store,
  storage: PrivateStorage,
) {
  for (const file of files) {
    const reservation = await registerProfileMedia(
      store,
      {
        id: file.id,
        requestId,
        receiptToken,
        objectKey: `evidence/${randomUUID()}.${file.extension}`,
        contentType: file.contentType,
        bytes: file.bytes.byteLength,
        originalName: file.originalName,
        sha256: file.sha256,
      },
      actor,
    );
    if (reservation.ready) continue;
    // Recover a crash after storage write and before readiness persisted.
    const existing = await storage.read(reservation.objectKey);
    if (existing) {
      if (
        existing.contentType !== file.contentType ||
        createHash('sha256').update(existing.bytes).digest('hex') !== file.sha256
      )
        return bad('The stored evidence does not match this retry.');
    } else {
      try {
        await storage.write(reservation.objectKey, file.bytes, file.contentType);
      } catch (error) {
        // A concurrent identical retry or lost write acknowledgement is recoverable.
        const recovered = await storage.read(reservation.objectKey);
        if (
          !recovered ||
          recovered.contentType !== file.contentType ||
          createHash('sha256').update(recovered.bytes).digest('hex') !== file.sha256
        )
          throw error;
      }
    }
    await markProfileMediaReady(store, file.id, actor);
  }
}
export async function submitProfileForm(
  form: FormData,
  actor: Actor,
  dependencies: Dependencies = {},
) {
  const { submission, files } = await parseProfileSubmission(form);
  const store = dependencies.store ?? (await getStore());
  const owner = { ...actor, receiptToken: submission.receiptToken };
  if (files.length)
    await persistFiles(
      files,
      submission.requestId,
      submission.receiptToken,
      owner,
      store,
      dependencies.storage ?? getStorage(),
    );
  return createProfileRepository(store).submit(submission, owner);
}
export async function saveProfileForm(
  id: string,
  form: FormData,
  actor: Actor,
  dependencies: Dependencies = {},
) {
  const store = dependencies.store ?? (await getStore());
  const repository = createProfileRepository(store);
  // Authorize before parsing or storing reviewer replacement files.
  if (!actor.reviewer || !actor.userId)
    throw new DomainError('FORBIDDEN', 'A reviewer account is required.');
  const proposal = await repository.get(id, actor);
  if (!('profile' in proposal) || !('requestId' in proposal))
    throw new DomainError('NOT_FOUND', 'The pending proposal is unavailable.');
  const payload = formPayload(form);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return bad('Supply the complete reviewer edit payload.');
  const value = payload as Record<string, unknown>;
  const profile = profileSchema.parse(value.profile);
  const files = await prepareFiles(form, profile);
  const { proposalVersion, baseVersion } = value;
  if (
    !Number.isInteger(proposalVersion) ||
    Number(proposalVersion) < 1 ||
    !(baseVersion === null || (Number.isInteger(baseVersion) && Number(baseVersion) >= 1))
  )
    return bad('Supply the proposal and base versions.');
  if (files.length)
    await persistFiles(
      files,
      String(proposal.requestId),
      '',
      actor,
      store,
      dependencies.storage ?? getStorage(),
    );
  return repository.save(id, profile, Number(proposalVersion), baseVersion as number | null, actor);
}
export function profileMediaResponse(file: PrivateObject) {
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      ...(file.contentType === 'application/pdf'
        ? { 'Content-Disposition': 'attachment; filename="evidence.pdf"' }
        : {}),
    },
  });
}
export async function readProfileMedia(id: string, actor: Actor, dependencies: Dependencies = {}) {
  const store = dependencies.store ?? (await getStore());
  const metadata = await authorizeProfileMedia(store, id, actor);
  if (!metadata) throw new DomainError('NOT_FOUND', 'This evidence file is unavailable.');
  const file = await (dependencies.storage ?? getStorage()).read(metadata.objectKey);
  if (!file) throw new DomainError('NOT_FOUND', 'This evidence file is unavailable.');
  return profileMediaResponse(file);
}
/** Durable claims block new references; failed deletions remain queued for another run. */
export async function cleanupProfileMedia(dependencies: Dependencies = {}) {
  const store = dependencies.store ?? (await getStore()),
    storage = dependencies.storage ?? getStorage();
  await purgeLegacyDiscarded(store);
  await abandonProfileUploads(store);
  const candidates = await listProfileCleanup(store);
  let deleted = 0,
    failed = 0;
  for (const file of candidates) {
    try {
      await storage.delete(file.objectKey);
      await completeProfileCleanup(store, file.id);
      deleted++;
    } catch {
      await failProfileCleanup(store, file.id);
      failed++;
    }
  }
  return { deleted, failed };
}
