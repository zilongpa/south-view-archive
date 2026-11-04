'use client';
import { useCallback, useEffect, useState } from 'react';
import { History, LoaderCircle, Undo2 } from 'lucide-react';
import {
  formatEventDate,
  formatLifeDate,
  type ArchiveData,
  type EventDate,
  type StaffEdit,
} from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';

export const fieldLabels: Record<string, string> = {
  name: 'Name',
  aliases: 'Other names',
  birthYear: 'Birth year',
  deathYear: 'Death year',
  birthDate: 'Full birth date',
  deathDate: 'Full death date',
  themes: 'Themes',
  summary: 'Summary',
  summaryCitations: 'Summary sources',
  biography: 'Story paragraphs',
  portrait: 'Portrait',
  creditIds: 'Credits',
  scope: 'Area',
  address: 'Address',
  coordinates: 'Map position',
  coordinateCitations: 'Position sources',
  precision: 'Precision',
  locationNote: 'Location note',
  label: 'Relationship',
  description: 'Description',
  citations: 'Sources',
  personId: 'Person',
  placeId: 'Place',
  title: 'Title',
  kind: 'Type',
  narrator: 'Narrator',
  interviewer: 'Interviewer',
  date: 'Recorded',
  eventDate: 'Events date',
  relatedPersonIds: 'Related people',
  placeIds: 'Related places',
  sourceId: 'Collection link',
  creator: 'Creator',
  publisher: 'Held by',
  url: 'Web address',
  rights: 'Rights',
  field: 'Concerns',
  note: 'Note',
  sourceIds: 'Sources',
};
function shown(field: string, value: unknown) {
  if (value === undefined || value === null || value === '') return '—';
  if ((field === 'birthDate' || field === 'deathDate') && typeof value === 'string')
    return formatLifeDate(undefined, value) ?? value;
  if (field === 'eventDate' && typeof value === 'object')
    return formatEventDate(value as EventDate);
  if (field === 'coordinates' && Array.isArray(value))
    return value.map((n) => Number(n).toFixed(5)).join(', ');
  // Lists of record identifiers mean nothing to staff; their count does.
  if (field.endsWith('Ids') && Array.isArray(value))
    return value.length ? `${value.length} chosen` : 'none';
  if (Array.isArray(value))
    return value.every((item) => typeof item === 'string')
      ? value.join(', ') || '—'
      : `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'changed';
  return String(value);
}

/** Loads the change history from an admin endpoint and reloads it on demand. */
export function useStaffHistory(path: string) {
  const [history, setHistory] = useState<StaffEdit[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setHistory((await communityRequest<{ edits: StaffEdit[] }>(path)).edits);
      setError('');
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The change history could not be loaded.',
      );
    }
  }, [path]);
  useEffect(() => {
    setHistory(null);
    void reload();
  }, [reload]);
  return { history, error, reload };
}

function describe(edit: StaffEdit, archive: ArchiveData) {
  const data = (edit.next ?? edit.previous ?? {}) as Record<string, unknown>;
  const action = edit.previous === null ? 'Added' : edit.next === null ? 'Removed' : 'Changed';
  if (edit.targetTable === 'persons') return `${action} person record`;
  if (edit.targetTable === 'places')
    return `${action} place: ${String(data.name ?? edit.targetId)}`;
  if (edit.targetTable === 'person_places') {
    const person = archive.people.find((item) => item.id === data.personId);
    const place = archive.places.find((item) => item.id === data.placeId);
    return `${action} connection: ${person ? displayPersonName(person.name) : 'a person'} — ${place?.name ?? 'a place'}`;
  }
  if (edit.targetTable === 'materials')
    return `${action} ${data.kind === 'oral-history' ? 'oral history' : 'record'}: ${String(data.title ?? '')}`;
  if (edit.targetTable === 'sources')
    return `${action} collection link: ${String(data.title ?? edit.targetId)}`;
  if (edit.targetTable === 'issues') return `${action} note on this record`;
  return `${action} ${edit.targetTable}`;
}

/**
 * Staff changes grouped by action, newest first, each with the reason and an Undo for the whole
 * action. `onUndone` receives the rows the undo wrote.
 */
export function ChangeHistory({
  history,
  error,
  archive,
  note,
  onUndone,
}: {
  history: StaffEdit[] | null;
  error: string;
  archive: ArchiveData;
  note: string;
  onUndone: (edits: StaffEdit[]) => void;
}) {
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState('');
  const batches: StaffEdit[][] = [];
  for (const edit of history ?? []) {
    const last = batches.at(-1);
    if (last && last[0]!.batchId === edit.batchId) last.push(edit);
    else batches.push([edit]);
  }

  async function undo(editId: string) {
    if (reason.trim().length < 3) {
      setUndoError('Say briefly why you are undoing this change.');
      return;
    }
    setBusy(true);
    setUndoError('');
    try {
      const result = await communityRequest<{ edits: StaffEdit[] }>(
        `/admin/edits/${encodeURIComponent(editId)}/undo`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      setUndoing(null);
      setReason('');
      onUndone(result.edits);
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
      <p className="admin-history-note">{note}</p>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {history === null && !error && <p className="admin-history-note">Loading…</p>}
      {history?.length === 0 && <p className="admin-history-note">No direct corrections yet.</p>}
      <ol>
        {batches.map((batch) => {
          const first = batch[0]!;
          const undone = batch.some((edit) => edit.undoneAt);
          const isUndo = batch.some((edit) => edit.undoOf);
          return (
            <li key={first.batchId} className={undone ? 'is-undone' : undefined}>
              <div className="admin-history-meta">
                <time dateTime={first.createdAt}>
                  {new Date(first.createdAt).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
                <span>{first.actorEmail ?? 'Staff'}</span>
                {isUndo && <span className="admin-history-tag">Undo</span>}
                {undone && <span className="admin-history-tag">Undone</span>}
              </div>
              <p className="admin-history-reason">{first.reason}</p>
              {batch.map((edit) => (
                <div className="admin-history-row" key={edit.id}>
                  <strong>{describe(edit, archive)}</strong>
                  {edit.previous !== null && edit.next !== null && (
                    <dl>
                      {edit.changedFields.map((field) => (
                        <div key={field}>
                          <dt>{fieldLabels[field] ?? field}</dt>
                          <dd>
                            <span>{shown(field, edit.previous?.[field])}</span>
                            <span aria-hidden="true"> → </span>
                            <span className="sr-only"> changed to </span>
                            <span>{shown(field, edit.next?.[field])}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
              {!undone && !isUndo && (
                <div className="admin-undo">
                  {undoing === first.batchId ? (
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
                          onClick={() => void undo(first.id)}
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
                        setUndoing(first.batchId);
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
          );
        })}
      </ol>
    </section>
  );
}
