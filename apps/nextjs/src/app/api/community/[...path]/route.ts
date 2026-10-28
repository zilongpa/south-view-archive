import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { dataMode } from '@southview/db/connection';
import * as legacy from '@southview/db/community';
import { readPublishedProfiles, deleteLegacySubmission } from '@southview/db/profiles';
import { getSession, getSignInMethods, isReviewer } from '@southview/services/auth';
import { getMailMode } from '@southview/services/mail';
import { getStorage } from '@southview/services/storage';
import type { Actor, SubmissionRecord } from '@southview/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: privateHeaders });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
function privateView(record: SubmissionRecord, actor: Actor) {
  return {
    ...record,
    photos: record.photos.map(({ originalKey, publicKey, ...photo }) => photo),
    reviews: record.reviews.map((review) =>
      actor.reviewer
        ? review
        : {
            action: review.action,
            authorMessage: review.authorMessage,
            publicNote: review.publicNote,
            createdAt: review.createdAt,
          },
    ),
  };
}
function requireWriteOrigin(request: Request) {
  const allowed = new Set<string>();
  if (process.env.NODE_ENV !== 'production') allowed.add(new URL(request.url).origin);
  if (process.env.NEXT_PUBLIC_SITE_URL)
    allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin);
  if (!allowed.has(request.headers.get('origin') ?? ''))
    throw new HttpError(403, 'Open the review desk on this site to continue.');
}
function legacyMediaPath(url: string | undefined) {
  if (!url?.startsWith('/')) return null;
  try {
    return new URL(url, 'https://archive.invalid').pathname;
  } catch {
    return null;
  }
}
async function handle(request: Request, context: Context): Promise<Response> {
  try {
    const { path } = await context.params;
    if (path.length > 5 || path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part)))
      throw new HttpError(404, 'Not found.');
    const method = request.method;
    const mode = dataMode();
    if (method === 'GET' && path.join('/') === 'session') {
      if (mode === 'fixture')
        return json({
          user: null,
          reviewer: false,
          mode,
          authAvailable: false,
          signInMethods: { emailOtp: false, google: false },
          mailMode: 'disabled',
        });
      const session = await getSession(request.headers);
      const signInMethods = getSignInMethods();
      return json({
        user: session
          ? { id: session.user.id, name: session.user.name, email: session.user.email }
          : null,
        reviewer: session ? await isReviewer(session.user.id) : false,
        mode,
        authAvailable: signInMethods.emailOtp,
        signInMethods,
        mailMode: getMailMode(),
      });
    }
    if (mode === 'fixture')
      throw new HttpError(503, 'Contributions are unavailable in this read-only edition.');
    if (method !== 'GET') {
      requireWriteOrigin(request);
      if (path[0] !== 'review' || path.length !== 2 || method !== 'POST')
        return json(
          {
            error:
              'This contribution workflow has been replaced. Open /contribute to propose a complete person profile.',
          },
          410,
        );
      if (!request.headers.get('content-type')?.includes('application/json'))
        throw new HttpError(415, 'Send a JSON request.');
      if (Number(request.headers.get('content-length') || 0) > 4096)
        throw new HttpError(413, 'Request is too large.');
      const reader = request.body?.getReader();
      let bytes = new Uint8Array();
      if (reader) {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            if (bytes.length + next.value.length > 4096)
              throw new HttpError(413, 'Request is too large.');
            const joined = new Uint8Array(bytes.length + next.value.length);
            joined.set(bytes);
            joined.set(next.value, bytes.length);
            bytes = joined;
          }
        } finally {
          await reader.cancel();
        }
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new HttpError(400, 'Send a valid review request.');
      }
      if (!body || typeof body !== 'object' || !('action' in body) || body.action !== 'reject')
        return json(
          { error: 'Publish a complete profile proposal through the new review desk.' },
          410,
        );
      const actor = await actorFor(request);
      if (!actor.reviewer) throw new HttpError(403, 'Staff review access is required.');
      const key = createHash('sha256').update(`legacy-delete:${actor.userId}`).digest('hex');
      if (!(await legacy.consumeRateLimit(key, 240, 60 * 60 * 1000)))
        throw new HttpError(429, 'Please wait before trying again.');
      await deleteLegacySubmission(path[1]!, actor);
      return json({ deleted: true });
    }
    if (path[0] === 'media' && path.length === 2) {
      // Old file URLs stay valid only while a current canonical profile uses them.
      const target = `/api/community/media/${path[1]}`;
      const used = (await readPublishedProfiles()).some(
        ({ profile }) =>
          legacyMediaPath(profile.portrait?.url) === target ||
          profile.sources.some((source) => legacyMediaPath(source.url) === target),
      );
      if (!used) throw new HttpError(404, 'Image not found.');
      const photo = await legacy.getPublicPhoto(path[1]!);
      if (!photo) throw new HttpError(404, 'Image not found.');
      const file = await getStorage().read(photo.publicKey);
      if (!file) throw new HttpError(404, 'Image not found.');
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          ...privateHeaders,
          'Content-Type': 'image/jpeg',
          'Content-Disposition': 'inline; filename="archive-photo.jpg"',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const actor = await actorFor(request);
    if (path[0] === 'submissions' && path.length === 4 && path[2] === 'photos') {
      const submission = await legacy.getSubmission(path[1]!, actor);
      const photo = submission.photos.find((item) => item.id === path[3]);
      if (!photo) throw new HttpError(404, 'Attachment not found.');
      const original = new URL(request.url).searchParams.get('original') === '1';
      const file = await getStorage().read(original ? photo.originalKey : photo.publicKey);
      if (!file) throw new HttpError(404, 'Attachment not found.');
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          ...privateHeaders,
          'Content-Type': file.contentType,
          'Content-Disposition': `${original ? 'attachment' : 'inline'}; filename="legacy-photo.jpg"`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        },
      });
    }
    if (path.join('/') === 'review') {
      if (!actor.reviewer) throw new HttpError(403, 'Staff review access is required.');
      const submissions = (await legacy.listReviewSubmissions(actor)).filter((item) =>
        ['pending', 'needs-information'].includes(item.status),
      );
      return json({ submissions: submissions.map((item) => privateView(item, actor)) });
    }
    if (path[0] === 'submissions' && path.length === 2)
      return json({ submission: privateView(await legacy.getSubmission(path[1]!, actor), actor) });
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) return json({ error: 'Please check the request.' }, 400);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const statuses: Record<string, number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      CONFLICT: 409,
      BAD_REQUEST: 400,
      VALIDATION: 400,
    };
    if (statuses[code])
      return json(
        {
          error:
            code === 'NOT_FOUND'
              ? 'This submission is no longer available.'
              : code === 'FORBIDDEN'
                ? 'Staff review access is required.'
                : error instanceof Error
                  ? error.message
                  : 'Unable to complete the request.',
        },
        statuses[code],
      );
    console.error(
      'Legacy community request failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return json({ error: 'The request could not be completed.' }, 500);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
