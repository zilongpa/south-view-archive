import { z } from 'zod';

export const contributionKindSchema = z.enum(['memory', 'addition', 'correction', 'new-person']);
const eventYearSchema = z.number().int().min(1).max(9999);
/** Event time is independent of publication time; unknown dates remain explicitly unknown. */
export const eventDateSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('unknown') }),
    z.object({ kind: z.literal('year'), year: eventYearSchema }),
    z.object({ kind: z.literal('approximate'), year: eventYearSchema }),
    z.object({ kind: z.literal('range'), startYear: eventYearSchema, endYear: eventYearSchema }),
  ])
  .superRefine((date, ctx) => {
    if (date.kind === 'range' && date.startYear > date.endYear)
      ctx.addIssue({
        code: 'custom',
        path: ['endYear'],
        message: 'The end year must not precede the start year.',
      });
  });
export type EventDate = z.infer<typeof eventDateSchema>;
export function formatEventDate(date: EventDate | undefined): string {
  if (!date || date.kind === 'unknown') return 'Date unknown';
  if (date.kind === 'range') return `${date.startYear}–${date.endYear}`;
  return date.kind === 'approximate' ? `c. ${date.year}` : String(date.year);
}
export const linkedRecordIdsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .transform((ids) => [...new Set(ids)]);
const webUrl = z.url().refine((value) => /^https?:\/\//i.test(value), 'Use an http or https link.');
export const submissionInputSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    kind: contributionKindSchema,
    personId: z.string().min(1).max(120).nullable(),
    relatedPersonIds: linkedRecordIdsSchema.default([]),
    placeIds: linkedRecordIdsSchema.default([]),
    eventDate: eventDateSchema.default({ kind: 'unknown' }),
    proposedPersonName: z.string().trim().max(160).default(''),
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(20).max(20000),
    context: z.string().trim().max(4000).default(''),
    sourceCreator: z.string().trim().max(200).default(''),
    narrator: z.string().trim().max(200).default(''),
    holdingInstitution: z.string().trim().max(200).default(''),
    links: z
      .array(z.object({ title: z.string().trim().min(1).max(200), url: webUrl }))
      .max(10)
      .default([]),
    privateName: z.string().trim().min(2).max(160),
    email: z.email().transform((value) => value.trim().toLowerCase()),
    anonymous: z.boolean(),
    displayName: z.string().trim().max(160).default(''),
    permission: z.literal(true),
  })
  .superRefine((input, ctx) => {
    if (!input.personId && !input.proposedPersonName)
      ctx.addIssue({
        code: 'custom',
        path: ['proposedPersonName'],
        message: 'Name the person this contribution concerns.',
      });
    if (!input.anonymous && !input.displayName)
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'Choose a public display name or contribute anonymously.',
      });
  })
  .transform((input) => ({
    ...input,
    relatedPersonIds: input.relatedPersonIds.filter((id) => id !== input.personId),
  }));
export const photoMetadataSchema = z.object({
  caption: z.string().trim().min(1).max(500),
  creator: z.string().trim().min(1).max(160),
  rights: z.string().trim().min(1).max(1000),
  permission: z.literal(true),
});
export const creditSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: z.enum(['initial', 'community']),
  date: z.string().optional(),
});
export const publicPhotoSchema = photoMetadataSchema.omit({ permission: true }).extend({
  id: z.string(),
  url: z.string(),
  creditId: z.string(),
  width: z.number(),
  height: z.number(),
});
export const contributionEntrySchema = z
  .object({
    id: z.string(),
    featured: z.boolean().default(false),
    personId: z.string(),
    relatedPersonIds: linkedRecordIdsSchema.default([]),
    placeIds: linkedRecordIdsSchema.default([]),
    eventDate: eventDateSchema.default({ kind: 'unknown' }),
    kind: contributionKindSchema,
    title: z.string(),
    body: z.string(),
    context: z.string(),
    creditId: z.string(),
    sourceCreator: z.string().default(''),
    narrator: z.string().default(''),
    holdingInstitution: z.string().default(''),
    sourceIds: z.array(z.string()),
    photos: z.array(publicPhotoSchema),
    publishedAt: z.string(),
    updatedAt: z.string(),
    publicNote: z.string().optional(),
  })
  .transform((entry) => ({
    ...entry,
    relatedPersonIds: entry.relatedPersonIds.filter((id) => id !== entry.personId),
  }));
