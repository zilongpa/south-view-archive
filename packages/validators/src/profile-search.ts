import { z } from 'zod';
import type { PublishedProfile } from './profiles';
import { discoveryPlainText } from './discovery';

export const PROFILE_PAGE_SIZE = 12;
export const profileSearchInputSchema = z.object({
  q: z.string().trim().max(200).default(''),
  name: z.string().trim().max(160).default(''),
  tag: z.string().trim().max(80).default('all'),
  personId: z.string().max(120).optional(),
  place: z.string().trim().max(200).default(''),
  placeId: z.string().max(250).optional(),
  sort: z.enum(['relevance', 'recent']).default('relevance'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
export type ProfileSearchInput = z.infer<typeof profileSearchInputSchema>;
export type ProfileSearchPage = {
  items: (PublishedProfile & { excerpt: string })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const tokens = (text: string) => [...new Set(normalize(text).split(/\s+/u).filter(Boolean))];
export function profilePlainText(body: string): string {
  return discoveryPlainText(
    body
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\^[^\]]+\]/g, '')
      .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
      .replace(/[*_`~]/g, ''),
  );
}
function snippet(body: string, words: string[]) {
  const plain = profilePlainText(body);
  if (plain.length <= 240) return plain;
  const positions = words.map((word) => normalize(plain).indexOf(word)).filter((n) => n >= 0);
  const first = positions.length ? Math.min(...positions) : 0;
  let start = Math.max(0, first - 70);
  if (start) {
    const space = plain.indexOf(' ', start);
    if (space >= 0 && space < first) start = space + 1;
  }
  const text = plain.slice(start, start + 240).trim();
  return `${start ? '…' : ''}${text}${start + 240 < plain.length ? '…' : ''}`;
}
function timestamp(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/** Only accepts published profiles. Each matching person appears exactly once. */
export function searchProfiles(
  profiles: PublishedProfile[],
  raw: Partial<ProfileSearchInput>,
): ProfileSearchPage {
  const input = profileSearchInputSchema.parse(raw);
  const query = tokens(input.q);
  const name = tokens(input.name);
  const place = tokens(input.place);
  const ranked = profiles.flatMap((record) => {
    const p = record.profile;
    if (input.personId && record.id !== input.personId) return [];
    if (input.tag !== 'all' && !p.tags.some((tag) => normalize(tag) === normalize(input.tag)))
      return [];
    const names = normalize([p.name, ...(p.aliases ?? [])].join(' '));
    if (!name.every((word) => names.includes(word))) return [];
    if (
      input.placeId &&
      !p.locations.some(
        (location) =>
          input.placeId === `${record.id}:${location.id}` || input.placeId === location.id,
      )
    )
      return [];
    const placeText = normalize(
      p.locations
        .flatMap((location) => [
          location.name,
          location.address ?? '',
          location.label,
          location.description,
        ])
        .join(' '),
    );
    if (!place.every((word) => placeText.includes(word))) return [];
    const body = profilePlainText(p.bodyMarkdown);
    const title = normalize(p.name);
    const text = normalize(
      [names, p.birthYear ?? '', p.deathYear ?? '', ...p.tags, body, placeText].join(' '),
    );
    if (!query.every((word) => text.includes(word))) return [];
    const score = query.length
      ? (title === normalize(input.q) ? 100 : title.includes(normalize(input.q)) ? 50 : 0) +
        query.filter((word) => title.includes(word)).length * 10 +
        query.filter((word) => p.tags.some((tag) => normalize(tag).includes(word))).length * 3
      : 0;
    return [{ record, score, excerpt: snippet(p.bodyMarkdown, query) }];
  });
  ranked.sort((a, b) => {
    const primary =
      input.sort === 'recent'
        ? timestamp(b.record.updatedAt) - timestamp(a.record.updatedAt)
        : b.score - a.score;
    return (
      primary ||
      a.record.profile.name.localeCompare(b.record.profile.name) ||
      a.record.id.localeCompare(b.record.id)
    );
  });
  const totalPages = Math.max(1, Math.ceil(ranked.length / PROFILE_PAGE_SIZE));
  const page = Math.min(input.page, totalPages);
  return {
    items: ranked
      .slice((page - 1) * PROFILE_PAGE_SIZE, page * PROFILE_PAGE_SIZE)
      .map(({ record, excerpt }) => ({ ...record, excerpt })),
    total: ranked.length,
    page,
    pageSize: PROFILE_PAGE_SIZE,
    totalPages,
  };
}
