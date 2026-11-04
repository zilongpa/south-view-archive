'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ArchiveData, Person, PersonPlace, Place, StaffEdit } from '@southview/validators';

type Overrides = Record<string, Record<string, unknown> | null>;
const key = (table: string, id: string) => `${table}:${id}`;

function merge<T extends { id: string }>(rows: T[], table: string, overrides: Overrides): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    seen.add(row.id);
    const override = overrides[key(table, row.id)];
    if (override === undefined) result.push(row);
    else if (override !== null) result.push(override as unknown as T);
  }
  for (const [name, data] of Object.entries(overrides)) {
    const [overrideTable, ...rest] = name.split(':');
    const id = rest.join(':');
    if (overrideTable === table && data && !seen.has(id)) result.push(data as unknown as T);
  }
  return result;
}

/**
 * The archive as the admin should show it: the page's server data with every change saved in
 * this visit applied on top, so edits appear at once while the server data refreshes behind.
 */
export function useAdminArchive(archive: ArchiveData) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Overrides>({});
  const merged = useMemo<ArchiveData>(
    () => ({
      ...archive,
      people: merge<Person>(archive.people, 'persons', overrides),
      places: merge<Place>(archive.places, 'places', overrides),
      relations: merge<PersonPlace>(archive.relations, 'person_places', overrides),
    }),
    [archive, overrides],
  );
  const apply = useCallback(
    (edits: StaffEdit[]) => {
      if (!edits.length) return;
      setOverrides((current) => {
        const next = { ...current };
        for (const edit of edits) next[key(edit.targetTable, edit.targetId)] = edit.next;
        return next;
      });
      router.refresh();
    },
    [router],
  );
  return { archive: merged, apply };
}
