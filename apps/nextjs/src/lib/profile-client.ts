'use client';
import { useEffect, useState } from 'react';
import type { PersonProfile } from '@southview/validators';
import { CommunityRequestError } from './community-client';
import { previewMediaUrls } from './profile-preview';
export async function profileRequest<T>(
  path: string,
  options: RequestInit = {},
  receiptToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (receiptToken) headers.set('X-Receipt-Token', receiptToken);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/profiles/${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CommunityRequestError(
      data.error || 'The request could not be completed. Please try again.',
      response.status,
    );
  return data as T;
}
export function useProfileMedia(
  profile: PersonProfile | null,
  files: Record<string, File> = {},
  receiptToken?: string,
) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const objects: string[] = [];
    const ids = [
      ...new Set(
        [
          profile?.portrait?.mediaId,
          ...(profile?.sources.map((source) => source.mediaId) ?? []),
        ].filter((id): id is string => !!id),
      ),
    ];
    const next: Record<string, string> = {};
    void Promise.all(
      ids.map(async (id) => {
        if (files[id]) {
          if (
            !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(files[id]!.type)
          )
            return;
          next[id] = URL.createObjectURL(files[id]);
          objects.push(next[id]!);
          return;
        }
        if (!receiptToken) return;
        try {
          const response = await fetch(`/api/profiles/media/${encodeURIComponent(id)}`, {
            headers: { 'X-Receipt-Token': receiptToken },
            credentials: 'same-origin',
            cache: 'no-store',
          });
          if (response.ok) {
            const blob = await response.blob();
            if (!active) return;
            next[id] = URL.createObjectURL(blob);
            objects.push(next[id]!);
          }
        } catch {
          /* The evidence link remains available for a later retry. */
        }
      }),
    ).then(() => {
      if (active) setUrls(next);
    });
    return () => {
      active = false;
      objects.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [profile, files, receiptToken]);
  return previewMediaUrls(profile, files, urls, !!receiptToken);
}
export const emptyProfile = (): PersonProfile => ({
  name: '',
  tags: [],
  bodyMarkdown: '',
  bodySourceIds: [],
  sources: [],
  locations: [],
});
export const newProfileId = () => crypto.randomUUID();
export { profileMultipart } from './profile-preview';
