'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle, MapPin, Plus, Search, Users } from 'lucide-react';
import type {
  ArchiveData,
  Person,
  PersonPlace,
  StaffEdit,
  StaffPersonEdit,
} from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';
import { ChangeHistory, fieldLabels, useStaffHistory } from './admin-history';

type Fields = {
  name: string;
  aliases: string;
  birthYear: string;
  deathYear: string;
  themes: string;
  summary: string;
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
const years = (person: Person) =>
  person.birthYear || person.deathYear
    ? `${person.birthYear ?? '?'} – ${person.deathYear ?? '?'}`
    : 'Years unknown';
const errorText = (failure: unknown, fallback: string) =>
  failure instanceof Error ? failure.message : fallback;

export function PeopleAdmin({
  archive,
  initialPersonId,
  onPersonChange,
  onOpenPlace,
  onSaved,
  onDirtyChange,
  confirmLeave,
}: {
  archive: ArchiveData;
  initialPersonId: string | null;
  onPersonChange: (personId: string | null) => void;
  onOpenPlace: (placeId: string) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  confirmLeave: () => boolean;
}) {
  const people = [...archive.people].sort((a, b) => a.name.localeCompare(b.name));
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
            archive={archive}
            onDirtyChange={onDirtyChange}
            onSaved={onSaved}
            onOpenPlace={(placeId) => {
              if (confirmLeave()) {
                onDirtyChange(false);
                onOpenPlace(placeId);
              }
            }}
          />
        ) : (
          <div className="review-empty admin-empty">
            <Users size={28} aria-hidden="true" />
            <h3>Choose a person</h3>
            <p>
              Correct names, other names, years, themes, the summary and place connections without a
              contribution.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PersonEditor({
  person,
  archive,
  onDirtyChange,
  onSaved,
  onOpenPlace,
}: {
  person: Person;
  archive: ArchiveData;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onOpenPlace: (placeId: string) => void;
}) {
  const [savedFields, setSavedFields] = useState(() => fieldsFor(person));
  const [fields, setFields] = useState(savedFields);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const history = useStaffHistory(`/admin/persons/${encodeURIComponent(person.id)}`);
  const patch = patchFor(fields, savedFields);
  const changed = Object.keys(patch);

  useEffect(() => {
    onDirtyChange(changed.length > 0 || !!reason.trim());
  }, [changed.length, reason, onDirtyChange]);

  function edit(key: keyof Fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setNotice('');
  }
  /** After any saved change: show the record as stored, and refresh the history. */
  function saved(edits: StaffEdit[], message: string) {
    const record = edits.find((item) => item.targetTable === 'persons')?.next as Person | undefined;
    if (record) {
      const nextFields = fieldsFor(record);
      setSavedFields(nextFields);
      setFields(nextFields);
      setReason('');
    }
    setNotice(message);
    onSaved(edits);
    void history.reload();
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
      const result = await communityRequest<{ edits: StaffEdit[] }>(
        `/admin/persons/${encodeURIComponent(person.id)}`,
        { method: 'POST', body: JSON.stringify({ patch, reason: reason.trim() }) },
      );
      saved(
        result.edits,
        result.edits.length
          ? 'Saved. The change is live and listed in the history below.'
          : 'Nothing changed.',
      );
    } catch (failure) {
      setError(errorText(failure, 'The change could not be saved.'));
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
        <PersonLinks
          person={person}
          archive={archive}
          onOpenPlace={onOpenPlace}
          onSaved={(edits, message) => saved(edits, message)}
        />
        <ChangeHistory
          history={history.history}
          error={history.error}
          archive={archive}
          note="Direct corrections to this person and their place connections. Changes that arrived with a published contribution are on the Contributions tab, and withdrawing one there keeps any later correction."
          onUndone={(edits) =>
            saved(edits, 'Undone. The record is back as it was, apart from later changes.')
          }
        />
      </div>
    </section>
  );
}

/** Sources this person's record already cites, for a new connection to cite. */
function personSources(person: Person, archive: ArchiveData) {
  const ids = new Set([
    ...person.summaryCitations.map((item) => item.sourceId),
    ...person.biography.flatMap((block) => block.citations.map((item) => item.sourceId)),
    ...archive.relations
      .filter((item) => item.personId === person.id)
      .flatMap((item) => item.citations.map((citation) => citation.sourceId)),
    ...archive.materials.filter((item) => item.personId === person.id).map((item) => item.sourceId),
  ]);
  return archive.sources.filter((source) => ids.has(source.id));
}

function PersonLinks({
  person,
  archive,
  onOpenPlace,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onOpenPlace: (placeId: string) => void;
  onSaved: (edits: StaffEdit[], message: string) => void;
}) {
  const links = archive.relations.filter((item) => item.personId === person.id);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="admin-section" aria-labelledby="admin-links-heading">
      <h3 id="admin-links-heading">
        <MapPin size={18} aria-hidden="true" /> Places connected to this person
      </h3>
      {!links.length && <p className="admin-history-note">No places are connected yet.</p>}
      <ul className="admin-links">
        {links.map((link) => {
          const place = archive.places.find((item) => item.id === link.placeId);
          return (
            <li key={link.id}>
              <div className="admin-link-summary">
                <div>
                  <strong>{place?.name ?? 'Unknown place'}</strong>
                  <span>{link.label}</span>
                </div>
                <div className="admin-link-actions">
                  <button
                    className="community-text-button"
                    onClick={() => setOpen(open === link.id ? null : link.id)}
                    aria-expanded={open === link.id}
                  >
                    {open === link.id ? 'Close' : 'Edit'}
                  </button>
                  {place && (
                    <button className="community-text-button" onClick={() => onOpenPlace(place.id)}>
                      Open place
                    </button>
                  )}
                </div>
              </div>
              {open === link.id && (
                <LinkEditor
                  link={link}
                  onSaved={(edits, message) => {
                    setOpen(null);
                    onSaved(edits, message);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {open === 'new' ? (
        <NewLink
          person={person}
          archive={archive}
          onCancel={() => setOpen(null)}
          onSaved={(edits) => {
            setOpen(null);
            onSaved(edits, 'Connected. The place now appears on this person’s page and map.');
          }}
        />
      ) : (
        <button className="community-secondary" onClick={() => setOpen('new')}>
          <Plus size={16} aria-hidden="true" /> Connect to a place on the map
        </button>
      )}
    </section>
  );
}

function LinkEditor({
  link,
  onSaved,
}: {
  link: PersonPlace;
  onSaved: (edits: StaffEdit[], message: string) => void;
}) {
  const [label, setLabel] = useState(link.label);
  const [description, setDescription] = useState(link.description);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = label.trim() !== link.label || description.trim() !== link.description;

  async function send(path: string, body: Record<string, unknown>, message: string) {
    if (reason.trim().length < 3) {
      setError('Say briefly why you are making this change.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await communityRequest<{ edits: StaffEdit[] }>(path, {
        method: 'POST',
        body: JSON.stringify({ ...body, reason: reason.trim() }),
      });
      onSaved(result.edits, message);
    } catch (failure) {
      setError(errorText(failure, 'The change could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  const base = `/admin/links/${encodeURIComponent(link.id)}`;
  return (
    <div className="admin-link-editor">
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <label className="community-field">
        <span>Relationship</span>
        <input value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="community-field">
        <span>Description</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="community-field">
        <span>Reason *</span>
        <input
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="admin-form-actions">
        <button
          className="community-primary"
          disabled={busy || !changed}
          onClick={() =>
            void send(
              base,
              { patch: { label: label.trim(), description: description.trim() } },
              'Saved the connection.',
            )
          }
        >
          {busy && <LoaderCircle size={16} className="community-spinner" />} Save connection
        </button>
        <button
          className="community-text-button admin-danger"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Remove this connection? The place stays on the map for anyone else connected to it. You can undo this from the change history.',
              )
            )
              void send(`${base}/remove`, {}, 'Removed the connection.');
          }}
        >
          Remove connection
        </button>
      </div>
    </div>
  );
}

function NewLink({
  person,
  archive,
  onCancel,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onCancel: () => void;
  onSaved: (edits: StaffEdit[]) => void;
}) {
  const linked = new Set(
    archive.relations.filter((item) => item.personId === person.id).map((item) => item.placeId),
  );
  const places = archive.places
    .filter((place) => !linked.has(place.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sources = personSources(person, archive);
  const [placeId, setPlaceId] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!placeId || !label.trim() || !sourceId) {
      setError('Choose a place, describe the relationship and choose a source.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Say briefly why you are making this change.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await communityRequest<{ edits: StaffEdit[] }>('/admin/links', {
        method: 'POST',
        body: JSON.stringify({
          personId: person.id,
          placeId,
          label: label.trim(),
          description: description.trim(),
          sourceId,
          reason: reason.trim(),
        }),
      });
      onSaved(result.edits);
    } catch (failure) {
      setError(errorText(failure, 'The connection could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-link-editor" onSubmit={save}>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <label className="community-field">
        <span>Place *</span>
        <select value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
          <option value="">Choose a place already on the map</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
        <small>New places still arrive through contributions.</small>
      </label>
      <label className="community-field">
        <span>Relationship *</span>
        <input
          value={label}
          maxLength={160}
          placeholder="For example: Buried here, Pastor 1931–1975"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="community-field">
        <span>Description</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="community-field">
        <span>Source *</span>
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          {!sources.length && <option value="">This person’s record cites no sources yet</option>}
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
        <small>Every connection on the public page cites a source this record already uses.</small>
      </label>
      <label className="community-field">
        <span>Reason *</span>
        <input
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="admin-form-actions">
        <button className="community-primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="community-spinner" />} Connect
        </button>
        <button type="button" className="community-text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
