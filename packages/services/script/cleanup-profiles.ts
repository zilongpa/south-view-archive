import { closeStores, dataMode } from '@southview/db/connection';
import { cleanupProfileMedia } from '../src/profile-service';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Same root configuration and process-variable precedence as migration/reviewer scripts.
for (const name of ['.env.local', '.env']) {
  const filename = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
  if (existsSync(filename)) loadEnvFile(filename);
}
if (dataMode() === 'fixture') throw new Error('Fixture mode has no uploaded profile files.');
try {
  const result = await cleanupProfileMedia();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} finally {
  await closeStores();
}
