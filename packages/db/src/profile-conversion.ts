import {
  profileSchema,
  validateArchive,
  type ArchiveData,
  type Citation,
  type PublishedProfile,
  type ProfileSource,
} from '@southview/validators';
const initialTime = '2026-10-28T00:00:00.000Z';
/** Pure deterministic migration. Missing references fail instead of dropping evidence. */
export function convertArchiveProfiles(input: ArchiveData): PublishedProfile[] {
  const data = validateArchive(input);
  const credit = (id: string) =>
    data.credits.find((c) => c.id === id)?.displayName ?? 'Initial archive compilation';
  return data.people.map((person) => {
    const refs = new Set<string>();
    const locators = new Map<string, Set<string>>();
    const cite = (citations: Citation[]) =>
      citations.forEach((c) => {
        refs.add(c.sourceId);
        if (c.locator) {
          const values = locators.get(c.sourceId) ?? new Set<string>();
          values.add(c.locator);
          locators.set(c.sourceId, values);
        }
      });
    const add = (ids: string[]) => ids.forEach((s) => refs.add(s));
    cite(person.summaryCitations);
    person.biography.forEach((b) => cite(b.citations));
    if (person.portrait) add([person.portrait.sourceId]);
    const body = [
      person.summary,
      ...person.biography.map((b) => {
        const authors = b.creditIds.filter((id) => id !== 'initial-compilation').map(credit);
        return b.text + (authors.length ? `\n\nPublic contribution by ${authors.join(', ')}.` : '');
      }),
    ];
    const extra: ProfileSource[] = [];
    const stories = data.contributions.filter(
      (c) => c.personId === person.id || c.relatedPersonIds.includes(person.id),
    );
    for (const c of stories) {
      add(c.sourceIds);
      const sourceId = `story-${c.id}`;
      extra.push({
        id: sourceId,
        title: c.title,
        kind: c.kind === 'memory' ? 'memory' : 'link',
        ...(c.kind === 'memory' ? {} : { url: `/contributions/${c.id}` }),
        creator: credit(c.creditId),
        rights: 'Published community contribution',
      });
      refs.add(sourceId);
      body.push(
        `## ${c.title}\n\n${c.kind === 'memory' ? 'Recollection' : 'Public contribution'} by ${credit(c.creditId)}.\n\n${c.body}${c.sourceCreator ? `\n\nSource creator: ${c.sourceCreator}` : ''}${c.narrator ? `\n\nNarrator: ${c.narrator}` : ''}${c.holdingInstitution ? `\n\nHolding institution: ${c.holdingInstitution}` : ''}${c.context ? `\n\n${c.context}` : ''}`,
      );
      for (const photo of c.photos) {
        const photoId = `photo-${photo.id}`;
        extra.push({
          id: photoId,
          title: photo.caption,
          kind: 'attachment',
          url: photo.url,
          creator: photo.creator,
          rights: photo.rights,
        });
        refs.add(photoId);
        body.push(`[${photo.caption}](${photo.url}) — ${photo.creator}; ${photo.rights}`);
      }
    }
    for (const issue of data.issues.filter((i) => i.personId === person.id)) {
      add(issue.sourceIds);
      if (!/coordinates?/i.test(issue.field)) {
        const label = issue.field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        body.push(`### Archive note: ${label[0]!.toUpperCase()}${label.slice(1)}\n\n${issue.note}`);
      }
    }
    for (const m of data.materials.filter(
      (m) => m.personId === person.id || m.relatedPersonIds.includes(person.id),
    )) {
      add([m.sourceId]);
      const s = data.sources.find((s) => s.id === m.sourceId)!;
      body.push(
        `## ${m.title}\n\n${m.description}\n\n[${m.title}](${s.url})${m.narrator ? ` — Narrator: ${m.narrator}` : ''}${m.interviewer ? `; interviewer: ${m.interviewer}` : ''}${
          m.creditIds.some((id) => id !== 'initial-compilation')
            ? `\n\nPublic contribution by ${m.creditIds
                .filter((id) => id !== 'initial-compilation')
                .map(credit)
                .join(', ')}.`
            : ''
        }`,
      );
    }
    const locations = data.relations
      .filter((r) => r.personId === person.id)
      .map((r) => {
        const p = data.places.find((p) => p.id === r.placeId)!;
        const mapIssues = data.issues.filter(
          (issue) =>
            issue.personId === person.id &&
            /coordinates?/i.test(issue.field) &&
            (!/burial|grave/i.test(issue.field) || p.scope === 'cemetery'),
        );
        cite(r.citations);
        cite(p.coordinateCitations);
        return {
          id: r.id,
          name: p.name,
          label: r.label,
          description: r.description,
          scope: p.scope,
          address: p.address,
          coordinates: p.coordinates,
          precision: p.precision,
          sourceIds: [...new Set(r.citations.map((c) => c.sourceId))],
          coordinateSourceIds: [
            ...new Set([
              ...p.coordinateCitations.map((c) => c.sourceId),
              ...mapIssues.flatMap((issue) => issue.sourceIds),
            ]),
          ],
          locationNote: [
            p.locationNote,
            ...mapIssues
              .map((issue) => issue.note)
              .filter((note) => !p.locationNote.includes(note)),
          ]
            .filter(Boolean)
            .join('\n\n'),
        };
      });
    const sources: ProfileSource[] = [
      ...data.sources
        .filter((s) => refs.has(s.id))
        .map((s) => ({
          id: s.id,
          title: s.title,
          kind: s.kind === 'community-memory' ? ('memory' as const) : ('link' as const),
          url: s.url,
          creator: s.creator || s.creditIds.map(credit).join(', '),
          rights: s.rights,
          locator:
            [
              s.publisher ? `Publisher: ${s.publisher}` : undefined,
              s.accessedAt ? `Accessed: ${s.accessedAt}` : undefined,
              s.creditIds.length ? `Credits: ${s.creditIds.map(credit).join(', ')}` : undefined,
              ...(locators.get(s.id) ?? []),
              s.catalogueId,
              s.date,
              s.note,
            ]
              .filter(Boolean)
              .join('; ') || undefined,
        })),
      ...extra,
    ];
    const parsed = profileSchema.safeParse({
      name: person.name,
      aliases: person.aliases,
      birthYear: person.birthYear,
      deathYear: person.deathYear,
      tags: person.themes,
      bodyMarkdown: body.join('\n\n'),
      bodySourceIds: [...refs],
      sources,
      portrait: person.portrait
        ? {
            url: person.portrait.url,
            alt: person.portrait.alt,
            credit: person.portrait.credit,
            rights:
              data.sources.find((s) => s.id === person.portrait!.sourceId)?.rights ||
              'See original collection rights.',
            sourceIds: [person.portrait.sourceId],
          }
        : undefined,
      locations,
    });
    if (!parsed.success)
      throw new Error(
        `Cannot convert legacy profile ${person.id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    return {
      id: person.id,
      version: 1,
      profile: parsed.data,
      updatedAt: initialTime,
      publicCredit: 'Initial archive compilation',
    };
  });
}
/** Compatibility is a fresh projection. Legacy body/location/media are never merged back. */
export function projectProfilesToArchive(
  profiles: PublishedProfile[],
  legacy?: ArchiveData,
): ArchiveData {
  const credits = [
    ...(legacy?.credits ?? [
      {
        id: 'initial-compilation',
        displayName: 'Initial archive compilation',
        kind: 'initial' as const,
      },
    ]),
  ];
  if (!credits.some((c) => c.id === 'initial-compilation'))
    credits.push({
      id: 'initial-compilation',
      displayName: 'Initial archive compilation',
      kind: 'initial',
    });
  const sources: ArchiveData['sources'] = [],
    people: ArchiveData['people'] = [],
    places: ArchiveData['places'] = [],
    relations: ArchiveData['relations'] = [];
  for (const { id, profile: p } of profiles) {
    const sid = (s: string) => `${id}:${s}`;
    const citations = (ids: string[]) => ids.map((s) => ({ sourceId: sid(s) }));
    sources.push(
      ...p.sources.map((s) => ({
        id: sid(s.id),
        title: s.title,
        creator: s.creator ?? '',
        publisher: 'Profile evidence',
        url:
          s.url ??
          (s.mediaId ? `/api/profiles/media/${s.mediaId}` : `/people/${id}#source-${s.id}`),
        accessedAt: '2026-10-28',
        kind:
          s.kind === 'memory'
            ? ('community-memory' as const)
            : s.kind === 'attachment'
              ? ('image' as const)
              : ('document' as const),
        creditIds: ['initial-compilation'],
        rights: s.rights,
        note: s.locator,
      })),
    );
    people.push({
      id,
      name: p.name,
      aliases: p.aliases ?? [],
      birthYear: p.birthYear,
      deathYear: p.deathYear,
      themes: p.tags,
      summary: p.bodyMarkdown,
      summaryCitations: citations(p.bodySourceIds),
      biography: [],
      creditIds: ['initial-compilation'],
      portrait: p.portrait
        ? {
            url: p.portrait.mediaId ? `/api/profiles/media/${p.portrait.mediaId}` : p.portrait.url!,
            alt: p.portrait.alt,
            credit: p.portrait.credit,
            sourceId: sid(p.portrait.sourceIds[0]!),
            creditIds: ['initial-compilation'],
          }
        : undefined,
    });
    for (const l of p.locations) {
      const placeId = `${id}:${l.id}`;
      places.push({
        id: placeId,
        name: l.name,
        scope: l.scope,
        coordinates: l.coordinates,
        address: l.address,
        precision: l.precision,
        locationNote: l.locationNote,
        coordinateCitations: citations(l.coordinateSourceIds),
        creditIds: ['initial-compilation'],
      });
      relations.push({
        id: placeId,
        personId: id,
        placeId,
        label: l.label,
        description: l.description,
        citations: citations(l.sourceIds),
        creditIds: ['initial-compilation'],
      });
    }
  }
  const ids = new Set(profiles.map((p) => p.id));
  return validateArchive({
    people,
    places,
    relations,
    sources,
    credits,
    materials: [],
    contributions: [],
    issues: [],
    crosswalk: legacy?.crosswalk.filter((c) => !c.personId || ids.has(c.personId)) ?? [],
  });
}
