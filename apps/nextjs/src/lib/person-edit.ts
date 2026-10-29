import type { Placement, PhotoMetadata, SubmissionInput } from '@southview/validators';

/**
 * Pure helpers for the in-page editing mode on person pages. Each block a visitor adds becomes
 * one ordinary submission, so the review desk, receipts and AI vetting need no changes.
 */
export type EditSection = Placement['section'];
export type EditKind = 'addition' | 'correction' | 'memory';
export type EditPhotoDraft = {
  clientPhotoId: string;
  file: File | null;
  name: string;
  preview: string;
  metadata: Omit<PhotoMetadata, 'permission'> & { permission: boolean };
};
export type EditBlock = {
  /** Client identity; also the submission's idempotent clientRequestId. */
  id: string;
  section: EditSection;
  kind: EditKind;
  /** Biography block id (or index) the block follows or corrects. */
  anchor?: string;
  title: string;
  body: string;
  context: string;
  placeIds: string[];
  proposedPlaceName: string;
  photos: EditPhotoDraft[];
  /** Set when a restored block had photographs that cannot be recovered from sessionStorage. */
  hadPhotos?: boolean;
};
export type EditContact = {
  privateName: string;
  email: string;
  anonymous: boolean;
  displayName: string;
};
export type EditSession = { receiptToken: string; blocks: EditBlock[] };

export const MAX_EDIT_BLOCKS = 10;
export const MAX_BLOCK_PHOTOS = 5;

export function editSessionKey(personId: string) {
  return `south-view-edit:${personId}`;
}

export function sectionLabel(section: EditSection) {
  return {
    biography: 'Their story',
    places: 'Places connected to this life',
    community: 'Contributions & memories',
    portrait: 'Portrait',
  }[section];
}

/** A title reviewers will recognise when the contributor left the field empty. */
export function defaultBlockTitle(block: Pick<EditBlock, 'section' | 'kind'>, personName: string) {
  if (block.kind === 'correction') return `Correction to ${personName}'s story`;
  if (block.section === 'places') return `A place in ${personName}'s life`;
  if (block.section === 'portrait') return `A photograph of ${personName}`;
  if (block.section === 'community') return `A memory of ${personName}`;
  return `An addition to ${personName}'s story`;
}

export type BlockIssue = { field: 'title' | 'body' | 'place' | 'photos'; message: string };

/** Local checks that mirror the server schema so the inline form can explain problems in place. */
export function validateBlock(block: EditBlock): BlockIssue[] {
  const issues: BlockIssue[] = [];
  if (block.title.trim() && block.title.trim().length < 3)
    issues.push({
      field: 'title',
      message: 'Use at least 3 characters, or leave the title empty.',
    });
  if (block.body.trim().length < 20)
    issues.push({ field: 'body', message: 'Write at least 20 characters.' });
  if (block.section === 'places' && !block.placeIds.length && !block.proposedPlaceName.trim())
    issues.push({ field: 'place', message: 'Choose a place, or name one not listed yet.' });
  if (block.section === 'portrait' && !block.photos.length)
    issues.push({ field: 'photos', message: 'Choose the photograph you want to add.' });
  if (block.photos.length > MAX_BLOCK_PHOTOS)
    issues.push({ field: 'photos', message: `Use at most ${MAX_BLOCK_PHOTOS} photographs.` });
  for (const photo of block.photos) {
    const { caption, creator, rights, permission } = photo.metadata;
    if (!caption.trim() || !creator.trim() || !rights.trim() || !permission) {
      issues.push({
        field: 'photos',
        message: 'Each photograph needs a caption, a creator, rights, and your permission.',
      });
      break;
    }
  }
  return issues;
}

export function blockToSubmissionInput(
  block: EditBlock,
  person: { id: string; name: string },
  contact: EditContact,
): SubmissionInput {
  const placement: Placement = {
    section: block.section,
    ...(block.anchor ? { blockId: block.anchor } : {}),
    ...(block.proposedPlaceName.trim()
      ? { proposedPlaceName: block.proposedPlaceName.trim() }
      : {}),
  };
  return {
    clientRequestId: block.id,
    kind: block.kind,
    personId: person.id,
    relatedPersonIds: [],
    placeIds: block.placeIds,
    eventDate: { kind: 'unknown' },
    placement,
    proposedPersonName: '',
    title: block.title.trim() || defaultBlockTitle(block, person.name),
    body: block.body.trim(),
    context: block.context.trim(),
    sourceCreator: '',
    narrator: '',
    holdingInstitution: '',
    links: [],
    privateName: contact.privateName.trim(),
    email: contact.email.trim().toLowerCase(),
    anonymous: contact.anonymous,
    displayName: contact.anonymous ? '' : contact.displayName.trim(),
    permission: true,
  };
}

const sections: EditSection[] = ['biography', 'places', 'community', 'portrait'];
const kinds: EditKind[] = ['addition', 'correction', 'memory'];
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** Restores text blocks saved in this tab. Files cannot be restored; the block says so. */
export function restoreEditSession(value: unknown): EditSession | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  if (typeof saved.receiptToken !== 'string' || saved.receiptToken.length < 64) return null;
  const blocks = Array.isArray(saved.blocks) ? saved.blocks : [];
  const restored: EditBlock[] = [];
  for (const item of blocks.slice(0, MAX_EDIT_BLOCKS)) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (
      typeof block.id !== 'string' ||
      !sections.includes(block.section as EditSection) ||
      !kinds.includes(block.kind as EditKind)
    )
      continue;
    restored.push({
      id: block.id,
      section: block.section as EditSection,
      kind: block.kind as EditKind,
      anchor: typeof block.anchor === 'string' ? block.anchor.slice(0, 120) : undefined,
      title: text(block.title, 160),
      body: text(block.body, 20000),
      context: text(block.context, 4000),
      placeIds: Array.isArray(block.placeIds)
        ? block.placeIds.filter((id): id is string => typeof id === 'string').slice(0, 50)
        : [],
      proposedPlaceName: text(block.proposedPlaceName, 160),
      photos: [],
      hadPhotos:
        block.hadPhotos === true || (typeof block.photoCount === 'number' && block.photoCount > 0),
    });
  }
  return { receiptToken: saved.receiptToken, blocks: restored };
}

/** The serialisable shape written to sessionStorage: text only, never File objects or previews. */
export function serializeEditSession(session: EditSession) {
  return JSON.stringify({
    receiptToken: session.receiptToken,
    blocks: session.blocks.map(({ photos, hadPhotos, ...block }) => ({
      ...block,
      photoCount: photos.length,
      hadPhotos: hadPhotos || photos.length > 0,
    })),
  });
}

/** Receipt URL for one or several submissions sent together under the same private token. */
export function groupedReceiptUrl(ids: string[], token: string) {
  const [first, ...rest] = ids;
  const params = new URLSearchParams({ receipt: token });
  if (rest.length) params.set('also', rest.join(','));
  return `/submissions/${encodeURIComponent(first!)}#${params.toString()}`;
}
