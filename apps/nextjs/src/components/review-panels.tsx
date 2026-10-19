'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CircleCheck, CircleX, FileSearch, Globe, History, Inbox, LoaderCircle, MessageSquareMore, Paperclip, RefreshCw, Search, X } from 'lucide-react';
import { formatEventDate, type ArchiveData, type ReviewInput, type SubmissionRecord } from '@southview/validators';
import { filterReviewQueue, kindLabels, reviewKinds, reviewLabels, reviewStatuses, submissionPerson, type ReviewState, type VetState } from '@/lib/review-state';
import { PrivateSubmissionPhoto } from './submission-manager';

export function ReviewStats({ items, selected, onSelect }: { items: SubmissionRecord[]; selected: string; onSelect: (status: ReviewState['status']) => void }) {
  const stats = [
    { status: 'pending', Icon: Inbox }, { status: 'needs-information', Icon: MessageSquareMore },
    { status: 'published', Icon: CircleCheck }, { status: 'rejected', Icon: CircleX },
  ] as const;
  return <div className="review-stats" aria-label="Submission status filters">{stats.map(({ status, Icon }) => <button key={status} aria-pressed={selected === status} onClick={() => onSelect(status)}>
    <Icon size={20} aria-hidden="true" /><span>{reviewLabels[status]}</span><strong>{items.filter((item) => item.status === status).length}</strong>
  </button>)}</div>;
}

