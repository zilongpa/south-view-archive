'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, History, LoaderCircle, Search, Undo2, Users } from 'lucide-react';
import type { ArchiveData, Person, StaffEdit, StaffPersonEdit } from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';

type Fields = {
  name: string;
  aliases: string;
  birthYear: string;
  deathYear: string;
  themes: string;
  summary: string;
};
const fieldLabels: Record<string, string> = {
  name: 'Public name',
  aliases: 'Other names',
  birthYear: 'Birth year',
  deathYear: 'Death year',
  themes: 'Themes',
  summary: 'Summary',
  summaryCitations: 'Summary sources',
  biography: 'Story paragraphs',
  portrait: 'Portrait',
  creditIds: 'Credits',
};
const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
function fieldsFor(person: Person): Fields {
  return {
    name: person.name,
    aliases: person.aliases.join(', '),
    birthYear: person.birthYear ? String(person.birthYear) : '',
    deathYear: person.deathYear ? String(person.deathYear) : '',
    themes: person.themes.join(', '),
    summary: person.summary,
  };
}
/** Only the fields that differ from the saved record. */
function patchFor(fields: Fields, saved: Fields): StaffPersonEdit['patch'] {
  const patch: StaffPersonEdit['patch'] = {};
  if (fields.name.trim() !== saved.name) patch.name = fields.name.trim();
  if (list(fields.aliases).join(', ') !== saved.aliases) patch.aliases = list(fields.aliases);
  if (list(fields.themes).join(', ') !== saved.themes) patch.themes = list(fields.themes);
  if (fields.summary.trim() !== saved.summary) patch.summary = fields.summary.trim();
  for (const key of ['birthYear', 'deathYear'] as const)
    if (fields[key].trim() !== saved[key])
      patch[key] = fields[key].trim() ? Number(fields[key].trim()) : null;
  return patch;
}
function shown(value: unknown) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value))
    return value.every((item) => typeof item === 'string')
      ? value.join(', ') || '—'
      : `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'changed';
  return String(value);
}
const years = (person: Person) =>
  person.birthYear || person.deathYear
    ? `${person.birthYear ?? '?'} – ${person.deathYear ?? '?'}`
    : 'Years unknown';

export function PeopleAdmin({
  archive,
  initialPersonId,
  onPersonChange,
  onDirtyChange,
  confirmLeave,
}: {
  archive: ArchiveData;
  initialPersonId: string | null;
  onPersonChange: (personId: string | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  confirmLeave: () => boolean;
}) {
  const router = useRouter();
  // Records saved here show at once, before the page's archive data refreshes.
  const [saved, setSaved] = useState<Record<string, Person>>({});
  const people = useMemo(
    () =>
      archive.people
        .map((person) => saved[person.id] ?? person)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [archive.people, saved],
  );
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPersonId && people.some((person) => person.id === initialPersonId)
      ? initialPersonId
      : null,
  );
  const [mobileDetail, setMobileDetail] = useState(!!selectedId);
  const visible = people.filter((person) =>
    `${person.name} ${person.aliases.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const selected = people.find((person) => person.id === selectedId) ?? null;

  function choose(personId: string) {
    if (personId === selectedId) {
      setMobileDetail(true);
      return;
    }
    if (!confirmLeave()) return;
    onDirtyChange(false);
    setSelectedId(personId);
    setMobileDetail(true);
    onPersonChange(personId);
  }

  return (
    <div className="review-workspace admin-people" data-mobile-detail={mobileDetail}>
      <aside className="review-queue" aria-label="People in the archive">
        <div className="review-queue-tools">
          <div className="review-section-heading">
            <h2>
              <Users size={19} aria-hidden="true" /> People
            </h2>
            <span aria-live="polite">{visible.length}</span>
          </div>
          <label className="review-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search names or other names</span>
            <input
              type="search"
              placeholder="Name or other name"
              value={q}
              maxLength={200}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
        </div>
        <div className="review-queue-list">
          {visible.map((person) => (
            <button
              className="review-queue-item"
              key={person.id}
              aria-pressed={person.id === selectedId}
              onClick={() => choose(person.id)}
            >
              <strong>{displayPersonName(person.name)}</strong>
              <span className="review-byline">{years(person)}</span>
              {person.themes.length > 0 && (
                <span className="review-row-meta">{person.themes.join(' · ')}</span>
              )}
            </button>
          ))}
          {!visible.length && (
            <div className="review-empty">
              <Users size={28} aria-hidden="true" />
              <h3>No matching people</h3>
              <button className="community-text-button" onClick={() => setQ('')}>
                Clear search
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="review-detail-scroll">
        <button
          className="review-mobile-back community-text-button"
          onClick={() => setMobileDetail(false)}
        >
          <ArrowLeft size={17} /> Back to people
        </button>
        {selected ? (
          <PersonEditor
            key={selected.id}
            person={selected}
            onDirtyChange={onDirtyChange}
            onSaved={(person) => {
              setSaved((value) => ({ ...value, [person.id]: person }));
              router.refresh();
            }}
          />
        ) : (
          <div className="review-empty admin-empty">
            <Users size={28} aria-hidden="true" />
            <h3>Choose a person</h3>
            <p>Correct names, other names, years, themes or the summary without a contribution.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PersonEditor({
  person,
  onDirtyChange,
  onSaved,
}: {
  person: Person;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (person: Person) => void;
}) {
  const [savedFields, setSavedFields] = useState(() => fieldsFor(person));
  const [fields, setFields] = useState(savedFields);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<StaffEdit[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const patch = patchFor(fields, savedFields);
  const changed = Object.keys(patch);

  useEffect(() => {
    onDirtyChange(changed.length > 0 || !!reason.trim());
  }, [changed.length, reason, onDirtyChange]);

  async function loadHistory() {
    try {
      const result = await communityRequest<{ edits: StaffEdit[] }>(
        `/admin/persons/${encodeURIComponent(person.id)}`,
      );
      setHistory(result.edits);
      setHistoryError('');
    } catch (failure) {
      setHistoryError(
        failure instanceof Error ? failure.message : 'The change history could not be loaded.',
      );
    }
  }
  useEffect(() => {
    void loadHistory();
  }, [person.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(key: keyof Fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setNotice('');
  }
  function applySaved(next: Person, message: string) {
    const nextFields = fieldsFor(next);
    setSavedFields(nextFields);
    setFields(nextFields);
    setReason('');
    setNotice(message);
    onSaved(next);
    void loadHistory();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!changed.length) return;
    for (const key of ['birthYear', 'deathYear'] as const)
      if (fields[key].trim() && !/^\d{1,4}$/.test(fields[key].trim())) {
        setError('Enter birth and death years as years, or leave them blank.');
        return;
      }
    if (!fields.name.trim()) {
      setError('Enter the person’s public name.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Say briefly why you are making this change. It is shown in the change history.');
      return;
    }
    setBusy(true);
    try {
      const result = await communityRequest<{ person: Person; edit: StaffEdit | null }>(
        `/admin/persons/${encodeURIComponent(person.id)}`,
        { method: 'POST', body: JSON.stringify({ patch, reason: reason.trim() }) },
      );
      applySaved(
        result.person,
        result.edit
          ? 'Saved. The change is live and listed in the history below.'
          : 'Nothing changed.',
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="review-editor" aria-label={`Edit ${person.name}`}>
      <header className="review-detail-heading">
        <span className="theme-label">Person record</span>
        <h2>{displayPersonName(person.name)}</h2>
        <p>
          <Link href={`/people/${encodeURIComponent(person.id)}`} target="_blank">
            Open the public page <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </p>
      </header>
      <div className="review-detail-content">
        {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
        {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
        <form className="admin-form" onSubmit={save}>
          <div className="community-fields">
            <label className="community-field">
              <span>Public name</span>
              <input
                value={fields.name}
                maxLength={160}
                onChange={(event) => edit('name', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Other names</span>
              <input
                value={fields.aliases}
                placeholder="Separate names with commas"
                onChange={(event) => edit('aliases', event.target.value)}
              />
            </label>
            <div className="community-two-columns">
              <label className="community-field">
                <span>Birth year</span>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Unknown"
                  value={fields.birthYear}
                  onChange={(event) => edit('birthYear', event.target.value)}
                />
              </label>
              <label className="community-field">
                <span>Death year</span>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Unknown"
                  value={fields.deathYear}
                  onChange={(event) => edit('deathYear', event.target.value)}
                />
              </label>
            </div>
            <label className="community-field">
              <span>Themes</span>
              <input
                value={fields.themes}
                placeholder="Separate themes with commas"
                onChange={(event) => edit('themes', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Summary</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={fields.summary}
                onChange={(event) => edit('summary', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Reason for this change *</span>
              <input
                value={reason}
                maxLength={1000}
                placeholder="For example: birth year checked against the death certificate"
                onChange={(event) => setReason(event.target.value)}
              />
              <small>Shown to other staff in the change history. Not shown publicly.</small>
            </label>
          </div>
          <div className="admin-form-actions">
            <button className="community-primary" disabled={busy || !changed.length}>
              {busy && <LoaderCircle size={16} className="community-spinner" />}
              {changed.length
                ? `Save ${changed.map((key) => fieldLabels[key]?.toLowerCase() ?? key).join(', ')}`
                : 'No changes to save'}
            </button>
            {changed.length > 0 && (
              <button
                type="button"
                className="community-text-button"
                onClick={() => {
                  setFields(savedFields);
                  setReason('');
                }}
              >
                Discard changes
              </button>
            )}
          </div>
        </form>
        <ChangeHistory
          history={history}
          error={historyError}
          onUndone={(next) =>
            applySaved(next, 'Undone. The record is back as it was, apart from later changes.')
          }
        />
      </div>
    </section>
  );
}

function ChangeHistory({
  history,
  error,
  onUndone,
}: {
  history: StaffEdit[] | null;
  error: string;
  onUndone: (person: Person) => void;
}) {
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState('');

  async function undo(edit: StaffEdit) {
    if (reason.trim().length < 3) {
      setUndoError('Say briefly why you are undoing this change.');
      return;
    }
    setBusy(true);
    setUndoError('');
    try {
      const result = await communityRequest<{ edit: StaffEdit }>(
        `/admin/edits/${encodeURIComponent(edit.id)}/undo`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      setUndoing(null);
      setReason('');
      onUndone(result.edit.next as unknown as Person);
    } catch (failure) {
      setUndoError(failure instanceof Error ? failure.message : 'The change could not be undone.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-history" aria-labelledby="admin-history-heading">
      <h3 id="admin-history-heading">
        <History size={18} aria-hidden="true" /> Change history
      </h3>
      <p className="admin-history-note">
        Direct corrections made here. Changes that arrived with a published contribution are on the
        Contributions tab, and withdrawing one there keeps any later correction.
      </p>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {history === null && !error && <p className="admin-history-note">Loading…</p>}
      {history?.length === 0 && <p className="admin-history-note">No direct corrections yet.</p>}
      <ol>
        {history?.map((edit) => (
          <li key={edit.id} className={edit.undoneAt ? 'is-undone' : undefined}>
            <div className="admin-history-meta">
              <time dateTime={edit.createdAt}>
                {new Date(edit.createdAt).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              <span>{edit.actorEmail ?? 'Staff'}</span>
              {edit.undoOf && <span className="admin-history-tag">Undo</span>}
              {edit.undoneAt && <span className="admin-history-tag">Undone</span>}
            </div>
            <p className="admin-history-reason">{edit.reason}</p>
            <dl>
              {edit.changedFields.map((field) => (
                <div key={field}>
                  <dt>{fieldLabels[field] ?? field}</dt>
                  <dd>
                    <span>{shown(edit.previous?.[field])}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only"> changed to </span>
                    <span>{shown(edit.next?.[field])}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {!edit.undoneAt && !edit.undoOf && (
              <div className="admin-undo">
                {undoing === edit.id ? (
                  <>
                    <label className="community-field">
                      <span>Why undo this change?</span>
                      <input
                        value={reason}
                        maxLength={1000}
                        autoFocus
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    {undoError && <CommunityNotice kind="error">{undoError}</CommunityNotice>}
                    <div className="admin-form-actions">
                      <button
                        className="community-secondary"
                        disabled={busy}
                        onClick={() => void undo(edit)}
                      >
                        {busy ? (
                          <LoaderCircle size={16} className="community-spinner" />
                        ) : (
                          <Undo2 size={16} aria-hidden="true" />
                        )}
                        Undo this change
                      </button>
                      <button
                        className="community-text-button"
                        onClick={() => {
                          setUndoing(null);
                          setUndoError('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="community-text-button"
                    onClick={() => {
                      setUndoing(edit.id);
                      setReason('');
                      setUndoError('');
                    }}
                  >
                    <Undo2 size={16} aria-hidden="true" /> Undo
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
