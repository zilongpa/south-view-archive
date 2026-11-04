import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  applyLifeDates,
  contributionEntrySchema,
  issueSchema,
  materialSchema,
  personSchema,
  placeSchema,
  relationSchema,
  sourceSchema,
  staffIssueCreateSchema,
  staffIssueSchema,
  staffLinkCreateSchema,
  staffLinkEditSchema,
  staffMaterialCreateSchema,
  staffMaterialSchema,
  staffPersonEditSchema,
  staffPlaceEditSchema,
  staffReasonSchema,
  type Actor,
  type Material,
  type Person,
  type PersonPlace,
  type Place,
  type Source,
  type StaffEdit,
  type StaffIssue,
  type StaffIssueCreate,
  type StaffLinkCreate,
  type StaffLinkEdit,
  type StaffMaterial,
  type StaffMaterialCreate,
  type StaffPersonEdit,
  type StaffPlaceEdit,
  type StaffSourceLink,
} from '@southview/validators';
import type { Store } from './connection';
import { DomainError, requireReviewer, writableStore } from './community';
import { revertChange } from './revert';

type Table = StaffEdit['targetTable'];
type Data = Record<string, unknown>;
/** One row a staff action writes: `next` null removes the row. */
export type StaffChange = { table: Table; id: string; next: Data | null };
type EditRow = {
  id: string;
  batch_id: string;
  target_table: Table;
  target_id: string;
  reason: string;
  previous_data: Data | null;
  next_data: Data | null;
  undo_of: string | null;
  undone_at: Date | string | null;
  created_at: Date | string;
  actor_email: string | null;
};
const editSelect = `SELECT e.id, e.batch_id, e.target_table, e.target_id, e.reason, e.previous_data, e.next_data, e.undo_of, e.undone_at, e.created_at, u.email AS actor_email FROM community.staff_edits e LEFT JOIN community.auth_user u ON u.id = e.actor_id`;
const schemas = {
  persons: personSchema,
  places: placeSchema,
  person_places: relationSchema,
  materials: materialSchema,
  sources: sourceSchema,
  issues: issueSchema,
  contributions: contributionEntrySchema,
} as const;

