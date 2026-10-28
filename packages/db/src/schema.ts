import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  ArchiveData,
  PersonProfile,
  Material,
  Person,
  PersonPlace,
  Place,
  Source,
} from '@southview/validators';

// Kept outside public: the Next.js server owns access to the archive.
const archive = pgSchema('archive');

export const credits = archive.table('credits', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<ArchiveData['credits'][number]>().notNull(),
});

export const sources = archive.table('sources', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Source>().notNull(),
});
export const persons = archive.table('persons', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Person | PersonProfile>().notNull(),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const places = archive.table('places', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Place>().notNull(),
});
export const personPlaces = archive.table(
  'person_places',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => persons.id),
    placeId: text('place_id')
      .notNull()
      .references(() => places.id),
    data: jsonb('data').$type<PersonPlace>().notNull(),
  },
  (table) => [
    index('person_places_person_idx').on(table.personId),
    index('person_places_place_idx').on(table.placeId),
  ],
);
export const materials = archive.table(
  'materials',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => persons.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    data: jsonb('data').$type<Material>().notNull(),
  },
  (table) => [index('materials_person_idx').on(table.personId)],
);
export const issues = archive.table('issues', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => persons.id),
  data: jsonb('data').$type<ArchiveData['issues'][number]>().notNull(),
});
export const crosswalk = archive.table(
  'crosswalk',
  {
    project: text('project').notNull(),
    externalId: text('external_id').notNull(),
    personId: text('person_id').references(() => persons.id),
    data: jsonb('data').$type<ArchiveData['crosswalk'][number]>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project, table.externalId] })],
);
export const contributions = archive.table('contributions', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => persons.id),
  creditId: text('credit_id')
    .notNull()
    .references(() => credits.id),
  data: jsonb('data').$type<ArchiveData['contributions'][number]>().notNull(),
});

// Complete profile replacements; the zero-version legacy shape is consumed only by conversion.
const community = pgSchema('community');
export const profileRevisions = community.table('profile_revisions', {
  id: text('id').primaryKey(),
  requestId: text('request_id')
    .notNull()
    .unique()
    .references(() => profileRequests.requestId),
  personId: text('person_id').references(() => persons.id),
  baseVersion: integer('base_version'),
  proposalVersion: integer('proposal_version').notNull().default(1),
  profile: jsonb('profile').$type<PersonProfile>().notNull(),
  privateName: text('private_name').notNull(),
  email: text('email').notNull(),
  publicCredit: text('public_credit').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const profileVersions = community.table(
  'profile_versions',
  {
    personId: text('person_id')
      .notNull()
      .references(() => persons.id),
    version: integer('version').notNull(),
    profile: jsonb('profile').$type<PersonProfile>().notNull(),
    reviewerId: text('reviewer_id'),
    publicCredit: text('public_credit').notNull(),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.personId, table.version] })],
);
export const profileRequests = community.table('profile_requests', {
  requestId: text('request_id').primaryKey(),
  receiptHash: text('receipt_hash').notNull(),
  userId: text('user_id'),
  payloadHash: text('payload_hash'),
  revisionId: text('revision_id'),
  personId: text('person_id').references(() => persons.id),
  version: integer('version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const profileMedia = community.table('profile_media', {
  id: text('id').primaryKey(),
  requestId: text('request_id')
    .notNull()
    .references(() => profileRequests.requestId),
  objectKey: text('object_key').notNull().unique(),
  contentType: text('content_type').notNull(),
  bytes: integer('bytes').notNull(),
  originalName: text('original_name').notNull(),
  sha256: text('sha256').notNull(),
  ready: boolean('ready').notNull().default(false),
  state: text('state').notNull().default('active'),
  cleanupClaimedAt: timestamp('cleanup_claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const profileMediaRefs = community.table(
  'profile_media_refs',
  {
    mediaId: text('media_id')
      .notNull()
      .references(() => profileMedia.id),
    revisionId: text('revision_id').references(() => profileRevisions.id, { onDelete: 'cascade' }),
    personId: text('person_id'),
    version: integer('version'),
  },
  (table) => [
    foreignKey({
      columns: [table.personId, table.version],
      foreignColumns: [profileVersions.personId, profileVersions.version],
    }),
  ],
);
export const profileVetRuns = community.table('profile_vet_runs', {
  id: text('id').primaryKey(),
  revisionId: text('revision_id')
    .notNull()
    .references(() => profileRevisions.id, { onDelete: 'cascade' }),
  proposalVersion: integer('proposal_version').notNull(),
  reviewerId: text('reviewer_id').notNull(),
  status: text('status').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  inputRevision: text('input_revision').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  report: jsonb('report'),
  attachments: jsonb('attachments').notNull().default([]),
  sources: jsonb('sources').notNull().default([]),
  error: text('error'),
});
export const profileLegacyLinks = archive.table('profile_legacy_links', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => persons.id),
  anchor: text('anchor'),
});
