import { z } from 'zod';
const id = z.string().trim().min(1).max(120);
const text = z.string().trim().max(20000);
const required = text.min(1);
const internal = z
  .string()
  .max(2000)
  .regex(
    /^\/(?:api\/(?:community|profiles)\/(?:media|photos)|contributions|people|images|media|portraits|uploads)\/[^\s]*$/,
  );
const http = z
  .string()
  .url()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Use an HTTP(S) URL.');
/** Managed endpoints must keep their registered identity; absolute aliases are not portable evidence. */
export function managedProfileMediaURL(
  value: string,
): { namespace: 'profiles' | 'community'; id: string; canonical: boolean } | null {
  try {
    const parsed = new URL(value, 'https://profile.invalid');
    let path: string;
    try {
      path = decodeURIComponent(parsed.pathname);
    } catch {
      path = parsed.pathname.replace(/%([a-f0-9]{2})/gi, (_token, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
    const match = /^\/api\/(profiles|community)\/(media|photos)(?:\/(.*))?$/.exec(path);
    if (!match) return null;
    return {
      namespace: match[1] as 'profiles' | 'community',
      id: match[3] ?? '',
      canonical:
        !!match[3] &&
        match[2] === 'media' &&
        value === `/api/${match[1]}/media/${encodeURIComponent(match[3]!)}`,
    };
  } catch {
    return null;
  }
}
export function profileBodyMediaURLs(body: string): string[] {
  return [...body.matchAll(/https?:\/\/[^\s<>()\]"']+|\/[^\s<>()\]"']+/g)]
    .map((m) => m[0])
    .filter((value) => managedProfileMediaURL(value) !== null);
}
const ids = z.array(id).max(50);
export const profileSourceSchema = z
  .object({
    id,
    title: required.max(200),
    kind: z.enum(['link', 'attachment', 'memory']),
    url: http.or(internal).optional(),
    mediaId: id.optional(),
    creator: text.max(200).optional(),
    rights: text.optional(),
    locator: text.optional(),
  })
  .superRefine((v, c) => {
    if (v.kind === 'link' && !v.url)
      c.addIssue({ code: 'custom', path: ['url'], message: 'A link requires a URL.' });
    if (v.kind === 'attachment' && !v.mediaId && !v.url)
      c.addIssue({ code: 'custom', path: ['mediaId'], message: 'An attachment requires media.' });
    if (v.kind === 'memory' && !v.creator?.trim())
      c.addIssue({
        code: 'custom',
        path: ['creator'],
        message: 'A recollection needs public author credit.',
      });
  });
export const profileLocationSchema = z.object({
  id,
  name: required.max(200),
  label: required.max(200),
  description: text.max(4000),
  scope: z.enum(['cemetery', 'atlanta']),
  address: text.optional(),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable(),
  precision: z.enum(['reference', 'address', 'verified', 'unmapped']),
  sourceIds: ids.min(1),
  coordinateSourceIds: ids,
  locationNote: text,
});
export const profileSchema = z
  .object({
    name: required.max(160),
    aliases: z.array(text.max(160)).max(50).optional(),
    birthYear: z.number().int().min(-10000).max(3000).optional(),
    deathYear: z.number().int().min(-10000).max(3000).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50),
    bodyMarkdown: required,
    bodySourceIds: ids.min(1),
    sources: z.array(profileSourceSchema).min(1).max(50),
    portrait: z
      .object({
        url: http
          .or(z.string().regex(/^\/(?:api\/|images\/|media\/|portraits\/|uploads\/)[^\s]*$/))
          .optional(),
        mediaId: id.optional(),
        alt: required,
        credit: required,
        rights: required,
        sourceIds: ids.min(1),
      })
      .optional(),
    locations: z.array(profileLocationSchema).max(50),
  })
  .superRefine((v, c) => {
    const issue = (path: (string | number)[], message: string) =>
      c.addIssue({ code: 'custom', path, message });
    if (v.birthYear !== undefined && v.deathYear !== undefined && v.birthYear > v.deathYear)
      issue(['deathYear'], 'Death precedes birth.');
    for (const [key, values] of [
      ['sources', v.sources.map((s) => s.id)],
      ['locations', v.locations.map((l) => l.id)],
      ['tags', v.tags.map((t) => t.toLowerCase())],
    ] as const)
      if (new Set(values).size !== values.length) issue([key], 'Duplicate values.');
    const sources = new Set(v.sources.map((s) => s.id));
    const check = (refs: string[], path: (string | number)[]) => {
      if (new Set(refs).size !== refs.length) issue(path, 'Duplicate source references.');
      refs.forEach((r) => {
        if (!sources.has(r)) issue(path, `Missing source: ${r}`);
      });
    };
    check(v.bodySourceIds, ['bodySourceIds']);
    for (const m of v.bodyMarkdown.matchAll(/\[(?:\^|source:)([^\]\n]+)\]/g))
      if (!sources.has(m[1]!)) issue(['bodyMarkdown'], `Missing citation source: ${m[1]}`);
    if (v.portrait) {
      check(v.portrait.sourceIds, ['portrait', 'sourceIds']);
      if (!v.portrait.mediaId && !v.portrait.url)
        issue(['portrait'], 'A portrait requires an image.');
    }
    const managedIds = new Set([
      ...v.sources.flatMap((s) => (s.mediaId ? [s.mediaId] : [])),
      ...(v.portrait?.mediaId ? [v.portrait.mediaId] : []),
    ]);
    const checkManaged = (
      url: string | undefined,
      mediaId: string | undefined,
      path: (string | number)[],
      body = false,
    ) => {
      if (!url) return;
      const ref = managedProfileMediaURL(url);
      if (!ref) return;
      if (!ref.canonical) {
        issue(path, 'Use the exact relative managed media URL.');
        return;
      }
      if (ref.namespace === 'profiles' && (body ? !managedIds.has(ref.id) : mediaId !== ref.id))
        issue(path, 'Managed evidence must reference its registered mediaId in this profile.');
    };
    v.sources.forEach((source, i) =>
      checkManaged(source.url, source.mediaId, ['sources', i, 'url']),
    );
    checkManaged(v.portrait?.url, v.portrait?.mediaId, ['portrait', 'url']);
    profileBodyMediaURLs(v.bodyMarkdown).forEach((url) =>
      checkManaged(url, undefined, ['bodyMarkdown'], true),
    );
    v.locations.forEach((l, i) => {
      check(l.sourceIds, ['locations', i, 'sourceIds']);
      check(l.coordinateSourceIds, ['locations', i, 'coordinateSourceIds']);
      if (l.coordinates && (l.precision === 'unmapped' || !l.coordinateSourceIds.length))
        issue(['locations', i], 'Mapped coordinates need coordinate evidence and precision.');
      if (!l.coordinates && l.precision !== 'unmapped')
        issue(['locations', i], 'Missing coordinates.');
    });
  });
export const profileSubmissionSchema = z
  .object({
    requestId: id,
    receiptToken: z.string().regex(/^[A-Za-z0-9_-]{64,256}$/),
    personId: id.nullable(),
    baseVersion: z.number().int().min(1).nullable(),
    profile: profileSchema,
    privateName: required,
    email: z.string().trim().email().max(320),
    publicCredit: required,
    permission: z.literal(true),
  })
  .superRefine((v, c) => {
    if ((v.personId === null) !== (v.baseVersion === null))
      c.addIssue({
        code: 'custom',
        path: ['baseVersion'],
        message: 'An existing person requires a base version; a new person must not have one.',
      });
  });
export type ProfileSource = z.infer<typeof profileSourceSchema>;
export type ProfileLocation = z.infer<typeof profileLocationSchema>;
export type PersonProfile = z.infer<typeof profileSchema>;
export type ProfileSubmission = z.infer<typeof profileSubmissionSchema>;
export type PublishedProfile = {
  publicCredit?: string;
  id: string;
  version: number;
  profile: PersonProfile;
  updatedAt: string;
};
export type ProfileProposal = {
  id: string;
  requestId?: string;
  personId: string | null;
  baseVersion: number | null;
  proposalVersion: number;
  profile: PersonProfile;
  createdAt: string;
  publicCredit: string;
  updatedAt?: string;
  privateName?: string;
  email?: string;
  userId?: string | null;
};
