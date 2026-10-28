import type { PersonProfile, ProfileSubmission } from '@southview/validators';
/** Prevent ordinary image requests for unsent files and receipt-protected evidence. */
export function previewMediaUrls(
  profile: PersonProfile | null,
  files: Record<string, File>,
  loaded: Record<string, string>,
  requiresReceipt = false,
): Record<string, string> {
  const urls: Record<string, string> = {};
  [profile?.portrait?.mediaId, ...(profile?.sources.map((source) => source.mediaId) ?? [])].forEach(
    (id) => {
      if (id && (files[id] || requiresReceipt)) urls[id] = loaded[id] ?? '';
    },
  );
  return urls;
}
export function profileMultipart(
  payload: unknown,
  files: Record<string, File>,
  profile: PersonProfile,
) {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  const ids = new Set([
    profile.portrait?.mediaId,
    ...profile.sources.map((source) => source.mediaId),
  ]);
  Object.entries(files).forEach(([id, file]) => {
    if (ids.has(id)) form.set(`file:${id}`, file);
  });
  return form;
}

export type ProfileRequestIdentity = { id: string; token: string; signature: string };
type ProfileAttemptDetails = Omit<
  ProfileSubmission,
  'requestId' | 'receiptToken' | 'permission'
> & { permission: boolean };
/** Edited attempts need fresh reservations; unchanged retries retain idempotency. */
export function prepareProfileAttempt(
  details: ProfileAttemptDetails,
  files: Record<string, File>,
  current: ProfileRequestIdentity,
  nextId: () => string,
) {
  if (current.signature === JSON.stringify(details)) return { details, files, request: current };
  let nextDetails = details;
  let nextFiles = files;
  if (current.id) {
    const replacements = new Map<string, string>();
    nextFiles = {};
    const renew = (id: string | undefined) => {
      if (!id || !files[id]) return id;
      if (!replacements.has(id)) {
        const replacement = nextId();
        replacements.set(id, replacement);
        nextFiles[replacement] = files[id]!;
      }
      return replacements.get(id)!;
    };
    const profile: PersonProfile = {
      ...details.profile,
      ...(details.profile.portrait
        ? {
            portrait: {
              ...details.profile.portrait,
              mediaId: renew(details.profile.portrait.mediaId),
            },
          }
        : {}),
      sources: details.profile.sources.map((source) => ({
        ...source,
        mediaId: renew(source.mediaId),
      })),
    };
    nextDetails = { ...details, profile };
  }
  const request = {
    id: nextId(),
    token: nextId() + nextId(),
    signature: JSON.stringify(nextDetails),
  };
  return { details: nextDetails, files: nextFiles, request };
}
