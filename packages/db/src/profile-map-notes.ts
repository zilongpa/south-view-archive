import { profileSchema, type ArchiveData, type PersonProfile } from '@southview/validators';
import type { Store } from './connection';

type Issue = ArchiveData['issues'][number];
const fragment = (issue: Issue) => `### Archive note: ${issue.field}\n\n${issue.note}`;

/** Only exact converter fragments with an initial accepted-snapshot provenance qualify. */
async function inheritedIssues(tx: Store, personId?: string): Promise<Map<string, Issue[]>> {
  const rows = (
    await tx.query<{ person_id: string; profile: PersonProfile; issue: Issue }>(
      `SELECT v.person_id,v.profile,i.data AS issue FROM community.profile_versions v JOIN archive.issues i ON i.person_id=v.person_id WHERE v.version=1 AND v.reviewer_id IS NULL AND v.request_id IS NULL AND v.public_credit='Initial archive compilation'${personId ? ' AND v.person_id=$1' : ''} ORDER BY v.person_id,i.id`,
      personId ? [personId] : [],
    )
  ).rows;
  const known = new Map<string, Issue[]>();
  for (const row of rows) {
    if (!row.profile.bodyMarkdown.includes(fragment(row.issue))) continue;
    known.set(row.person_id, [...(known.get(row.person_id) ?? []), row.issue]);
  }
  return known;
}
function correct(profile: PersonProfile, issues: Issue[]): PersonProfile {
  let next = profile;
  for (const issue of issues) {
    const old = fragment(issue),
      index = next.bodyMarkdown.indexOf(old);
    if (index < 0 || (index > 0 && next.bodyMarkdown.slice(index - 2, index) !== '\n\n')) continue;
    const end = index + old.length;
    if (end < next.bodyMarkdown.length && !next.bodyMarkdown.slice(end).startsWith('\n\n'))
      continue;
    next = structuredClone(next);
    if (/coordinates?/i.test(issue.field)) {
      next.bodyMarkdown = (next.bodyMarkdown.slice(0, index) + next.bodyMarkdown.slice(end))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const sources = new Set(next.sources.map((source) => source.id));
      next.locations = next.locations.map((location) => {
        if (/burial|grave/i.test(issue.field) && location.scope !== 'cemetery') return location;
        return {
          ...location,
          locationNote: location.locationNote.includes(issue.note)
            ? location.locationNote
            : [location.locationNote, issue.note].filter(Boolean).join('\n\n'),
          coordinateSourceIds: [
            ...new Set([
              ...location.coordinateSourceIds,
              ...issue.sourceIds.filter((id) => sources.has(id)),
            ]),
          ],
        };
      });
    } else {
      const label = issue.field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      next.bodyMarkdown = next.bodyMarkdown.replace(
        old,
        `### Archive note: ${label[0]!.toUpperCase()}${label.slice(1)}\n\n${issue.note}`,
      );
    }
  }
  return next === profile ? profile : profileSchema.parse(next);
}
export async function correctedHistoricalProfile(
  tx: Store,
  personId: string,
  profile: PersonProfile,
) {
  return correct(profile, (await inheritedIssues(tx, personId)).get(personId) ?? []);
}

/** Idempotent mechanical correction; accepted snapshots themselves remain immutable. */
export async function repairConvertedMapNotes(tx: Store) {
  const known = await inheritedIssues(tx);
  for (const [personId, issues] of known) {
    const rows = (
      await tx.query<{ id: string; profile: PersonProfile }>(
        'SELECT id,profile FROM community.profile_revisions WHERE person_id=$1 ORDER BY id FOR UPDATE',
        [personId],
      )
    ).rows;
    for (const row of rows) {
      const fixed = correct(row.profile, issues);
      if (fixed !== row.profile)
        await tx.query(
          'UPDATE community.profile_revisions SET profile=$2::jsonb,proposal_version=proposal_version+1,updated_at=now() WHERE id=$1',
          [row.id, JSON.stringify(fixed)],
        );
    }
    const current = (
      await tx.query<{ version: number; data: PersonProfile }>(
        'SELECT version,data FROM archive.persons WHERE id=$1 FOR NO KEY UPDATE',
        [personId],
      )
    ).rows[0];
    if (!current) continue;
    const fixed = correct(current.data, issues);
    if (fixed === current.data) continue;
    const version = current.version + 1;
    await tx.query(
      'INSERT INTO community.profile_versions(person_id,version,profile,public_credit) SELECT person_id,$2,$3::jsonb,public_credit FROM community.profile_versions WHERE person_id=$1 AND version=$4',
      [personId, version, JSON.stringify(fixed), current.version],
    );
    await tx.query(
      'INSERT INTO community.profile_media_refs(media_id,person_id,version) SELECT media_id,person_id,$3 FROM community.profile_media_refs WHERE person_id=$1 AND version=$2',
      [personId, current.version, version],
    );
    await tx.query(
      'UPDATE archive.persons SET data=$2::jsonb,version=$3,updated_at=now() WHERE id=$1',
      [personId, JSON.stringify({ ...fixed, id: personId }), version],
    );
  }
}
