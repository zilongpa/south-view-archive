import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import { getArchive } from '../packages/db/src/index';
import { createDraft, finalizeSubmission, reviewSubmission } from '../packages/db/src/community';
import { editPerson, listStaffEdits, undoStaffEdit } from '../packages/db/src/staff-edits';
import { revertChange } from '../packages/db/src/revert';
import {
  reviewInputSchema,
  submissionInputSchema,
  type Actor,
} from '../packages/validators/src/index';

const guest: Actor = { userId: null, email: null, reviewer: false };
const reviewer: Actor = { userId: 'staff-reviewer', email: 'reviewer@example.org', reviewer: true };

test('revertChange undoes only what the write still holds', () => {
  // Untouched since: back to the previous value exactly.
  assert.deepEqual(revertChange({ a: 1 }, { a: 2 }, { a: 2 }), { a: 1 });
  // A later edit to the same field wins; other fields still revert.
  assert.deepEqual(revertChange({ a: 1, b: 1 }, { a: 2, b: 2 }, { a: 3, b: 2 }), { a: 3, b: 1 });
  // A key the write added goes away; one it removed comes back.
  assert.deepEqual(revertChange({ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }), { a: 1, c: 3 });
  assert.deepEqual(revertChange({ a: 1, b: 2 }, { a: 1 }, { a: 1, c: 3 }), { a: 1, b: 2, c: 3 });
  // Lists: an added item leaves, a later item stays.
  assert.deepEqual(revertChange(['x'], ['x', 'y'], ['x', 'y', 'z']), ['x', 'z']);
  // A paragraph replaced by a correction comes back in its place.
  const p0 = { text: 'first', citations: [] };
  const p1 = { text: 'second', citations: [] };
  const fixed = { id: 'c1', text: 'second, corrected', citations: [] };
  const later = { id: 'c2', text: 'added later', citations: [] };
  assert.deepEqual(revertChange([p0, p1], [p0, fixed], [p0, fixed, later]), [p0, p1, later]);
  // If the correction was edited again later, the later text stays and the original stays gone.
  const refixed = { ...fixed, text: 'second, corrected twice' };
  assert.deepEqual(revertChange([p0, p1], [p0, fixed], [p0, refixed]), [p0, refixed]);
  // Items matched by id revert inside, keeping later changes to other fields.
  assert.deepEqual(
    revertChange([{ id: 'a', t: 1, n: 1 }], [{ id: 'a', t: 2, n: 1 }], [{ id: 'a', t: 2, n: 5 }]),
    [{ id: 'a', t: 1, n: 5 }],
  );
});

function submission(personId: string) {
  return submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'addition',
    personId,
    proposedPersonName: '',
    title: 'A community contribution',
    body: 'This is a community account supplied for human review and archival publication.',
    links: [],
    privateName: 'Private Name',
    email: 'private@example.org',
    anonymous: true,
    displayName: '',
    permission: true,
  });
}
async function publish(personId: string, review: Record<string, unknown>) {
  const receipt = randomUUID() + randomUUID();
  const { submission: draft } = await createDraft(submission(personId), guest, receipt);
  await finalizeSubmission(draft.id, { ...guest, receiptToken: receipt });
  await reviewSubmission(
    draft.id,
    reviewInputSchema.parse({ action: 'publish', ...review }),
    reviewer,
  );
  return draft.id;
}
const withdraw = (id: string) =>
  reviewSubmission(id, reviewInputSchema.parse({ action: 'withdraw' }), reviewer);
const lewis = async () => (await getArchive()).people.find((p) => p.id === 'john-lewis')!;

test('staff edits and contributions undo independently', async (t) => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  delete process.env.ARCHIVE_DATA_MODE;
  const store = await createStore({ mode: 'local', path: 'memory://' });
  setStoreForTests(store);
  try {
    await t.test(
      'a reviewer corrects a year directly, sees it in the history, and undoes it',
      async () => {
        const before = await lewis();
        await assert.rejects(
          editPerson('john-lewis', { patch: { birthYear: 1941 }, reason: 'Typo' }, guest),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(
          editPerson('john-lewis', { patch: { birthYear: 1941 }, reason: '' }, reviewer),
        );
        const { person, edit } = await editPerson(
          'john-lewis',
          {
            patch: { birthYear: 1941, aliases: [...before.aliases, 'Bob'] },
            reason: 'Checked the House biography',
          },
          reviewer,
        );
        assert.equal(person.birthYear, 1941);
        assert.deepEqual(edit?.changedFields, ['aliases', 'birthYear']);
        assert.equal((await lewis()).birthYear, 1941);
        const unchanged = await editPerson(
          'john-lewis',
          { patch: { birthYear: 1941 }, reason: 'Again' },
          reviewer,
        );
        assert.equal(unchanged.edit, null);
        const history = await listStaffEdits({ table: 'persons', id: 'john-lewis' }, reviewer);
        assert.equal(history.length, 1);
        assert.equal(history[0]!.reason, 'Checked the House biography');
        const { undone } = await undoStaffEdit(edit!.id, 'Wrong record', reviewer);
        assert.ok(undone.undoneAt);
        assert.deepEqual(await lewis(), before);
        await assert.rejects(undoStaffEdit(edit!.id, 'Twice', reviewer), { code: 'CONFLICT' });
        assert.equal(
          (await listStaffEdits({ table: 'persons', id: 'john-lewis' }, reviewer)).length,
          2,
        );
      },
    );

    await t.test('removing a year and refusing an impossible pair', async () => {
      await assert.rejects(
        editPerson('john-lewis', { patch: { birthYear: 2030 }, reason: 'Bad data' }, reviewer),
        { code: 'BAD_REQUEST' },
      );
      const { person, edit } = await editPerson(
        'john-lewis',
        { patch: { birthYear: null }, reason: 'Unknown' },
        reviewer,
      );
      assert.equal(person.birthYear, undefined);
      await undoStaffEdit(edit!.id, 'Restore', reviewer);
      assert.equal((await lewis()).birthYear, 1940);
    });

    await t.test(
      'an earlier contribution can be withdrawn after a later one changed the same person',
      async () => {
        const before = await lewis();
        const first = await publish('john-lewis', { applyTo: 'biography' });
        const second = await publish('john-lewis', {
          applyTo: 'biography',
          personPatch: { deathYear: 2021 },
        });
        assert.equal((await lewis()).biography.length, before.biography.length + 2);
        await withdraw(first);
        const middle = await lewis();
        assert.equal(middle.biography.length, before.biography.length + 1);
        assert.equal(middle.biography.at(-1)!.id, `contribution-${second}`);
        assert.equal(middle.deathYear, 2021);
        await withdraw(second);
        assert.deepEqual(await lewis(), before);
      },
    );

    await t.test('withdrawing a contribution keeps a later staff correction', async () => {
      const before = await lewis();
      const id = await publish('john-lewis', { personPatch: { birthYear: 1939, deathYear: 2019 } });
      await editPerson(
        'john-lewis',
        { patch: { birthYear: 1940 }, reason: 'Contribution was wrong about the birth year' },
        reviewer,
      );
      await withdraw(id);
      const after = await lewis();
      assert.equal(after.birthYear, 1940);
      assert.equal(after.deathYear, before.deathYear);
      assert.deepEqual(after.creditIds, before.creditIds);
    });
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});