function changedFields(previous: Data | null, next: Data | null) {
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]);
  return [...keys].filter((key) => !isDeepStrictEqual(previous?.[key], next?.[key])).sort();
}
function toEdit(row: EditRow): StaffEdit {
  return {
    id: row.id,
    batchId: row.batch_id,
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

async function readRow(tx: Store, table: Table, id: string): Promise<Data | null> {
  return (
    (
      await tx.query<{ data: Data }>(`SELECT data FROM archive.${table} WHERE id = $1 FOR UPDATE`, [
        id,
      ])
    ).rows[0]?.data ?? null
  );
}

function checkRecord(table: Table, data: Data) {
  const parsed = schemas[table].safeParse(data);
  if (!parsed.success)
    throw new DomainError(
      'BAD_REQUEST',
      parsed.error.issues[0]?.message ?? 'This change would leave the record incomplete.',
    );
  if (table === 'places') {
    const place = parsed.data as Place;
    if ((place.coordinates === null) !== (place.precision === 'unmapped'))
      throw new DomainError(
        'BAD_REQUEST',
        'Choose “Not yet mapped” only for a place without a map position, and a precision for one with a position.',
      );
    if (
      place.coordinates &&
      (place.coordinates[0] < -84.65 ||
        place.coordinates[0] > -84.1 ||
        place.coordinates[1] < 33.5 ||
        place.coordinates[1] > 33.95)
    )
      throw new DomainError('BAD_REQUEST', 'Place positions must be in metropolitan Atlanta.');
  }
}

async function writeRow(tx: Store, table: Table, id: string, data: Data | null) {
  if (data === null) {
    try {
      await tx.query(`DELETE FROM archive.${table} WHERE id = $1`, [id]);
    } catch {
      throw new DomainError(
        'CONFLICT',
        'Other records still depend on this one. Remove or move them first.',
      );
    }
    return;
  }
  const json = JSON.stringify(data);
  if (table === 'person_places')
    await tx.query(
      'INSERT INTO archive.person_places (id, person_id, place_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, place_id=EXCLUDED.place_id, data=EXCLUDED.data',
      [id, data.personId, data.placeId, json],
    );
  else if (table === 'materials')
    await tx.query(
      'INSERT INTO archive.materials (id, person_id, source_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, source_id=EXCLUDED.source_id, data=EXCLUDED.data',
      [id, data.personId, data.sourceId, json],
    );
  else if (table === 'contributions')
    await tx.query(
      'INSERT INTO archive.contributions (id, person_id, credit_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, credit_id=EXCLUDED.credit_id, data=EXCLUDED.data',
      [id, data.personId, data.creditId, json],
    );
  else if (table === 'issues')
    await tx.query(
      'INSERT INTO archive.issues (id, person_id, data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, data=EXCLUDED.data',
      [id, data.personId, json],
    );
  else
    await tx.query(
      `INSERT INTO archive.${table} (id, data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
      [id, json],
    );
}

/**
 * Writes one staff action, row by row in the given order, and records every row in one batch
 * with the reason. Rows whose content does not change are skipped. Returns null when nothing
 * changed. Parents must come before children when inserting, and after them when removing.
 */
export async function applyStaffChanges(
  tx: Store,
  actor: Actor,
  reason: string,
  changes: StaffChange[],
  undoOf: Map<string, string> = new Map(),
): Promise<string | null> {
  const batchId = randomUUID();
  let wrote = false;
  for (const change of changes) {
    const previous = await readRow(tx, change.table, change.id);
    if (change.next === null && previous === null) continue;
    if (change.next !== null) {
      if (change.next.id !== undefined && change.next.id !== change.id && change.table !== 'issues')
        throw new DomainError('BAD_REQUEST', 'A record cannot change its identifier.');
      checkRecord(change.table, change.next);
      if (previous && isDeepStrictEqual(previous, change.next)) continue;
    }
    await writeRow(tx, change.table, change.id, change.next);
    await tx.query(
      'INSERT INTO community.staff_edits (id, batch_id, actor_id, target_table, target_id, reason, previous_data, next_data, undo_of) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)',
      [
        randomUUID(),
        batchId,
        actor.userId,
        change.table,
        change.id,
        reason,
        previous === null ? null : JSON.stringify(previous),
        change.next === null ? null : JSON.stringify(change.next),
        undoOf.get(`${change.table}:${change.id}`) ?? null,
      ],
    );
    wrote = true;
  }
  return wrote ? batchId : null;
}

async function batchEdits(tx: Store, batchId: string | null) {
  if (!batchId) return [];
  return (
    await tx.query<EditRow>(`${editSelect} WHERE e.batch_id = $1 ORDER BY e.sequence`, [batchId])
  ).rows.map(toEdit);
}
async function staffAction<T>(
  actor: Actor,
  run: (tx: Store) => Promise<{ result: T; reason: string; changes: StaffChange[] }>,
): Promise<T & { edits: StaffEdit[] }> {
  requireReviewer(actor);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const { result, reason, changes } = await run(tx);
    const batchId = await applyStaffChanges(tx, actor, reason, changes);
    return { ...result, edits: await batchEdits(tx, batchId) };
  });
}
async function existing<T>(tx: Store, table: Table, id: string, missing: string): Promise<T> {
  const data = await readRow(tx, table, id);
  if (!data) throw new DomainError('NOT_FOUND', missing);
  return data as T;
}

/** Corrects a person's own fields: name, other names, years, themes, summary. */
export async function editPerson(personId: string, raw: StaffPersonEdit, actor: Actor) {
  const { patch, reason } = staffPersonEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Person>(
      tx,
      'persons',
      personId,
      'This person is not in the archive.',
    );
    const next: Data = { ...current };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.aliases !== undefined) next.aliases = patch.aliases;
    if (patch.themes !== undefined) next.themes = patch.themes;
    if (patch.summary !== undefined) next.summary = patch.summary;
    const conflict = applyLifeDates(next, patch);
    if (conflict) throw new DomainError('BAD_REQUEST', conflict);
    const person = personSchema.parse(next);
    return {
      result: { person },
      reason,
      changes: [{ table: 'persons', id: personId, next: person }],
    };
  });
}

/** Corrects a map place: name, area, address, position, precision, location note, description. */
export async function editPlace(placeId: string, raw: StaffPlaceEdit, actor: Actor) {
  const { patch, reason } = staffPlaceEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Place>(
      tx,
      'places',
      placeId,
      'This place is not in the archive.',
    );
    const next: Data = { ...current };
    for (const field of ['name', 'scope', 'precision', 'locationNote', 'summary'] as const)
      if (patch[field] !== undefined) next[field] = patch[field];
    if (patch.address !== undefined) {
      if (patch.address) next.address = patch.address;
      else delete next.address;
    }
    if (patch.coordinates !== undefined) {
      next.coordinates = patch.coordinates;
      // Citations for a position no longer on the map would describe nothing.
      if (patch.coordinates === null) next.coordinateCitations = [];
    }
    const place = placeSchema.parse(next);
    return { result: { place }, reason, changes: [{ table: 'places', id: placeId, next: place }] };
  });
}

/** Corrects how a person is connected to a place: the relationship label and its description. */
export async function editLink(linkId: string, raw: StaffLinkEdit, actor: Actor) {
  const { patch, reason } = staffLinkEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<PersonPlace>(
      tx,
      'person_places',
      linkId,
      'This connection is not in the archive.',
    );
    const link = relationSchema.parse({
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    });
    return {
      result: { link },
      reason,
      changes: [{ table: 'person_places', id: linkId, next: link }],
    };
  });
}

/** Connects a person to a place already on the map. */
export async function createLink(raw: StaffLinkCreate, actor: Actor) {
  const input = staffLinkCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    await existing(tx, 'places', input.placeId, 'This place is not in the archive.');
    await existing(tx, 'sources', input.sourceId, 'Choose a source that is in the archive.');
    const duplicate = await tx.query(
      'SELECT id FROM archive.person_places WHERE person_id = $1 AND place_id = $2 LIMIT 1',
      [input.personId, input.placeId],
    );
    if (duplicate.rows.length)
      throw new DomainError(
        'CONFLICT',
        'This person is already connected to this place. Edit that connection instead.',
      );
    const link = relationSchema.parse({
      id: `link-${randomUUID()}`,
      personId: input.personId,
      placeId: input.placeId,
      label: input.label,
      description: input.description,
      citations: [{ sourceId: input.sourceId }],
      creditIds: ['initial-compilation'],
    });
    return {
      result: { link },
      reason: input.reason,
      changes: [{ table: 'person_places', id: link.id, next: link }],
    };
  });
}

/** Removes a person's connection to a place. The place itself stays on the map. */
export async function removeLink(linkId: string, rawReason: string, actor: Actor) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'person_places', linkId, 'This connection is not in the archive.');
    return { result: {}, reason, changes: [{ table: 'person_places', id: linkId, next: null }] };
  });
}

async function checkRelated(
  tx: Store,
  personId: string,
  related: { relatedPersonIds: string[]; placeIds: string[] },
) {
  if (related.relatedPersonIds.includes(personId))
    throw new DomainError('BAD_REQUEST', 'A record cannot list its own person as related.');
  for (const id of related.relatedPersonIds)
    await existing(tx, 'persons', id, 'A related person is no longer in the archive.');
  for (const id of related.placeIds)
    await existing(tx, 'places', id, 'A related place is no longer in the archive.');
}

/** Copies a link's fields onto a source, leaving out the optional ones left blank. */
function withLink(source: Data, link: StaffSourceLink, fallbackTitle: string): Data {
  const next: Data = {
    ...source,
    title: link.title || fallbackTitle,
    creator: link.creator,
    publisher: link.publisher,
    url: link.url,
  };
  if (link.rights) next.rights = link.rights;
  else delete next.rights;
  return next;
}

/**
 * Resolves the source a record cites: an existing one (with any corrections to its link written
 * first) or a new one made from a pasted link. Returns its id and the rows to write before the
 * record itself.
 */
async function materialSource(
  tx: Store,
  input: StaffMaterial,
): Promise<{ sourceId: string; changes: StaffChange[] }> {
  const { source, material } = input;
  if (source.mode === 'new') {
    const created = sourceSchema.parse(
      withLink(
        {
          id: `source-${randomUUID()}`,
          accessedAt: new Date().toISOString().slice(0, 10),
          kind: material.kind,
          creditIds: ['initial-compilation'],
        },
        source.link,
        material.title,
      ),
    );
    return {
      sourceId: created.id,
      changes: [{ table: 'sources', id: created.id, next: created }],
    };
  }
  const current = await existing<Source>(
    tx,
    'sources',
    source.sourceId,
    'Choose a source that is in the archive.',
  );
  if (!source.link) return { sourceId: current.id, changes: [] };
  if (current.kind === 'community-contribution')
    throw new DomainError(
      'BAD_REQUEST',
      'A contribution’s own source cannot be relinked. Choose or paste a different link instead.',
    );
  const next = sourceSchema.parse(withLink(current, source.link, material.title));
  return { sourceId: current.id, changes: [{ table: 'sources', id: current.id, next }] };
}

function materialData(base: Data, input: StaffMaterial, sourceId: string): Material {
  const { material } = input;
  const next: Data = {
    ...base,
    title: material.title,
    kind: material.kind,
    description: material.description,
    eventDate: material.eventDate,
    relatedPersonIds: material.relatedPersonIds,
    placeIds: material.placeIds,
    sourceId,
  };
  for (const field of ['narrator', 'interviewer', 'date'] as const) {
    if (material[field]) next[field] = material[field];
    else delete next[field];
  }
  return materialSchema.parse(next);
}

/**
 * Adds a record or oral history to a person's page. It links to the collection holding it: an
 * archive source already in use, or a new link pasted by staff.
 */
export async function createMaterial(raw: StaffMaterialCreate, actor: Actor) {
  const input = staffMaterialCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    await checkRelated(tx, input.personId, input.material);
    const source = await materialSource(tx, input);
    const material = materialData(
      {
        id: `material-${randomUUID()}`,
        personId: input.personId,
        creditIds: ['initial-compilation'],
      },
      input,
      source.sourceId,
    );
    return {
      result: { material },
      reason: input.reason,
      changes: [...source.changes, { table: 'materials', id: material.id, next: material }],
    };
  });
}

/** Corrects a record or oral history, and optionally the link to the collection holding it. */
export async function editMaterial(materialId: string, raw: StaffMaterial, actor: Actor) {
  const input = staffMaterialSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Material>(
      tx,
      'materials',
      materialId,
      'This record is not in the archive.',
    );
    await checkRelated(tx, current.personId, input.material);
    const source = await materialSource(tx, input);
    const material = materialData(current, input, source.sourceId);
    return {
      result: { material },
      reason: input.reason,
      changes: [...source.changes, { table: 'materials', id: materialId, next: material }],
    };
  });
}

/** Takes a record or oral history off the person's page. The source it cited stays. */
export async function removeMaterial(materialId: string, rawReason: string, actor: Actor) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'materials', materialId, 'This record is not in the archive.');
    return { result: {}, reason, changes: [{ table: 'materials', id: materialId, next: null }] };
  });
}

async function issueData(tx: Store, personId: string, input: StaffIssue): Promise<Data> {
  for (const id of input.sourceIds)
    await existing(tx, 'sources', id, 'Choose sources that are in the archive.');
  return issueSchema.parse({
    personId,
    field: input.field,
    note: input.note,
    sourceIds: input.sourceIds,
  });
}

/** Adds a public note to a person's record, for example where sources disagree about a date. */
export async function createIssue(raw: StaffIssueCreate, actor: Actor) {
  const input = staffIssueCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    const id = `issue-${randomUUID()}`;
    const issue = await issueData(tx, input.personId, input);
    return {
      result: { issue: { ...issue, id } },
      reason: input.reason,
      changes: [{ table: 'issues', id, next: issue }],
    };
  });
}

/** Rewrites a note on a person's record and the sources it cites. */
export async function editIssue(issueId: string, raw: StaffIssue, actor: Actor) {
  const input = staffIssueSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<{ personId: string }>(
      tx,
      'issues',
      issueId,
      'This note is not in the archive.',
    );
    const issue = await issueData(tx, current.personId, input);
    return {
      result: { issue: { ...issue, id: issueId } },
      reason: input.reason,
      changes: [{ table: 'issues', id: issueId, next: issue }],
    };
  });
}

/** Takes a note off a person's record. */
export async function removeIssue(issueId: string, rawReason: string, actor: Actor) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'issues', issueId, 'This note is not in the archive.');
    return { result: {}, reason, changes: [{ table: 'issues', id: issueId, next: null }] };
  });
}

/**
 * Staff changes about one person (their record, place connections, records and notes) or one
 * place (the place and everyone's connections to it), newest first. A person's history also
 * includes corrections to the collection links their records cite.
 */
export async function listStaffEdits(
  target: { personId: string } | { placeId: string },
  actor: Actor,
): Promise<StaffEdit[]> {
  requireReviewer(actor);
  const store = await writableStore();
  const [own, field, id, children] =
    'personId' in target
      ? ([
          'persons',
          'personId',
          target.personId,
          ['person_places', 'materials', 'issues'],
        ] as const)
      : (['places', 'placeId', target.placeId, ['person_places']] as const);
  const rows = await store.query<EditRow>(
    `WITH matched AS (SELECT DISTINCT batch_id FROM community.staff_edits WHERE (target_table = $1 AND target_id = $3) OR (target_table = ANY($4::text[]) AND (previous_data->>$2 = $3 OR next_data->>$2 = $3)) OR (target_table = 'sources' AND $1 = 'persons' AND target_id IN (SELECT source_id FROM archive.materials WHERE person_id = $3))) ${editSelect} WHERE e.batch_id IN (SELECT batch_id FROM matched) ORDER BY e.sequence DESC LIMIT 200`,
    [own, field, id, `{${children.join(',')}}`],
  );
  return rows.rows.map(toEdit);
}

/**
 * Undoes the staff action an entry belongs to, all its rows together. Edited fields go back only
 * where they still hold what the action wrote; a removed row comes back; an added row goes away
 * unless it has been changed since.
 */
export async function undoStaffEdit(editId: string, rawReason: string, actor: Actor) {
  requireReviewer(actor);
  const reason = staffReasonSchema.parse(rawReason);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const entry = (await tx.query<EditRow>(`${editSelect} WHERE e.id = $1`, [editId])).rows[0];
    if (!entry) throw new DomainError('NOT_FOUND', 'This change is not in the history.');
    const rows = (
      await tx.query<EditRow>(
        `${editSelect} WHERE e.batch_id = $1 ORDER BY e.sequence DESC FOR UPDATE OF e`,
        [entry.batch_id],
      )
    ).rows;
    if (rows.some((row) => row.undone_at))
      throw new DomainError('CONFLICT', 'This change was already undone.');
    if (rows.some((row) => row.undo_of))
      throw new DomainError(
        'CONFLICT',
        'This entry is itself an undo. Make a new correction instead.',
      );
    const changes: StaffChange[] = [];
    const undoOf = new Map<string, string>();
    for (const row of rows) {
      const current = await readRow(tx, row.target_table, row.target_id);
      let next: Data | null;
      if (row.previous_data === null) {
        // The action added this row: take it away again, unless someone has edited it since.
        if (current && !isDeepStrictEqual(current, row.next_data))
          throw new DomainError(
            'CONFLICT',
            'A record this change added has been edited since. Remove it directly instead.',
          );
        next = null;
      } else if (row.next_data === null) {
        // The action removed this row: put it back, unless it has been recreated since.
        if (current)
          throw new DomainError('CONFLICT', 'A record this change removed exists again.');
        next = row.previous_data;
      } else {
        if (!current)
          throw new DomainError(
            'CONFLICT',
            'This record has been removed since; it cannot be undone.',
          );
        next = revertChange(row.previous_data, row.next_data, current) as Data;
        if (!schemas[row.target_table].safeParse(next).success)
          throw new DomainError(
            'CONFLICT',
            'Later changes to this record cannot be separated from this one. Correct the record directly instead.',
          );
      }
      changes.push({ table: row.target_table, id: row.target_id, next });
      undoOf.set(`${row.target_table}:${row.target_id}`, row.id);
    }
    const batchId = await applyStaffChanges(tx, actor, reason, changes, undoOf);
    await tx.query('UPDATE community.staff_edits SET undone_at = now() WHERE batch_id = $1', [
      entry.batch_id,
    ]);
    return { edits: await batchEdits(tx, batchId), undone: await batchEdits(tx, entry.batch_id) };
  });
}
