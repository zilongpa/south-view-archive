import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  personSchema,
  staffPersonEditSchema,
  staffReasonSchema,
  type Actor,
  type Person,
  type StaffEdit,
  type StaffPersonEdit,
} from '@southview/validators';
import type { Store } from './connection';
import { DomainError, requireReviewer, validCuratedRecord, writableStore } from './community';
import { revertChange } from './revert';

type EditTable = StaffEdit['targetTable'];
type EditRow = {
  id: string;
  target_table: EditTable;
  target_id: string;
  reason: string;
  previous_data: Record<string, unknown> | null;
  next_data: Record<string, unknown> | null;
  undo_of: string | null;
  undone_at: Date | string | null;
  created_at: Date | string;
  actor_email: string | null;
};
const editSelect = `SELECT e.id, e.target_table, e.target_id, e.reason, e.previous_data, e.next_data, e.undo_of, e.undone_at, e.created_at, u.email AS actor_email FROM community.staff_edits e LEFT JOIN community.auth_user u ON u.id = e.actor_id`;

function changedFields(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
) {
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]);
  return [...keys].filter((key) => !isDeepStrictEqual(previous?.[key], next?.[key])).sort();
}

function toEdit(row: EditRow): StaffEdit {
  return {
    id: row.id,
    targetTable: row.target_table,
    targetId: row.target_id,
    reason: row.reason,
    actorEmail: row.actor_email,
    createdAt: new Date(row.created_at).toISOString(),
    changedFields: changedFields(row.previous_data, row.next_data),
    previous: row.previous_data,
    next: row.next_data,
    undoOf: row.undo_of,
    undoneAt: row.undone_at ? new Date(row.undone_at).toISOString() : null,
  };
}

async function recordEdit(
  tx: Store,
  actor: Actor,
  table: EditTable,
  targetId: string,
  reason: string,
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
  undoOf: string | null = null,
) {
  const id = randomUUID();
  await tx.query(
    'INSERT INTO community.staff_edits (id, actor_id, target_table, target_id, reason, previous_data, next_data, undo_of) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)',
    [
      id,
      actor.userId,
      table,
      targetId,
      reason,
      previous === null ? null : JSON.stringify(previous),
      next === null ? null : JSON.stringify(next),
      undoOf,
    ],
  );
  return id;
}

async function editById(tx: Store, id: string) {
  const row = (await tx.query<EditRow>(`${editSelect} WHERE e.id = $1`, [id])).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'This change is not in the history.');
  return toEdit(row);
}

/**
 * Corrects a person's own fields (name, other names, years, themes, summary) directly, without a
 * contribution. The change is recorded with the staff member's reason and can be undone.
 */
export async function editPerson(
  personId: string,
  raw: StaffPersonEdit,
  actor: Actor,
): Promise<{ person: Person; edit: StaffEdit | null }> {
  requireReviewer(actor);
  const { patch, reason } = staffPersonEditSchema.parse(raw);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const current = (
      await tx.query<{ data: Person }>(
        'SELECT data FROM archive.persons WHERE id = $1 FOR NO KEY UPDATE',
        [personId],
      )
    ).rows[0]?.data;
    if (!current) throw new DomainError('NOT_FOUND', 'This person is not in the archive.');
    const next: Record<string, unknown> = { ...current };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.aliases !== undefined) next.aliases = patch.aliases;
    if (patch.themes !== undefined) next.themes = patch.themes;
    if (patch.summary !== undefined) next.summary = patch.summary;
    for (const field of ['birthYear', 'deathYear'] as const) {
      if (patch[field] === undefined) continue;
      if (patch[field] === null) delete next[field];
      else next[field] = patch[field];
    }
    if (
      typeof next.birthYear === 'number' &&
      typeof next.deathYear === 'number' &&
      next.birthYear > next.deathYear
    )
      throw new DomainError('BAD_REQUEST', 'The birth year must not be after the death year.');
    const person = personSchema.parse(next);
    if (isDeepStrictEqual(person, personSchema.parse(current))) return { person, edit: null };
    await tx.query('UPDATE archive.persons SET data = $2::jsonb WHERE id = $1', [
      personId,
      JSON.stringify(person),
    ]);
    const id = await recordEdit(
      tx,
      actor,
      'persons',
      personId,
      reason,
      current as unknown as Record<string, unknown>,
      person as unknown as Record<string, unknown>,
    );
    return { person, edit: await editById(tx, id) };
  });
}

/** Staff changes to one record, newest first. */
export async function listStaffEdits(
  target: { table: EditTable; id: string },
  actor: Actor,
): Promise<StaffEdit[]> {
  requireReviewer(actor);
  const store = await writableStore();
  const rows = await store.query<EditRow>(
    `${editSelect} WHERE e.target_table = $1 AND e.target_id = $2 ORDER BY e.sequence DESC LIMIT 100`,
    [target.table, target.id],
  );
  return rows.rows.map(toEdit);
}

/**
 * Undoes one staff change. Only the fields that still hold what that change wrote go back;
 * anything changed since, by staff or by a published contribution, is kept.
 */
export async function undoStaffEdit(
  editId: string,
  rawReason: string,
  actor: Actor,
): Promise<{ edit: StaffEdit; undone: StaffEdit }> {
  requireReviewer(actor);
  const reason = staffReasonSchema.parse(rawReason);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const original = (
      await tx.query<EditRow>(`${editSelect} WHERE e.id = $1 FOR UPDATE OF e`, [editId])
    ).rows[0];
    if (!original) throw new DomainError('NOT_FOUND', 'This change is not in the history.');
    if (original.undone_at) throw new DomainError('CONFLICT', 'This change was already undone.');
    if (original.undo_of)
      throw new DomainError(
        'CONFLICT',
        'This entry is itself an undo. Make a new correction instead.',
      );
    const table = original.target_table;
    if (table === 'materials')
      throw new DomainError('BAD_REQUEST', 'Undoing this kind of change is not supported yet.');
    const current =
      (
        await tx.query<{ data: Record<string, unknown> }>(
          `SELECT data FROM archive.${table} WHERE id = $1 FOR NO KEY UPDATE`,
          [original.target_id],
        )
      ).rows[0]?.data ?? null;
    if (!current || !original.previous_data || !original.next_data)
      throw new DomainError('CONFLICT', 'This record has been removed since; it cannot be undone.');
    const restored = revertChange(original.previous_data, original.next_data, current) as Record<
      string,
      unknown
    >;
    if (!validCuratedRecord(table, restored))
      throw new DomainError(
        'CONFLICT',
        'Later changes to this record cannot be separated from this one. Correct the record directly instead.',
      );
    if (!isDeepStrictEqual(restored, current))
      await tx.query(`UPDATE archive.${table} SET data = $2::jsonb WHERE id = $1`, [
        original.target_id,
        JSON.stringify(restored),
      ]);
    const id = await recordEdit(
      tx,
      actor,
      table,
      original.target_id,
      reason,
      current,
      restored,
      original.id,
    );
    await tx.query('UPDATE community.staff_edits SET undone_at = now() WHERE id = $1', [
      original.id,
    ]);
    return { edit: await editById(tx, id), undone: await editById(tx, original.id) };
  });
}
