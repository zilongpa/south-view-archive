'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, LoaderCircle, Trash2 } from 'lucide-react';
import type { StaffEdit } from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';

type Kind = 'person' | 'place';
type Impact = {
  removes: { links: number; materials: number; issues: number };
  mentions: number;
  blockers: string[];
};
const area = (kind: Kind) => (kind === 'person' ? 'persons' : 'places');
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errorText = (failure: unknown, fallback: string) =>
  failure instanceof Error ? failure.message : fallback;

/**
 * Deletes a person or place after showing what goes with it. Anything that must be resolved
 * first is listed instead of the delete button.
 */
export function DeleteRecord({
  kind,
  id,
  name,
  onDeleted,
}: {
  kind: Kind;
  id: string;
  name: string;
  onDeleted: (edits: StaffEdit[]) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/admin/${area(kind)}/${encodeURIComponent(id)}`;

  async function check() {
    setBusy(true);
    setError('');
    try {
      setImpact(await communityRequest<Impact>(`${base}/deletion`));
    } catch (failure) {
      setError(errorText(failure, 'Could not check what deleting would remove.'));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (reason.trim().length < 3) {
      setError(`Say briefly why you are deleting this ${kind}.`);
      return;
    }
    if (
      !window.confirm(
        `Delete ${name} from the archive? Its public page goes away at once. You can restore it from “Recently deleted”.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const result = await communityRequest<{ edits: StaffEdit[] }>(`${base}/delete`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onDeleted(result.edits);
    } catch (failure) {
      setError(errorText(failure, `The ${kind} could not be deleted.`));
    } finally {
      setBusy(false);
    }
  }

  const removes = impact
    ? [
        impact.removes.links && count(impact.removes.links, 'place connection'),
        impact.removes.materials &&
          count(impact.removes.materials, 'record or oral history', 'records and oral histories'),
        impact.removes.issues && count(impact.removes.issues, 'note'),
      ].filter(Boolean)
    : [];

  return (
    <section className="admin-section admin-delete" aria-labelledby={`admin-delete-${kind}`}>
      <h3 id={`admin-delete-${kind}`}>
        <Trash2 size={18} aria-hidden="true" /> Delete this {kind}
      </h3>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {!impact ? (
        <>
          <p className="admin-history-note">
            For duplicates and records added by mistake. Deleting removes the public page and
            everything attached to it, and can be undone from “Recently deleted”.
          </p>
          <button
            type="button"
            className="community-text-button admin-danger"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy && <LoaderCircle size={16} className="community-spinner" />} Check what deleting
            would remove
          </button>
        </>
      ) : impact.blockers.length ? (
        <CommunityNotice kind="error" title="This cannot be deleted yet">
          <ul>
            {impact.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </CommunityNotice>
      ) : (
        <div className="admin-link-editor">
          <p>
            Deleting {name} also removes {removes.length ? removes.join(', ') : 'nothing else'}.
            {impact.mentions > 0 &&
              ` ${count(impact.mentions, 'other record or contribution mentions', 'other records and contributions mention')} it and will no longer list it.`}
          </p>
          <label className="community-field">
            <span>Reason *</span>
            <input
              value={reason}
              maxLength={1000}
              placeholder={
                kind === 'person'
                  ? 'For example: duplicate of another record'
                  : 'For example: added twice'
              }
              onChange={(event) => setReason(event.target.value)}
            />
            <small>Shown to other staff with the restore option. Not shown publicly.</small>
          </label>
          <div className="admin-form-actions">
            <button
              type="button"
              className="community-primary admin-danger-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy && <LoaderCircle size={16} className="community-spinner" />} Delete {kind}
            </button>
            <button
              type="button"
              className="community-text-button"
              onClick={() => {
                setImpact(null);
                setReason('');
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** People or places deleted by staff, each restorable with everything deleted with it. */
export function RecentlyDeleted({
  kind,
  version,
  onRestored,
}: {
  kind: Kind;
  version: number;
  onRestored: (edits: StaffEdit[], id: string) => void;
}) {
  const [items, setItems] = useState<StaffEdit[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setItems(
        (await communityRequest<{ edits: StaffEdit[] }>(`/admin/deleted/${area(kind)}`)).edits,
      );
    } catch (failure) {
      setError(errorText(failure, 'The deleted list could not be loaded.'));
    }
  }, [kind]);
  useEffect(() => {
    void load();
  }, [load, version]);

  async function restore(edit: StaffEdit) {
    if (reason.trim().length < 3) {
      setError('Say briefly why you are restoring it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await communityRequest<{ edits: StaffEdit[] }>(
        `/admin/edits/${encodeURIComponent(edit.id)}/undo`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      setOpen(null);
      setReason('');
      onRestored(result.edits, edit.targetId);
      void load();
    } catch (failure) {
      setError(errorText(failure, 'It could not be restored.'));
    } finally {
      setBusy(false);
    }
  }

  if (!items?.length && !error) return null;
  return (
    <section className="admin-recently-deleted" aria-labelledby={`deleted-${kind}`}>
      <h4 id={`deleted-${kind}`}>Recently deleted</h4>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <ul className="admin-links">
        {items?.map((edit) => {
          const data = (edit.previous ?? {}) as { name?: string };
          const label =
            kind === 'person'
              ? displayPersonName(data.name ?? edit.targetId)
              : (data.name ?? edit.targetId);
          return (
            <li key={edit.id}>
              <div className="admin-link-summary">
                <div>
                  <strong>{label}</strong>
                  <span>
                    {new Date(edit.createdAt).toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' · '}
                    {edit.reason}
                  </span>
                </div>
                <div className="admin-link-actions">
                  <button
                    type="button"
                    className="community-text-button"
                    aria-expanded={open === edit.id}
                    onClick={() => {
                      setOpen(open === edit.id ? null : edit.id);
                      setReason('');
                      setError('');
                    }}
                  >
                    <ArchiveRestore size={16} aria-hidden="true" /> Restore
                  </button>
                </div>
              </div>
              {open === edit.id && (
                <div className="admin-link-editor">
                  <label className="community-field">
                    <span>Why restore it? *</span>
                    <input
                      value={reason}
                      maxLength={1000}
                      autoFocus
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <div className="admin-form-actions">
                    <button
                      type="button"
                      className="community-secondary"
                      disabled={busy}
                      onClick={() => void restore(edit)}
                    >
                      {busy && <LoaderCircle size={16} className="community-spinner" />} Restore
                      with everything deleted with it
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
