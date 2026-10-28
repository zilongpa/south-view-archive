import { createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import { dataMode, getStore } from '@southview/db/connection';
import { consumeRateLimit, DomainError } from '@southview/db/community';
import { createProfileRepository, readPublishedProfiles } from '@southview/db/profiles';
import { getSession, isReviewer } from '@southview/services/auth';
import {
  PROFILE_REQUEST_BYTES,
  readProfileMedia,
  saveProfileForm,
  submitProfileForm,
} from '@southview/services/profile-service';
import { getProfileVet, runProfileVet } from '@southview/services/profile-vet';
import { profileSchema, type Actor } from '@southview/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const version = z.number().int().min(1);
const actionSchema = z.object({ proposalVersion: version }).strict();
const editSchema = z
  .object({ profile: profileSchema, proposalVersion: version, baseVersion: version.nullable() })
  .strict();
function requireOrigin(request: Request) {
  const expected = new URL(request.url).origin,
    configured = process.env.NEXT_PUBLIC_SITE_URL;
  const allowed = new Set([
    ...(process.env.NODE_ENV !== 'production' ? [expected] : []),
    ...(configured ? [new URL(configured).origin] : []),
  ]);
  if (!allowed.has(request.headers.get('origin') ?? ''))
    throw new HttpError(403, 'Open the profile form on this site to continue.');
}
async function rateLimit(request: Request, bucket: string, max: number) {
  const address =
    process.env.TRUST_PROXY === '1'
      ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local-or-unproxied';
  const key = createHash('sha256').update(`profile:${bucket}:${address}`).digest('hex');
  if (!(await consumeRateLimit(key, max, 60 * 60 * 1000)))
    throw new HttpError(429, 'Please wait before trying again.');
}
async function actorFor(request: Request): Promise<Actor> {
  const session = await getSession(request.headers);
  return {
    userId: session?.user.id ?? null,
    email: session?.user.emailVerified ? session.user.email : null,
    reviewer: session ? await isReviewer(session.user.id) : false,
    receiptToken: request.headers.get('X-Receipt-Token') ?? undefined,
  };
}
function reviewer(actor: Actor) {
  if (!actor.reviewer || !actor.userId) throw new HttpError(403, 'A reviewer account is required.');
}
async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new HttpError(413, 'This submission is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new HttpError(413, 'This submission is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function readJSON(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new HttpError(415, 'Send a JSON request.');
  try {
    return JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 2 * 1024 * 1024)),
    ) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'The request could not be read.');
  }
}
async function readForm(request: Request) {
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    throw new HttpError(415, 'Submit the profile as a multipart form.');
  const body = await boundedBody(request, PROFILE_REQUEST_BYTES);
  try {
    return await new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('content-type')! },
      body,
    }).formData();
  } catch {
    throw new HttpError(400, 'The profile form could not be read.');
  }
}
async function handle(request: Request, context: Context): Promise<Response> {
  try {
    const { path } = await context.params;
    if (
      !path.length ||
      path.length > 3 ||
      path.some((part) => part.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(part))
    )
      throw new HttpError(404, 'Not found.');
    const method = request.method;
    if (method === 'GET' && path.length === 1 && path[0] === 'published')
      return json({ profiles: await readPublishedProfiles() });
    if (dataMode() === 'fixture')
      throw new HttpError(
        503,
        'Fixture mode is read-only. Select local or database mode to submit profiles.',
      );
    if (method !== 'GET') {
      requireOrigin(request);
      await rateLimit(
        request,
        path[0] === 'submissions' ? 'submissions' : 'review',
        path[0] === 'submissions' ? 30 : 120,
      );
    }
    const actor = await actorFor(request);
    const store = await getStore(),
      repository = createProfileRepository(store);
    if (path[0] === 'media' && path.length === 2 && method === 'GET')
      return await readProfileMedia(path[1]!, actor, { store });
    if (path[0] === 'submissions' && path.length === 1 && method === 'POST')
      return json(await submitProfileForm(await readForm(request), actor, { store }), 201);
    if (path[0] === 'submissions' && path.length === 2 && method === 'GET') {
      const result = await repository.get(path[1]!, actor);
      return json('proposalVersion' in result ? { proposal: result } : { publication: result });
    }
    if (path[0] === 'mine' && path.length === 1 && method === 'GET') {
      if (!actor.userId) throw new HttpError(403, 'Sign in to view your submitted profiles.');
      const owner = { ...actor, reviewer: false };
      const [proposals, publications] = await Promise.all([
        repository.list(owner),
        repository.minePublications(owner),
      ]);
      return json({ proposals, publications });
    }
    if (path[0] === 'review') {
      reviewer(actor);
      if (path.length === 1 && method === 'GET')
        return json({ proposals: await repository.list(actor) });
      if (path.length === 2 && method === 'GET')
        return json({ proposal: await repository.get(path[1]!, actor) });
      if (path.length === 2 && method === 'PATCH') {
        if (request.headers.get('content-type')?.includes('multipart/form-data'))
          return json({
            proposal: await saveProfileForm(path[1]!, await readForm(request), actor, { store }),
          });
        const body = editSchema.parse(await readJSON(request));
        return json({
          proposal: await repository.save(
            path[1]!,
            body.profile,
            body.proposalVersion,
            body.baseVersion,
            actor,
          ),
        });
      }
      if (path.length === 3 && path[2] === 'vet') {
        if (method === 'GET') return json({ run: await getProfileVet(path[1]!, actor, store) });
        if (method === 'POST') {
          const body = actionSchema.parse(await readJSON(request));
          return json({
            run: await runProfileVet(path[1]!, body.proposalVersion, actor, { store }),
          });
        }
      }
      if (
        path.length === 3 &&
        method === 'POST' &&
        (path[2] === 'approve' || path[2] === 'reject')
      ) {
        const body = actionSchema.parse(await readJSON(request));
        if (path[2] === 'approve')
          return json({
            publication: await repository.approve(path[1]!, body.proposalVersion, actor),
          });
        await repository.reject(path[1]!, body.proposalVersion, actor);
        return json({ deleted: true });
      }
    }
    if (path[0] === 'history') {
      reviewer(actor);
      if (path.length === 2 && method === 'GET')
        return json({ versions: await repository.history(path[1]!, actor) });
      if (path.length === 3 && path[2] === 'restore' && method === 'POST') {
        const body = z
          .object({ version, currentVersion: version })
          .strict()
          .parse(await readJSON(request));
        return json({
          publication: await repository.restore(path[1]!, body.version, body.currentVersion, actor),
        });
      }
    }
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: 'Check the profile fields and evidence references.',
          issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        },
        400,
      );
    if (error instanceof DomainError)
      return json(
        { error: error.message },
        error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'FORBIDDEN'
            ? 403
            : error.code === 'CONFLICT'
              ? 409
              : 400,
      );
    return json({ error: 'The profile service is unavailable. Please try again.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
