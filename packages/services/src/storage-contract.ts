export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type MediaContentType = ImageContentType | 'application/pdf';
export type PrivateObject = { bytes: Buffer; contentType: MediaContentType };
export interface PrivateStorage {
  write(key: string, bytes: Buffer, contentType: MediaContentType): Promise<void>;
  read(key: string): Promise<PrivateObject | null>;
  delete(key: string): Promise<void>;
  signUpload?(
    key: string,
    size: number,
    contentType: ImageContentType,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  signDownload?(key: string): Promise<string>;
}

export function validateStorageKey(key: string) {
  if (!/^(originals|processed|staging|evidence)\/[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/.test(key))
    throw new Error('Invalid private object key.');
  return key;
}

export function contentTypeFor(key: string): MediaContentType {
  return key.endsWith('.pdf')
    ? 'application/pdf'
    : key.endsWith('.png')
      ? 'image/png'
      : key.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
}

export function validWrite(key: string, bytes: Buffer, contentType: MediaContentType) {
  validateStorageKey(key);
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES)
    throw new Error('Photos must be at most 10 MB.');
  if (contentType !== contentTypeFor(key))
    throw new Error('Photo type does not match its private object key.');
}
