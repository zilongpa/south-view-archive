import { discoveryInputSchema, type DiscoveryInput } from '@southview/validators';

export function parseStoriesState(
  params: Record<string, string | string[] | undefined>,
): DiscoveryInput {
  const first = (key: string) =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;
  const type = first('type');
  const page = Number(first('page') ?? 1);
  return discoveryInputSchema.parse({
    q: (first('q') ?? '').slice(0, 200),
    type: ['all', 'person', 'story', 'material', 'photo'].includes(type ?? '') ? type : 'all',
    theme: (first('theme') || 'all').slice(0, 80),
    personId: first('personId')?.slice(0, 120) || undefined,
    placeId: first('placeId')?.slice(0, 120) || undefined,
    sort: first('sort') === 'recent' ? 'recent' : 'relevance',
    featured: first('featured') === '1',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1,
  });
}

export function storiesHref(input: DiscoveryInput, patch: Partial<DiscoveryInput> = {}) {
  const next = { ...input, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.type !== 'all') params.set('type', next.type);
  if (next.theme !== 'all') params.set('theme', next.theme);
  if (next.personId) params.set('personId', next.personId);
  if (next.placeId) params.set('placeId', next.placeId);
  if (next.sort !== 'relevance') params.set('sort', next.sort);
  if (next.featured) params.set('featured', '1');
  if (next.page > 1) params.set('page', String(next.page));
  return `/stories${params.size ? `?${params}` : ''}`;
}

export function withStoriesReturn(path: string, returnTo: string) {
  const url = new URL(path, 'https://archive.invalid');
  url.searchParams.set('from', returnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function safeArchiveReturn(value: unknown, fallback = '/stories') {
  if (typeof value !== 'string' || value.length > 3000 || !value.startsWith('/')) return fallback;
  try {
    const url = new URL(value, 'https://archive.invalid');
    return url.origin === 'https://archive.invalid' &&
      ['/stories', '/explore'].includes(url.pathname)
      ? `${url.pathname}${url.search}`
      : fallback;
  } catch {
    return fallback;
  }
}