export function ReviewQueue({ items, archive, state, selectedId, onChange, onSelect }: { items: SubmissionRecord[]; archive: ArchiveData; state: ReviewState; selectedId?: string; onChange: (patch: Partial<ReviewState>) => void; onSelect: (id: string) => void }) {
  const visible = filterReviewQueue(items, state, archive);
  return <aside className="review-queue" aria-label="Submission queue">
    <div className="review-queue-tools">
      <div className="review-section-heading"><h2><Inbox size={19} aria-hidden="true" /> Submissions</h2><span aria-live="polite">{visible.length}</span></div>
      <label className="review-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Search title, person or submission ID</span><input type="search" placeholder="Title, person or ID" value={state.q} maxLength={200} onChange={(event) => onChange({ q: event.target.value })} /></label>
      <div className="review-filters">
        <label className="community-field"><span>Status</span><select value={state.status} onChange={(event) => onChange({ status: event.target.value as ReviewState['status'] })}>{reviewStatuses.map((status) => <option key={status} value={status}>{reviewLabels[status]}</option>)}</select></label>
        <label className="community-field"><span>Type</span><select value={state.kind} onChange={(event) => onChange({ kind: event.target.value as ReviewState['kind'] })}>{reviewKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
      </div>
    </div>
    <div className="review-queue-list">
      {visible.map((item) => <button className="review-queue-item" key={item.id} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>
        <span className="community-status" data-status={item.status}>{reviewLabels[item.status]}</span>
        <strong>{item.input.title}</strong><span className="review-person">{submissionPerson(item, archive)}</span>
        <span className="review-byline">{item.input.anonymous ? 'Anonymous contributor' : item.input.displayName}</span>
        <span className="review-row-meta"><time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time><span><Paperclip size={14} aria-hidden="true" /> {item.photos.length}<span className="sr-only"> attachments</span></span></span>
        <span className="review-row-meta"><span>{kindLabels[item.input.kind]}</span><span>Vet: not configured</span></span>
      </button>)}
      {!visible.length && <div className="review-empty"><Inbox size={28} aria-hidden="true" /><h3>No matching submissions</h3><p>Try another search or filter.</p><button className="community-text-button" onClick={() => onChange({ q: '', kind: 'all', status: 'all' })}>Clear filters</button></div>}
    </div>
  </aside>;
}

export function ReviewActions({ status, busy, onDecision }: { status: SubmissionRecord['status']; busy: boolean; onDecision: (action: ReviewInput['action']) => void }) {
  const editable = status === 'pending' || status === 'needs-information';
  return <div className="review-actions" aria-label="Review actions">
    <button className="community-secondary" disabled aria-describedby="vet-unavailable"><FileSearch size={17} aria-hidden="true" /> Vet</button>
    <button className="community-primary" disabled={busy || !editable} onClick={() => onDecision('publish')}><CircleCheck size={17} aria-hidden="true" /> Approve</button>
    <button className="community-danger" disabled={busy || !editable} onClick={() => onDecision('reject')}><CircleX size={17} aria-hidden="true" /> Reject</button>
    {editable && <button className="community-text-button" disabled={busy} onClick={() => onDecision('needs-information')}><MessageSquareMore size={17} aria-hidden="true" /> Request information</button>}
    {status === 'published' && <button className="community-danger" disabled={busy} onClick={() => onDecision('withdraw')}>Withdraw</button>}
  </div>;
}

export function VetPanel({ state, onRun }: { state: VetState; onRun?: () => void }) {
  const labels = { 'not-configured': 'Not configured', 'not-checked': 'Not checked', running: 'Checking', completed: 'Check complete', failed: 'Check failed', outdated: 'Recheck needed' };
  return <section className="review-vet" aria-label="AI check">
    <div className="review-section-heading"><h2><FileSearch size={20} aria-hidden="true" /> AI check</h2><span className="review-vet-status" role="status">{state.status === 'running' && <LoaderCircle size={15} className="community-spinner" />} {labels[state.status]}</span></div>
    {state.status === 'not-configured' && <p id="vet-unavailable">Luna and web search are not enabled yet. You can review and publish without an AI check.</p>}
    {state.status === 'not-checked' && <p>No check has been run for this submission.</p>}
    {state.status === 'running' && <p>Checking this submission. You can continue reviewing the original.</p>}
    {state.status === 'failed' && <p role="alert">{state.message}</p>}
    {(state.status === 'completed' || state.status === 'outdated') && <>
      {state.status === 'outdated' && <p>The submission has changed since this check. These findings refer to an earlier version.</p>}
      <p>{state.result.summary}</p>
      <ul className="review-findings">{state.result.findings.map((finding) => <li key={finding.id}><strong>{finding.title}</strong><p>{finding.explanation}</p>{finding.submissionExcerpt && <blockquote>{finding.submissionExcerpt}</blockquote>}{finding.evidence.filter((source) => /^https?:\/\//i.test(source.url)).map((source, index) => <div key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>{source.excerpt && <p>{source.excerpt}</p>}<small>Accessed {source.accessedAt}</small></div>)}</li>)}</ul>
      <small>{state.result.model} · Checked {state.result.checkedAt} · Web search: {state.result.webSearch}</small>
    </>}
    <div className="review-vet-footer"><span>GPT-6 Luna</span><span><Globe size={14} aria-hidden="true" /> Web search {state.status === 'not-configured' ? 'planned' : 'evidence'}</span>
      {onRun && !['not-configured', 'running'].includes(state.status) && <button className="community-text-button" onClick={onRun}><RefreshCw size={15} /> Run again</button>}
    </div>
  </section>;
}

export function OriginalSubmission({ record, archive }: { record: SubmissionRecord; archive: ArchiveData }) {
  return <div className="review-original">
    <div className="review-section-heading"><h3>Original submission</h3><span>Retained as submitted</span></div>
    <p className="community-body">{record.input.body}</p>
    <dl className="review-facts">
      <div><dt>Person</dt><dd>{submissionPerson(record, archive)}</dd></div>
      <div><dt>Event date</dt><dd>{formatEventDate(record.input.eventDate)}</dd></div>
      <div><dt>Other people</dt><dd>{archive.people.filter((person) => record.input.relatedPersonIds.includes(person.id)).map((person) => person.name).join('; ') || 'None supplied'}</dd></div>
      <div><dt>Places</dt><dd>{archive.places.filter((place) => record.input.placeIds.includes(place.id)).map((place) => place.name).join('; ') || 'None supplied'}</dd></div>
      <div><dt>Context</dt><dd>{record.input.context || 'None supplied'}</dd></div>
      <div><dt>Original author</dt><dd>{record.input.sourceCreator || 'Not supplied'}</dd></div>
      <div><dt>Narrator</dt><dd>{record.input.narrator || 'Not supplied'}</dd></div>
      <div><dt>Holding institution</dt><dd>{record.input.holdingInstitution || 'Not supplied'}</dd></div>
    </dl>
    <section><h3>Submitted sources</h3>{record.input.links.length ? <ul className="review-source-list">{record.input.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a></li>)}</ul> : <p className="community-hint">No external links supplied. Community memories may stand as their own source.</p>}</section>
    <section><h3>Attachments · {record.photos.length}</h3>{record.photos.length ? <div className="community-gallery">{record.photos.map((photo) => <PrivateSubmissionPhoto key={photo.id} submissionId={record.id} photo={photo} original />)}</div> : <p className="community-hint">No photographs supplied.</p>}</section>
    <details className="review-private"><summary>Private contact · reviewers only</summary><dl className="review-facts"><div><dt>Name</dt><dd>{record.input.privateName}</dd></div><div><dt>Email</dt><dd>{record.input.email}</dd></div></dl><p className="community-hint">These details are separate from the public contributor credit.</p></details>
    {record.supplements.length > 0 && <section><h3>Additional information</h3>{record.supplements.map((supplement) => <article className="review-supplement" key={supplement.id}><time>{supplement.createdAt.slice(0, 10)}</time><p className="community-body">{supplement.body}</p></article>)}</section>}
  </div>;
}

export function ReviewHistory({ record }: { record: SubmissionRecord }) {
  return <section><h3><History size={19} aria-hidden="true" /> Review history</h3>{record.reviews.length ? <ol className="community-timeline">{record.reviews.map((review, index) => <li key={`${review.createdAt}-${index}`}><time>{review.createdAt}</time><strong>{({ publish: 'Published', reject: 'Rejected', 'needs-information': 'Information requested', withdraw: 'Withdrawn' } as Record<string, string>)[review.action] ?? review.action}</strong>{review.authorMessage && <p>Message to contributor: {review.authorMessage}</p>}{review.publicNote && <p>Public note: {review.publicNote}</p>}{review.internalNote && <p>Internal note: {review.internalNote}</p>}</li>)}</ol> : <p className="community-hint">No review decisions yet.</p>}</section>;
}

export function ReviewDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="review-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="review-dialog-heading"><h2 id="review-dialog-title">{title}</h2><button autoFocus disabled={busy} onClick={onClose} aria-label="Close confirmation"><X size={21} /></button></div>
    {children}
  </dialog>;
}
