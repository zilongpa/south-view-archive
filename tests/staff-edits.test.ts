import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import { getArchive } from '../packages/db/src/index';
import { createDraft, finalizeSubmission, reviewSubmission } from '../packages/db/src/community';
import {
  createIssue,
  createLink,
  createMaterial,
  editBiography,
  editIssue,
  editLink,
  editMaterial,
  editPerson,
  editPlace,
  listStaffEdits,
  removeIssue,
  removeLink,
  removeMaterial,
  undoStaffEdit,
} from '../packages/db/src/staff-edits';
import { revertChange } from '../packages/db/src/revert';
import {
  applyLifeDates,
  formatLifeDate,
  lifeDateSchema,
  reviewInputSchema,
  submissionInputSchema,
  type Actor,
} from '../packages/validators/src/index';

const guest: Actor = { userId: null, email: null, reviewer: false };
const reviewer: Actor = { userId: 'staff-reviewer', email: 'reviewer@example.org', reviewer: true };

test('life dates read naturally and keep their year', () => {
  assert.equal(formatLifeDate(1897, '1897-12-19'), 'December 19, 1897');
  assert.equal(formatLifeDate(1897, '1897-12'), 'December 1897');
  assert.equal(formatLifeDate(1897), '1897');
  assert.equal(formatLifeDate(undefined), undefined);
  assert.ok(lifeDateSchema.safeParse('2000-02-29').success);
  assert.ok(!lifeDateSchema.safeParse('1900-02-29').success);
  assert.ok(!lifeDateSchema.safeParse('1897-13').success);
  // A date alone supplies its year; a new year alone drops a date it no longer matches.
  const record: Record<string, unknown> = {};
  assert.equal(applyLifeDates(record, { birthDate: '1897-12-19' }), null);
  assert.equal(record.birthYear, 1897);
  assert.equal(applyLifeDates(record, { birthYear: 1899 }), null);
  assert.equal(record.birthDate, undefined);
  // Within one year, the birth date must come first.
  assert.match(
    applyLifeDates(
      { birthYear: 1900, deathYear: 1900 },
      { birthDate: '1900-05-02', deathDate: '1900-05-01' },
    )!,
    /must not be after/,
  );
});

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
        const {
          person,
          edits: [edit],
        } = await editPerson(
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
        assert.deepEqual(unchanged.edits, []);
        const history = await listStaffEdits({ personId: 'john-lewis' }, reviewer);
        assert.equal(history.length, 1);
        assert.equal(history[0]!.reason, 'Checked the House biography');
        const { undone } = await undoStaffEdit(edit!.id, 'Wrong record', reviewer);
        assert.ok(undone[0]!.undoneAt);
        assert.deepEqual(await lewis(), before);
        await assert.rejects(undoStaffEdit(edit!.id, 'Twice', reviewer), { code: 'CONFLICT' });
        assert.equal((await listStaffEdits({ personId: 'john-lewis' }, reviewer)).length, 2);
      },
    );

    await t.test('removing a year and refusing an impossible pair', async () => {
      await assert.rejects(
        editPerson('john-lewis', { patch: { birthYear: 2030 }, reason: 'Bad data' }, reviewer),
        { code: 'BAD_REQUEST' },
      );
      const {
        person,
        edits: [edit],
      } = await editPerson(
        'john-lewis',
        { patch: { birthYear: null }, reason: 'Unknown' },
        reviewer,
      );
      assert.equal(person.birthYear, undefined);
      await undoStaffEdit(edit!.id, 'Restore', reviewer);
      assert.equal((await lewis()).birthYear, 1940);
    });

    await t.test('a reviewer moves a place, rewords a connection, and undoes both', async () => {
      const archive = await getArchive();
      const link = archive.relations.find((item) => item.personId === 'john-lewis')!;
      const place = archive.places.find((item) => item.id === link.placeId)!;
      await assert.rejects(
        editPlace(place.id, { patch: { coordinates: [-80, 33.7] }, reason: 'Moved' }, reviewer),
        { code: 'BAD_REQUEST' },
      );
      await assert.rejects(
        editPlace(place.id, { patch: { precision: 'unmapped' }, reason: 'Unknown' }, reviewer),
        { code: 'BAD_REQUEST' },
      );
      const moved = await editPlace(
        place.id,
        { patch: { coordinates: [-84.37, 33.71], precision: 'verified' }, reason: 'Surveyed' },
        reviewer,
      );
      assert.deepEqual(moved.place.coordinates, [-84.37, 33.71]);
      const reworded = await editLink(
        link.id,
        { patch: { label: 'Buried here' }, reason: 'Clearer wording' },
        reviewer,
      );
      assert.equal(reworded.link.label, 'Buried here');
      const placeHistory = await listStaffEdits({ placeId: place.id }, reviewer);
      assert.equal(placeHistory.length, 2);
      assert.equal(
        (await listStaffEdits({ personId: 'john-lewis' }, reviewer)).filter(
          (e) => e.targetTable === 'person_places',
        ).length,
        1,
      );
      await undoStaffEdit(moved.edits[0]!.id, 'Back', reviewer);
      await undoStaffEdit(reworded.edits[0]!.id, 'Back', reviewer);
      const after = await getArchive();
      assert.deepEqual(
        after.places.find((item) => item.id === place.id),
        place,
      );
      assert.deepEqual(
        after.relations.find((item) => item.id === link.id),
        link,
      );
    });

    await t.test(
      'a reviewer links a person to an existing place, then removes and restores the link',
      async () => {
        const archive = await getArchive();
        const king = archive.people.find((item) => item.id === 'martin-luther-king-sr')!;
        const lewisPlaces = new Set(
          archive.relations.filter((r) => r.personId === 'john-lewis').map((r) => r.placeId),
        );
        const place = archive.places.find((item) => !lewisPlaces.has(item.id))!;
        const sourceId = king.summaryCitations[0]!.sourceId;
        await assert.rejects(
          createLink(
            {
              personId: 'john-lewis',
              placeId: place.id,
              label: 'Spoke here',
              description: '',
              sourceId: 'no-such-source',
              reason: 'Linking',
            },
            reviewer,
          ),
          { code: 'NOT_FOUND' },
        );
        const created = await createLink(
          {
            personId: 'john-lewis',
            placeId: place.id,
            label: 'Spoke here',
            description: 'A visit.',
            sourceId,
            reason: 'Linking',
          },
          reviewer,
        );
        await assert.rejects(
          createLink(
            {
              personId: 'john-lewis',
              placeId: place.id,
              label: 'Again',
              description: '',
              sourceId,
              reason: 'Linking',
            },
            reviewer,
          ),
          { code: 'CONFLICT' },
        );
        assert.ok((await getArchive()).relations.some((r) => r.id === created.link.id));
        const removed = await removeLink(created.link.id, 'Not supported by the source', reviewer);
        assert.ok(!(await getArchive()).relations.some((r) => r.id === created.link.id));
        await undoStaffEdit(removed.edits[0]!.id, 'It was supported after all', reviewer);
        assert.deepEqual(
          (await getArchive()).relations.find((r) => r.id === created.link.id),
          created.link,
        );
        // Undoing the creation removes the link again.
        await undoStaffEdit(created.edits[0]!.id, 'Wrong person', reviewer);
        assert.ok(!(await getArchive()).relations.some((r) => r.id === created.link.id));
      },
    );
    await t.test(
      'a reviewer adds an oral history by link, corrects it, removes it and restores it',
      async () => {
        const before = await getArchive();
        const king = before.people.find((item) => item.id === 'martin-luther-king-sr')!;
        const material = {
          kind: 'oral-history' as const,
          title: 'Interview about Ebenezer',
          description: 'A recorded interview held by the library.',
          narrator: 'A. Narrator',
          interviewer: '',
          date: '1980',
          eventDate: { kind: 'range' as const, startYear: 1931, endYear: 1975 },
          relatedPersonIds: [king.id],
          placeIds: [],
        };
        const link = {
          title: '',
          creator: '',
          publisher: 'Example Library',
          url: 'https://library.example.org/items/1',
          rights: '',
        };
        await assert.rejects(
          createMaterial(
            {
              personId: 'john-lewis',
              material,
              source: { mode: 'new', link: { ...link, url: 'not a link' } },
              reason: 'Adding',
            },
            reviewer,
          ),
        );
        await assert.rejects(
          createMaterial(
            {
              personId: 'john-lewis',
              material: { ...material, relatedPersonIds: ['john-lewis'] },
              source: { mode: 'new', link },
              reason: 'Adding',
            },
            reviewer,
          ),
          { code: 'BAD_REQUEST' },
        );
        const created = await createMaterial(
          { personId: 'john-lewis', material, source: { mode: 'new', link }, reason: 'Adding' },
          reviewer,
        );
        // The new link is a source of its own, written in the same action as the record.
        assert.deepEqual(
          created.edits.map((edit) => edit.targetTable),
          ['sources', 'materials'],
        );
        let archive = await getArchive();
        const source = archive.sources.find((item) => item.id === created.material.sourceId)!;
        assert.equal(source.title, material.title);
        assert.equal(source.kind, 'oral-history');
        assert.ok(archive.materials.some((item) => item.id === created.material.id));

        const fixed = await editMaterial(
          created.material.id,
          {
            material: { ...material, narrator: '', title: 'Interview about Ebenezer Baptist' },
            source: {
              mode: 'existing',
              sourceId: source.id,
              link: { ...link, url: 'https://library.example.org/items/2' },
            },
            reason: 'Wrong link',
          },
          reviewer,
        );
        archive = await getArchive();
        assert.equal(fixed.material.narrator, undefined);
        assert.equal(
          archive.sources.find((item) => item.id === source.id)!.url,
          'https://library.example.org/items/2',
        );
        const history = await listStaffEdits({ personId: 'john-lewis' }, reviewer);
        assert.ok(history.some((edit) => edit.targetTable === 'sources'));

        const removed = await removeMaterial(created.material.id, 'Duplicate', reviewer);
        assert.ok(!(await getArchive()).materials.some((m) => m.id === created.material.id));
        await undoStaffEdit(removed.edits[0]!.id, 'Not a duplicate', reviewer);
        assert.deepEqual(
          (await getArchive()).materials.find((m) => m.id === created.material.id),
          fixed.material,
        );
        // Undoing the correction puts back both the record's fields and the old link.
        await undoStaffEdit(fixed.edits[0]!.id, 'Back', reviewer);
        archive = await getArchive();
        assert.equal(
          archive.materials.find((m) => m.id === created.material.id)!.narrator,
          'A. Narrator',
        );
        assert.equal(archive.sources.find((item) => item.id === source.id)!.url, link.url);
        // Undoing the addition removes the record and its new link.
        await undoStaffEdit(created.edits[0]!.id, 'Wrong person', reviewer);
        archive = await getArchive();
        assert.ok(!archive.materials.some((m) => m.id === created.material.id));
        assert.ok(!archive.sources.some((item) => item.id === source.id));
      },
    );
    await t.test('a reviewer adds, rewrites, removes and restores a note on a record', async () => {
      const sourceId = (await lewis()).summaryCitations[0]!.sourceId;
      const count = (await getArchive()).issues.length;
      await assert.rejects(
        createIssue(
          {
            personId: 'john-lewis',
            field: 'birthYear',
            note: 'Sources disagree on the year.',
            sourceIds: ['no-such-source'],
            reason: 'Adding',
          },
          reviewer,
        ),
        { code: 'NOT_FOUND' },
      );
      const created = await createIssue(
        {
          personId: 'john-lewis',
          field: 'birthYear',
          note: 'Sources disagree on the year.',
          sourceIds: [sourceId],
          reason: 'Adding',
        },
        reviewer,
      );
      let issues = (await getArchive()).issues;
      assert.equal(issues.length, count + 1);
      assert.equal(issues.find((item) => item.id === created.issue.id)!.note, created.issue.note);
      await editIssue(
        created.issue.id,
        {
          field: 'deathYear',
          note: 'Sources disagree on the death year.',
          sourceIds: [],
          reason: 'Wrong field',
        },
        reviewer,
      );
      issues = (await getArchive()).issues;
      assert.equal(issues.find((item) => item.id === created.issue.id)!.field, 'deathYear');
      const removed = await removeIssue(created.issue.id, 'Settled', reviewer);
      assert.equal((await getArchive()).issues.length, count);
      await undoStaffEdit(removed.edits[0]!.id, 'Not settled', reviewer);
      assert.equal((await getArchive()).issues.length, count + 1);
      // Every existing note can be addressed by its row identifier.
      assert.ok((await getArchive()).issues.every((item) => item.id));
      // The note was rewritten after it was added, so undoing the addition is refused.
      await assert.rejects(undoStaffEdit(created.edits[0]!.id, 'Clean up', reviewer), {
        code: 'CONFLICT',
      });
      await removeIssue(created.issue.id, 'Clean up', reviewer);
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
    await t.test('a reviewer rewrites, reorders, removes and adds story paragraphs', async () => {
      const before = await lewis();
      assert.ok(before.biography.length >= 2, 'fixture needs two paragraphs');
      const sourceId = before.summaryCitations[0]!.sourceId;
      const keep = (from: number) => ({
        from,
        text: before.biography[from]!.text,
        citations: before.biography[from]!.citations,
      });
      const story = (paragraphs: unknown[], base = before.biography) =>
        editBiography(
          'john-lewis',
          { base, paragraphs, reason: 'Story corrected' } as never,
          reviewer,
        );
      await assert.rejects(story([{ text: 'Uncited.', citations: [] }]));
      await assert.rejects(story([{ text: 'Cited.', citations: [{ sourceId: 'nope' }] }]), {
        code: 'NOT_FOUND',
      });
      await assert.rejects(story([keep(0), keep(0)]), { code: 'BAD_REQUEST' });
      await assert.rejects(story([keep(0)], []), { code: 'CONFLICT' });

      // Second paragraph first and corrected, first paragraph removed, one paragraph added.
      const rest = before.biography.slice(2).map((_, i) => keep(i + 2));
      const result = await story([
        { ...keep(1), text: 'A corrected second paragraph.' },
        ...rest,
        { text: 'A new closing paragraph.', citations: [{ sourceId, locator: 'p. 4' }] },
      ]);
      const after = await lewis();
      assert.equal(after.biography.length, before.biography.length);
      assert.equal(after.biography[0]!.text, 'A corrected second paragraph.');
      assert.deepEqual(after.biography[0]!.creditIds, before.biography[1]!.creditIds);
      assert.deepEqual(after.biography.at(-1)!.citations, [{ sourceId, locator: 'p. 4' }]);
      assert.ok(after.biography.at(-1)!.id!.startsWith('staff-'));
      assert.ok(!after.biography.some((p) => p.text === before.biography[0]!.text));
      // Saving the same story again changes nothing.
      assert.equal(
        (
          await story(
            after.biography.map((p, from) => ({ from, text: p.text, citations: p.citations })),
            after.biography,
          )
        ).edits.length,
        0,
      );
      await undoStaffEdit(result.edits[0]!.id, 'Back', reviewer);
      assert.deepEqual((await lewis()).biography, before.biography);
    });
    await t.test('full birth and death dates stay in their years', async () => {
      const before = await lewis();
      // A day that does not exist, and a date outside the year being set, are refused.
      await assert.rejects(
        editPerson('john-lewis', { patch: { birthDate: '1940-02-30' }, reason: 'Date' }, reviewer),
      );
      await assert.rejects(
        editPerson(
          'john-lewis',
          { patch: { birthYear: 1940, birthDate: '1941-02-21' }, reason: 'Date' },
          reviewer,
        ),
        { code: 'BAD_REQUEST' },
      );
      const dated = await editPerson(
        'john-lewis',
        {
          patch: { birthYear: 1940, birthDate: '1940-02-21', deathDate: '2020-07' },
          reason: 'Full dates from the House biography',
        },
        reviewer,
      );
      assert.equal(dated.person.birthDate, '1940-02-21');
      assert.equal(dated.person.deathDate, '2020-07');
      assert.equal(dated.person.deathYear, 2020);
      // A reviewer publishing a different year drops the full date it no longer matches.
      const id = await publish('john-lewis', { personPatch: { birthYear: 1939 } });
      let after = await lewis();
      assert.equal(after.birthYear, 1939);
      assert.equal(after.birthDate, undefined);
      assert.equal(after.deathDate, '2020-07');
      await withdraw(id);
      after = await lewis();
      assert.equal(after.birthYear, 1940);
      assert.equal(after.birthDate, '1940-02-21');
      // Clearing the year clears its date; undo restores both.
      const cleared = await editPerson(
        'john-lewis',
        { patch: { deathYear: null }, reason: 'Unverified' },
        reviewer,
      );
      assert.equal(cleared.person.deathDate, undefined);
      await undoStaffEdit(cleared.edits[0]!.id, 'Verified after all', reviewer);
      assert.equal((await lewis()).deathDate, '2020-07');
      await undoStaffEdit(dated.edits[0]!.id, 'Back to years', reviewer);
      after = await lewis();
      assert.equal(after.birthDate, undefined);
      assert.equal(after.deathDate, undefined);
      assert.equal(after.birthYear, before.birthYear);
    });
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});