export const reviewInputSchema = z
  .object({
    action: z.enum(['publish', 'needs-information', 'reject', 'withdraw']),
    featured: z.boolean().optional(),
    title: z.string().trim().min(3).max(160).optional(),
    body: z.string().trim().min(20).max(20000).optional(),
    context: z.string().trim().max(4000).optional(),
    sourceCreator: z.string().trim().max(200).optional(),
    narrator: z.string().trim().max(200).optional(),
    holdingInstitution: z.string().trim().max(200).optional(),
    photoEdits: z
      .array(
        z.object({
          id: z.string(),
          caption: z.string().trim().min(1).max(500),
          creator: z.string().trim().min(1).max(160),
          rights: z.string().trim().min(1).max(1000),
        }),
      )
      .max(5)
      .optional(),
    personId: z.string().min(1).max(120).nullable().optional(),
    relatedPersonIds: linkedRecordIdsSchema.optional(),
    placeIds: linkedRecordIdsSchema.optional(),
    eventDate: eventDateSchema.optional(),
    newPersonName: z.string().trim().max(160).optional(),
    publicNote: z.string().trim().max(3000).default(''),
    authorMessage: z.string().trim().max(3000).default(''),
    internalNote: z.string().trim().max(5000).default(''),
    sourceIds: z.array(z.string()).max(20).default([]),
    approvedPhotoIds: z.array(z.string()).max(5).optional(),
    applyTo: z.enum(['entry', 'biography', 'place']).default('entry'),
    placePatch: z
      .object({
        placeId: z.string(),
        name: z.string().min(1),
        scope: z.enum(['cemetery', 'atlanta']),
        coordinates: z
          .tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)])
          .nullable(),
        precision: z.enum(['reference', 'address', 'verified', 'unmapped']),
        locationNote: z.string().min(1),
        relationship: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((review, ctx) => {
    if (['reject', 'needs-information'].includes(review.action) && !review.authorMessage.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['authorMessage'],
        message: 'Include a clear message to the contributor explaining this decision.',
      });
  })
  .transform((review) => ({
    ...review,
    ...(review.relatedPersonIds === undefined
      ? {}
      : { relatedPersonIds: review.relatedPersonIds.filter((id) => id !== review.personId) }),
  }));
export type SubmissionInput = z.infer<typeof submissionInputSchema>;
export type PhotoMetadata = z.infer<typeof photoMetadataSchema>;
export type ContributionEntry = z.infer<typeof contributionEntrySchema>;
export type ContributionCredit = z.infer<typeof creditSchema>;
export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type SubmissionStatus =
  | 'draft'
  | 'pending'
  | 'needs-information'
  | 'published'
  | 'rejected'
  | 'withdrawn';
export type Actor = {
  userId: string | null;
  email: string | null;
  reviewer: boolean;
  receiptToken?: string;
};
export type SubmissionPhoto = PhotoMetadata & {
  id: string;
  originalKey: string;
  publicKey: string;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
};
export type SubmissionRecord = {
  id: string;
  input: SubmissionInput;
  status: SubmissionStatus;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  photos: SubmissionPhoto[];
  supplements: { id: string; body: string; createdAt: string }[];
  reviews: {
    action: string;
    authorMessage: string;
    publicNote: string;
    internalNote?: string;
    createdAt: string;
    reviewerId?: string;
  }[];
  publishedEntryId: string | null;
  mailStatus?: string;
};
