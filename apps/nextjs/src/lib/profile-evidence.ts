import type { PersonProfile, ProfileSource } from '@southview/validators';

export type EvidenceTarget = 'body' | 'portrait' | { locationId: string };
function idsFor(profile: PersonProfile, target: EvidenceTarget) {
  if (target === 'body') return profile.bodySourceIds;
  if (target === 'portrait') return profile.portrait?.sourceIds ?? [];
  const location = profile.locations.find((item) => item.id === target.locationId);
  return [...new Set([...(location?.sourceIds ?? []), ...(location?.coordinateSourceIds ?? [])])];
}
export function evidenceSources(profile: PersonProfile, target: EvidenceTarget) {
  return idsFor(profile, target).flatMap((id) => {
    const source = profile.sources.find((item) => item.id === id);
    return source ? [source] : [];
  });
}
function assign(profile: PersonProfile, target: EvidenceTarget, ids: string[]): PersonProfile {
  if (target === 'body') return { ...profile, bodySourceIds: ids };
  if (target === 'portrait')
    return profile.portrait
      ? { ...profile, portrait: { ...profile.portrait, sourceIds: ids } }
      : profile;
  return {
    ...profile,
    locations: profile.locations.map((location) =>
      location.id === target.locationId
        ? {
            ...location,
            sourceIds: ids,
            coordinateSourceIds: location.coordinates ? ids : [],
          }
        : location,
    ),
  };
}
export function addBodySource(profile: PersonProfile, source: ProfileSource): PersonProfile {
  return {
    ...profile,
    sources: [...profile.sources, source],
    bodySourceIds: [...profile.bodySourceIds, source.id],
  };
}
/** The editor presents a link/file; source identities and evidence relationships stay internal. */
export function setDirectEvidence(
  profile: PersonProfile,
  target: Exclude<EvidenceTarget, 'body'>,
  sourceId: string | undefined,
  input: { url?: string; mediaId?: string; fileName?: string },
  nextId: () => string,
): PersonProfile {
  const old = profile.sources.find((source) => source.id === sourceId);
  const outsideTarget =
    target === 'portrait'
      ? { ...profile, portrait: undefined }
      : {
          ...profile,
          locations: profile.locations.filter((location) => location.id !== target.locationId),
        };
  const shared =
    old && pruneEvidenceSources(outsideTarget).sources.some((source) => source.id === old.id);
  const id = old && !shared ? old.id : nextId();
  const unchanged = old && (input.mediaId ? old.mediaId === input.mediaId : old.url === input.url);
  const source: ProfileSource = {
    ...(unchanged ? old : {}),
    id,
    title:
      (unchanged ? old?.title : undefined) ||
      input.fileName ||
      input.url?.trim().slice(0, 200) ||
      (target === 'portrait' ? 'Image source' : 'Location source'),
    kind: input.mediaId ? 'attachment' : 'link',
    url: input.mediaId ? undefined : input.url,
    mediaId: input.mediaId,
  };
  const next = {
    ...profile,
    sources:
      old && !shared
        ? profile.sources.map((s) => (s.id === id ? source : s))
        : [...profile.sources, source],
  };
  const ids = idsFor(profile, target).map((ref) => (ref === old?.id ? id : ref));
  return assign(next, target, [...new Set([...ids, id])]);
}
export function removeEvidence(profile: PersonProfile, target: EvidenceTarget, sourceId: string) {
  let next = assign(
    profile,
    target,
    idsFor(profile, target).filter((id) => id !== sourceId),
  );
  if (target === 'body') {
    next = {
      ...next,
      bodyMarkdown: next.bodyMarkdown.replace(
        /\[(?:\^|source:)([^\]\n]+)\]/g,
        (mark, id: string) => (id === sourceId ? '' : mark),
      ),
    };
  }
  return pruneEvidenceSources(next);
}
export function pruneEvidenceSources(profile: PersonProfile): PersonProfile {
  const used = new Set([
    ...profile.bodySourceIds,
    ...(profile.portrait?.sourceIds ?? []),
    ...profile.locations.flatMap((location) => [
      ...location.sourceIds,
      ...location.coordinateSourceIds,
    ]),
    ...[...profile.bodyMarkdown.matchAll(/\[(?:\^|source:)([^\]\n]+)\]/g)].map(
      (match) => match[1]!,
    ),
  ]);
  return { ...profile, sources: profile.sources.filter((source) => used.has(source.id)) };
}
