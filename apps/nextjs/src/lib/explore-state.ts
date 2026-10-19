import type { Scope } from '@southview/validators';
export type Viewport = { lng: number; lat: number; zoom: number };
export type ExploreState = {
  scope: Scope;
  q: string;
  theme: string;
  person: string | null;
  place: string | null;
  embed: boolean;
  viewport: Viewport | null;
};
export function parseExploreState(query: string): ExploreState {
  const p = new URLSearchParams(query);
  const lng = Number(p.get('lng')),
    lat = Number(p.get('lat')),
    zoom = Number(p.get('z'));
  const hasView =
    ['lng', 'lat', 'z'].every((k) => !!p.get(k)?.trim()) &&
    [lng, lat, zoom].every(Number.isFinite) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) < 85 &&
    zoom >= 1 &&
    zoom <= 20;
  return {
    scope: p.get('scope') === 'atlanta' ? 'atlanta' : 'cemetery',
    q: (p.get('q') ?? '').slice(0, 200),
    theme: (p.get('theme') ?? 'all').slice(0, 80),
    person: p.get('person'),
    place: p.get('place'),
    embed: p.get('embed') === '1',
    viewport: hasView ? { lng, lat, zoom } : null,
  };
}
export function serializeExploreState(s: ExploreState, standalone = false) {
  const p = new URLSearchParams();
  p.set('scope', s.scope);
  if (s.q) p.set('q', s.q);
  if (s.theme !== 'all') p.set('theme', s.theme);
  if (s.person) p.set('person', s.person);
  if (s.place) p.set('place', s.place);
  if (s.embed && !standalone) p.set('embed', '1');
  if (s.viewport) {
    p.set('lng', s.viewport.lng.toFixed(5));
    p.set('lat', s.viewport.lat.toFixed(5));
    p.set('z', s.viewport.zoom.toFixed(2));
  }
  return `/explore?${p}`;
}
export const initialExploreState: ExploreState = {
  scope: 'cemetery',
  q: '',
  theme: 'all',
  person: null,
  place: null,
  embed: false,
  viewport: null,
};
