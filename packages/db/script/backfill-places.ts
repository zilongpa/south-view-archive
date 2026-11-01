import { createStore, getStore, dataMode } from '../src/connection';
import { fixtureArchive } from '../src/fixtures';
import { migrationDatabaseUrl } from './environment';

// Fills in the fixture description for seeded places that still have none. Places a reviewer
// has already described are left alone, so the script is safe to run again. Stop a local
// development server first: PGlite allows one process at a time.
const store =
  dataMode() === 'database'
    ? await createStore({ mode: 'database', url: migrationDatabaseUrl() })
    : await getStore();
try {
  const updated = await store.transaction(async (tx) => {
    let count = 0;
    for (const place of fixtureArchive.places) {
      if (!place.summary) continue;
      const row = (
        await tx.query<{ data: Record<string, unknown> }>(
          'SELECT data FROM archive.places WHERE id = $1 FOR NO KEY UPDATE',
          [place.id],
        )
      ).rows[0];
      if (!row) continue;
      if (typeof row.data.summary === 'string' && row.data.summary.trim()) continue;
      await tx.query('UPDATE archive.places SET data = $2::jsonb WHERE id = $1', [
        place.id,
        JSON.stringify({
          ...row.data,
          summary: place.summary,
          summaryCitations: place.summaryCitations,
        }),
      ]);
      count++;
    }
    return count;
  });
  console.log(`Place descriptions filled in: ${updated}.`);
} finally {
  await store.close();
}
