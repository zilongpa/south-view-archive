import type { ArchiveData, SubmissionRecord, SubmissionStatus } from '@southview/validators';

export const reviewStatuses = ['pending', 'needs-information', 'published', 'rejected', 'withdrawn', 'all'] as const;
export const reviewKinds = ['all', 'memory', 'addition', 'correction', 'new-person'] as const;
export const kindLabels = { all: 'All types', memory: 'Community memory', addition: 'Archive addition', correction: 'Correction', 'new-person': 'New person' };
export const reviewLabels: Record<SubmissionStatus | 'all', string> = {
  all: 'All submissions', draft: 'Draft', pending: 'Awaiting review',
  'needs-information': 'Needs information', published: 'Published', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
export type ReviewState = { status: typeof reviewStatuses[number]; kind: typeof reviewKinds[number]; q: string; submission: string | null };
export function parseReviewState(params: { get(name: string): string | null }): ReviewState {
  const status = params.get('status');
  const kind = params.get('kind');
  return {
    status: reviewStatuses.includes(status as ReviewState['status']) ? status as ReviewState['status'] : 'pending',
    kind: reviewKinds.includes(kind as ReviewState['kind']) ? kind as ReviewState['kind'] : 'all',
    q: (params.get('q') ?? '').slice(0, 200),
    submission: params.get('submission')?.slice(0, 120) || null,
  };
}
export function reviewUrl(state: ReviewState) {
  const params = new URLSearchParams();
  if (state.status !== 'pending') params.set('status', state.status);
  if (state.kind !== 'all') params.set('kind', state.kind);
  if (state.q) params.set('q', state.q);
  if (state.submission) params.set('submission', state.submission);
  return `/admin/contributions${params.size ? `?${params}` : ''}`;
}
export function submissionPerson(record: SubmissionRecord, archive: ArchiveData) {
  return archive.people.find((person) => person.id === record.input.personId)?.name || record.input.proposedPersonName || 'Person not yet matched';
}
export function filterReviewQueue(items: SubmissionRecord[], state: ReviewState, archive: ArchiveData) {
  const query = state.q.trim().toLocaleLowerCase();
  return items.filter((item) => item.status !== 'draft' &&
    (state.status === 'all' || item.status === state.status) &&
    (state.kind === 'all' || item.input.kind === state.kind) &&
    (!query || [item.id, item.input.title, submissionPerson(item, archive), ...archive.people.filter((person) => item.input.relatedPersonIds.includes(person.id)).map((person) => person.name)].some((text) => text.toLocaleLowerCase().includes(query))));
}
// Selection is independent of filters so a saved decision stays on screen.
export function selectedReview(items: SubmissionRecord[], visible: SubmissionRecord[], id: string | null) {
  return id ? items.find((item) => item.id === id && item.status !== 'draft') : visible[0];
}

export type VetEvidence = { title: string; url: string; excerpt?: string; accessedAt: string };
export type VetResult = {
  submissionId: string;
  inputRevision: string;
  model: string;
  checkedAt: string;
  summary: string;
  findings: { id: string; title: string; explanation: string; submissionExcerpt?: string; evidence: VetEvidence[] }[];
  webSearch: 'not-used' | 'completed' | 'failed';
};
export type VetState =
  | { status: 'not-configured' | 'not-checked' }
  | { status: 'running'; startedAt: string }
  | { status: 'completed' | 'outdated'; result: VetResult }
  | { status: 'failed'; message: string };
export const unavailableVet: VetState = { status: 'not-configured' };
