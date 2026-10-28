import { validateArchive, type ArchiveData } from '@southview/validators';
import { ensureCanonicalProfiles } from './profiles';
import { projectProfilesToArchive } from './profile-conversion';
import { closeStores, createStore, getStore, type Store } from './connection';

/** Reads only explicitly public tables. Never join private submissions/authentication here. */
export async function readLegacyStoreArchive(store: Store): Promise<ArchiveData> {
  return store.transaction(async (tx) => {
    if (store.dialect === 'database')
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const read = async (table: string) =>
      (await tx.query<{ data: unknown }>(`SELECT data FROM archive.${table} ORDER BY id`)).rows.map(
        (row) => row.data,
      );
    const people = await read('persons');
    const places = await read('places');
    const relations = await read('person_places');
    const materials = await read('materials');
    const sources = await read('sources');
    const issues = await read('issues');
    const credits = await read('credits');
    const contributions = await read('contributions');
    const crosswalk = (
      await tx.query<{ data: unknown }>(
        'SELECT data FROM archive.crosswalk ORDER BY project, external_id',
      )
    ).rows.map((row) => row.data);
    return validateArchive({
      people,
      places,
      relations,
      materials,
      sources,
      issues,
      crosswalk,
      credits,
      contributions,
    });
  });
}
/** Current public views use complete canonical replacements, including complete removals. */
export async function readStoreArchive(store: Store): Promise<ArchiveData> {
  return store.transaction(async (tx) => {
    await ensureCanonicalProfiles(tx);
    const rows = (
      await tx.query<{ id: string; version: number; data: unknown; updated_at: Date | string }>(
        'SELECT id,version,data,updated_at FROM archive.persons WHERE version>=1 ORDER BY id',
      )
    ).rows;
    const { profileSchema } = await import('@southview/validators');
    const crosswalk = (
      await tx.query<{ data: ArchiveData['crosswalk'][number] }>(
        'SELECT data FROM archive.crosswalk ORDER BY project,external_id',
      )
    ).rows.map((r) => r.data);
    const credits = (
      await tx.query<{ data: ArchiveData['credits'][number] }>(
        'SELECT data FROM archive.credits ORDER BY id',
      )
    ).rows.map((r) => r.data);
    return projectProfilesToArchive(
      rows.map((r) => ({
        id: r.id,
        version: r.version,
        profile: profileSchema.parse(r.data),
        updatedAt: new Date(r.updated_at).toISOString(),
      })),
      {
        people: [],
        sources: [],
        places: [],
        relations: [],
        materials: [],
        contributions: [],
        issues: [],
        credits,
        crosswalk,
      },
    );
  });
}
export async function readDatabaseArchive(url: string): Promise<ArchiveData> {
  const store = await createStore({ mode: 'database', url });
  try {
    return await readStoreArchive(store);
  } finally {
    await store.close();
  }
}
export async function readCurrentArchive() {
  return readStoreArchive(await getStore());
}
export const closeDatabaseConnections = closeStores;
