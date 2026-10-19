import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { processPhoto } from '../src/photos';
import { createS3Storage, type ImageContentType } from '../src/storage';

// Same precedence as the migration/reviewer commands; this command never opens the database.
for (const name of ['.env.local', '.env']) {
  const filename = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
  if (existsSync(filename)) loadEnvFile(filename);
}

let storage: ReturnType<typeof createS3Storage> | undefined;
const written: string[] = [];
try {
  if (process.env.PHOTO_STORAGE !== 's3')
    throw new Error(
      'Set PHOTO_STORAGE=s3 and the S3 variables in the root .env.local or process environment.',
    );
  storage = createS3Storage(process.env);
  const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#70513f' } })
    .png()
    .toBuffer();
  const photo = await processPhoto(input);
  const id = randomUUID();
  const objects: { key: string; bytes: Buffer; contentType: ImageContentType }[] = [
    { key: `originals/${id}.png`, bytes: photo.original, contentType: 'image/png' },
    { key: `processed/${id}.jpg`, bytes: photo.processed, contentType: 'image/jpeg' },
  ];
  for (const object of objects) {
    await storage.write(object.key, object.bytes, object.contentType);
    written.push(object.key);
    const read = await storage.read(object.key);
    if (!read?.bytes.equals(object.bytes) || read.contentType !== object.contentType)
      throw new Error('S3 read-back verification failed.');
  }
  for (const key of written) {
    await storage.delete(key);
    if (await storage.read(key)) throw new Error('S3 deletion verification failed.');
  }
  written.length = 0;
  process.stdout.write(
    'S3 photo write, read-back, and delete passed. Check bucket privacy separately in the provider console.\n',
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'S3 storage check failed.'}\n`);
  process.exitCode = 1;
} finally {
  for (const key of written) {
    try {
      await storage?.delete(key);
    } catch {
      process.stderr.write(
        `Could not remove probe object ${key}; remove it in the provider console.\n`,
      );
      process.exitCode = 1;
    }
  }
  storage?.close();
}
