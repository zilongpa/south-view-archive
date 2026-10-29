'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Headphones,
  List,
  Map as MapIcon,
  MapPin,
  Search,
  SlidersHorizontal,
  Sprout,
  X,
} from 'lucide-react';
import './explorer-map.css';
import { ProvidedBy } from './provided-by';
import { SiteNavigation } from './site-navigation';
import { MapPreview } from './map-preview';
import {
  searchArchive,
  scopeIncludesPlace,
  type ArchiveData,
  type Person,
  type Scope,
} from '@southview/validators';
import { viewportState } from '@/lib/map-scope';
import { displayPersonName } from '@/lib/person-name';
import { copy } from '@/lib/copy';
import {
  createPreviewController,
  previewSelection,
  type PreviewTarget,
} from '@/lib/explore-preview';
import {
  initialExploreState,
  parseExploreState,
  serializeExploreState,
  type ExploreState,
  type Viewport,
} from '@/lib/explore-state';
const ArchiveMap = dynamic(() => import('./archive-map'), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <MapIcon size={24} />
      <span>Opening the map…</span>
    </div>
  ),
});

function Monogram({ person, large = false }: { person: Person; large?: boolean }) {
  if (person.portrait)
    return (
      <img
        className={`person-image ${large ? 'large' : ''}`}
        src={person.portrait.url}
        alt={person.portrait.alt}
      />
    );
  return (
    <div className={`person-monogram ${large ? 'large' : ''}`} aria-hidden="true">
      <span>
        {person.name
          .split(' ')
          .filter((s) => !/^(Sr\.|Jr\.)$/.test(s))
          .filter((_, i, words) => i === 0 || i === words.length - 1)
          .map((s) => s[0])
          .join('')}
      </span>
      <Sprout size={large ? 40 : 24} strokeWidth={0.7} />
    </div>
  );
}

export function Explorer({ archive }: { archive: ArchiveData }) {
  const [state, setState] = useState<ExploreState>(initialExploreState);
  const [initialized, setInitialized] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [focusSelection, setFocusSelection] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [resetEpoch, setResetEpoch] = useState(0);
  const [copied, setCopied] = useState(false);
  const [alphabetical, setAlphabetical] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const liveState = useRef(state);
  liveState.current = state;
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const load = () => {
      const restored = parseExploreState(window.location.search);
      setState(restored);
      setShowResults(!!restored.q || restored.theme !== 'all');
      setFocusSelection(!!restored.person);
      setInitialized(true);
      setResetEpoch((n) => n + 1);
    };
    load();
    window.addEventListener('popstate', load);
    return () => {
      window.removeEventListener('popstate', load);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  const update = useCallback((patch: Partial<ExploreState>, push = false) => {
    // A final map move event can arrive while Next is transitioning to a record.
    if (window.location.pathname !== '/explore') return;
    const next = { ...liveState.current, ...patch };
    liveState.current = next;
    setState(next);
    const url = serializeExploreState(next);
    if (url !== window.location.pathname + window.location.search)
      window.history[push ? 'pushState' : 'replaceState'](null, '', url);
  }, []);
  const previewController = useMemo(
    () =>
      createPreviewController<PreviewTarget>((target) => {
        if (!target) {
          setPreviewTarget(null);
          return;
        }
        if (!target.anchor.isConnected) return;
        const selection = previewSelection(archive, liveState.current.scope, target);
        if (!selection) return;
        if (archive.people.some((person) => person.id === liveState.current.person)) {
          // Hover immediately changes the open record, but never moves the camera, steals focus,
          // or adds browser history entries. Keep it readable after leaving the pin.
          triggerRef.current = target.anchor;
          if (
            liveState.current.person !== selection.person ||
            liveState.current.place !== selection.place
          )
            update(selection);
          setPreviewTarget(null);
        } else {
          setPreviewTarget({ ...target, placeId: selection.place ?? undefined });
        }
      }),
    [archive, update],
  );
  const onPreview = useCallback(
    (target: PreviewTarget | null) => {
      if (!target) {
        previewController.clear();
        return;
      }
      // Touch-generated mouse/focus events must not change the bottom sheet.
      if (
        target.input === 'pointer' &&
        !window.matchMedia('(min-width: 761px) and (any-hover: hover) and (any-pointer: fine)')
          .matches
      )
        return;
      previewController.show(target, target.input === 'keyboard' || !!liveState.current.person);
    },
    [previewController],
  );
  useEffect(() => {
    const clear = () => previewController.clear();
    window.addEventListener('resize', clear);
    window.addEventListener('popstate', clear);
    window.addEventListener('blur', clear);
    return () => {
      previewController.cancel();
      window.removeEventListener('resize', clear);
      window.removeEventListener('popstate', clear);
      window.removeEventListener('blur', clear);
    };
  }, [previewController]);
  useEffect(() => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    setCopied(false);
  }, [state.person, state.place]);
  const results = useMemo(
    () => searchArchive(archive, { q: state.q, theme: state.theme, scope: state.scope }),
    [archive, state.q, state.theme, state.scope],
  );
  const people = useMemo(
    () =>
      alphabetical
        ? [...results.people].sort((a, b) => a.name.localeCompare(b.name))
        : results.people,
    [results.people, alphabetical],
  );
  const themes = useMemo(
    () => [...new Set(archive.people.flatMap((p) => p.themes))].sort(),
    [archive],
  );
  const selected = archive.people.find((p) => p.id === state.person);
  const selectedRelations = selected
    ? archive.relations
        .filter(
          (r) =>
            r.personId === selected.id &&
            archive.places.some(
              (p) => p.id === r.placeId && scopeIncludesPlace(state.scope, p.scope),
            ),
        )
        .sort((a, b) => Number(b.placeId === state.place) - Number(a.placeId === state.place))
    : [];
  const selectedPlace = archive.places.find(
    (p) =>
      p.id === (state.place ?? selectedRelations[0]?.placeId) &&
      selectedRelations.some((r) => r.placeId === p.id),
  );
  const materials = selected
    ? archive.materials.filter(
        (m) => m.personId === selected.id || m.relatedPersonIds.includes(selected.id),
      )
    : [];
  const preview = archive.people.find((p) => p.id === previewTarget?.personId);
  const selectPerson = useCallback(
    (personId: string, placeId?: string) => {
      const selection = previewSelection(archive, liveState.current.scope, { personId, placeId });
      if (!selection) return;
      previewController.clear();
      triggerRef.current = document.activeElement as HTMLElement;
      update({ ...selection, viewport: null }, true);
      setResetEpoch((n) => n + 1);
      setFocusSelection(true);
      if (window.matchMedia('(max-width: 760px)').matches) setShowResults(false);
      requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
    },
    [archive, update, previewController],
  );
  const closeDetail = useCallback(() => {
    previewController.clear();
    update({ person: null, place: null }, true);
    requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
      else document.getElementById('archive-search')?.focus();
      previewController.clear();
    });
  }, [update, previewController]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (liveState.current.person) closeDetail();
        else previewController.clear();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [closeDetail, previewController]);
  const changeScope = (scope: Scope) => {
    previewController.clear();
    setFocusSelection(false);
    const available = archive.relations.filter(
      (r) =>
        r.personId === state.person &&
        archive.places.some((p) => p.id === r.placeId && scopeIncludesPlace(scope, p.scope)),
    );
    const rel =
      available.find((r) => archive.places.some((p) => p.id === r.placeId && p.scope === scope)) ??
      available[0];
    update({ scope, viewport: null, place: rel?.placeId ?? null }, true);
    setResetEpoch((n) => n + 1);
  };
  const onViewport = useCallback(
    (viewport: Viewport, autoScope: boolean) => {
      update(viewportState(liveState.current, viewport, autoScope, archive));
    },
    [archive, update],
  );
  const detailHref = selected
    ? `/people/${selected.id}?from=${encodeURIComponent(serializeExploreState(state))}`
    : '';
  async function copyLink(kind: 'map' | 'person') {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const url = new URL(
      kind === 'person' && selected ? `/people/${selected.id}` : serializeExploreState(state, true),
      origin,
    ).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this permanent link:', url);
    }
  }
  return (
    <div
      className={`explorer map-explorer ${state.embed ? 'is-embedded' : ''} ${showResults ? 'results-open' : ''} ${selected ? 'has-selection' : ''}`}
    >
      <SiteNavigation
        overlay
        embed={state.embed}
        personId={selected?.id}
        standaloneHref={serializeExploreState(state, true)}
      >
        <button
          onClick={() => copyLink('map')}
          aria-label={copied ? 'Map link copied' : 'Copy map link'}
          title={copied ? 'Link copied' : 'Share map'}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </SiteNavigation>
      <main id="main-content" tabIndex={-1}>
        <h1 className="sr-only">Explore South-View and Atlanta</h1>
        <section className="atlas" aria-label="Explore the collection">
          <div className={`atlas-body ${selected ? 'has-selection' : ''}`}>
            <aside className="people-sidebar" aria-label="Search and browse people">
              <div className="search-controls">
                <label className="search-box" htmlFor="archive-search">
                  <Search size={19} strokeWidth={1.6} />
                  <input
                    id="archive-search"
                    type="search"
                    placeholder="Search the archive"
                    aria-label="Search people, places, or stories"
                    value={state.q}
                    onChange={(e) => {
                      previewController.clear();
                      update({ q: e.target.value, person: null, place: null });
                      setShowResults(true);
                    }}
                  />
                </label>
                <button
                  className="browse-people-toggle"
                  aria-label={showResults ? 'Hide people list' : 'Browse people'}
                  aria-expanded={showResults}
                  aria-controls="people-results-panel"
                  onClick={() => {
                    if (!showResults && window.matchMedia('(max-width: 760px)').matches) {
                      update({ person: null, place: null });
                    }
                    setShowResults((value) => !value);
                    previewController.clear();
                  }}
                >
                  {showResults ? (
                    <X size={17} aria-hidden="true" />
                  ) : (
                    <List size={17} aria-hidden="true" />
                  )}
                  <span className="browse-people-label">People</span>
                  <span className="people-count">{people.length}</span>
                </button>
              </div>
              {showResults && (
                <div id="people-results-panel" className="browse-results">
                  <div className="browse-filters">
                    <div className="filter-row">
                      <label className="theme-filter">
                        <SlidersHorizontal size={15} />
                        <span className="sr-only">Filter by theme</span>
                        <select
                          value={state.theme}
                          onChange={(e) => {
                            previewController.clear();
                            update({ theme: e.target.value, person: null, place: null });
                          }}
                        >
                          <option value="all">All themes</option>
                          {themes.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="sort-button"
                        aria-label={
                          alphabetical ? 'Use collection order' : 'Sort names alphabetically'
                        }
                        aria-pressed={alphabetical}
                        onClick={() => setAlphabetical((v) => !v)}
                      >
                        <ArrowDownUp size={15} />
                        <span>{alphabetical ? 'A–Z' : 'Sort'}</span>
                      </button>
                    </div>
                  </div>
                  <div className="collection-heading">
                    <h2>The collection</h2>
                    <span aria-live="polite">
                      {people.length} {people.length === 1 ? 'life' : 'lives'}
                    </span>
                  </div>
                  <div className="people-results" onScroll={() => onPreview(null)}>
                    {people.length === 0 ? (
                      <div className="no-results">
                        <Search size={26} />
                        <h3>No matching stories yet.</h3>
                        <p>Try another name or explore all themes.</p>
                        <button onClick={() => update({ q: '', theme: 'all' })}>
                          Clear search and filters <ArrowRight size={15} />
                        </button>
                      </div>
                    ) : (
                      <ol className="people-list">
                        {people.map((person, index) => {
                          const rels = results.relations.filter((r) => r.personId === person.id),
                            mapped = rels.some(
                              (r) => results.places.find((p) => p.id === r.placeId)?.coordinates,
                            );
                          return (
                            <li key={person.id}>
                              <button
                                className={`person-card ${person.id === state.person ? 'selected' : ''}`}
                                onClick={() => selectPerson(person.id)}
                                onPointerEnter={(event) => {
                                  if (event.pointerType !== 'touch')
                                    onPreview({
                                      personId: person.id,
                                      anchor: event.currentTarget,
                                      input: 'pointer',
                                    });
                                }}
                                onPointerLeave={() => onPreview(null)}
                                onFocus={(event) => {
                                  if (event.currentTarget.matches(':focus-visible'))
                                    onPreview({
                                      personId: person.id,
                                      anchor: event.currentTarget,
                                      input: 'keyboard',
                                    });
                                }}
                                onBlur={() => onPreview(null)}
                                aria-pressed={person.id === state.person}
                              >
                                <div className="person-card-top">
                                  <Monogram person={person} />
                                  <div>
                                    <span className="person-number">
                                      {String(index + 1).padStart(2, '0')}
                                      <span className="card-hairline" />
                                    </span>
                                    <h3>{displayPersonName(person.name)}</h3>
                                    <p className="person-years">
                                      {person.birthYear
                                        ? `${person.birthYear} — ${person.deathYear ?? ''}`
                                        : person.deathYear
                                          ? `Remembered · ${person.deathYear}`
                                          : 'A life remembered'}
                                    </p>
                                  </div>
                                  <ChevronRight size={16} className="card-arrow" />
                                </div>
                                <p className="card-summary">{person.summary}</p>
                                <div className="card-meta">
                                  <span className="theme-label">{person.themes[0]}</span>
                                  <span>
                                    <MapPin size={12} />
                                    {mapped
                                      ? `${rels.filter((r) => results.places.find((p) => p.id === r.placeId)?.coordinates).length} ${rels.length === 1 ? 'place' : 'places'}`
                                      : 'Not yet mapped'}
                                  </span>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </div>
              )}
            </aside>
            <div className="map-column">
              {initialized && (
                <ArchiveMap
                  places={results.places}
                  people={people}
                  relations={results.relations}
                  scope={state.scope}
                  selectedPlaceId={selectedPlace?.id ?? null}
                  selectedPersonId={selected?.id ?? null}
                  viewport={state.viewport}
                  resetEpoch={resetEpoch}
                  focusSelection={focusSelection}
                  onSelect={selectPerson}
                  onPreview={onPreview}
                  onViewport={onViewport}
                  onFailure={() => setShowResults(true)}
                  resultsOpen={showResults}
                  onReturnToCemetery={() => changeScope('cemetery')}
                />
              )}
              {!initialized && (
                <div className="map-loading">
                  <MapIcon />
                  <span>Opening the map…</span>
                </div>
              )}
              {preview && previewTarget && !selected && (
                <MapPreview
                  target={previewTarget}
                  person={preview}
                  place={archive.places.find((place) => place.id === previewTarget.placeId)}
                />
              )}
              {selected && (
                <aside
                  ref={detailRef}
                  className="detail-panel"
                  tabIndex={-1}
                  aria-label={`${selected.name} preview`}
                >
                  <div className="detail-top">
                    <span className="eyebrow">FROM THE COLLECTION</span>
                    <button onClick={closeDetail} aria-label="Close person preview">
                      <X size={19} />
                    </button>
                  </div>
                  <div className="detail-scroll" ref={detailScrollRef}>
                    <div className="detail-person">
                      <Monogram person={selected} large />
                      <div className="detail-identity">
                        <span className="theme-label">{selected.themes.join(' · ')}</span>
                        <h2>{displayPersonName(selected.name)}</h2>
                        {(selected.birthYear || selected.deathYear) && (
                          <p className="person-years">
                            {selected.birthYear
                              ? `${selected.birthYear} — ${selected.deathYear ?? ''}`
                              : `Remembered · ${selected.deathYear}`}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="detail-summary">{selected.summary}</p>
                    <ProvidedBy
                      creditIds={selected.creditIds}
                      title={`${selected.name}: overview`}
                      data={archive}
                    />
                    <div className="detail-citation-links">
                      {selected.summaryCitations.map((c) => {
                        const source = archive.sources.find((s) => s.id === c.sourceId);
                        return source ? (
                          <a
                            key={c.sourceId + c.locator}
                            href={`/people/${selected.id}?from=${encodeURIComponent(serializeExploreState(state))}#source-${source.id}`}
                          >
                            <BookOpen size={16} aria-hidden="true" />
                            <span>
                              [{archive.sources.findIndex((s) => s.id === source.id) + 1}]{' '}
                              {source.publisher}
                              {c.locator ? ` · ${c.locator}` : ''}
                            </span>
                            <ArrowUpRight size={16} aria-hidden="true" />
                          </a>
                        ) : null;
                      })}
                    </div>
                    <section className="connected-places">
                      <h3>
                        <MapPin size={16} />
                        {state.scope === 'cemetery' ? 'At South-View' : 'Atlanta & South-View'}
                      </h3>
                      {selectedRelations.length === 0 ? (
                        <p className="quiet-note">
                          No location has been documented in this area yet. The full record is still
                          available.
                        </p>
                      ) : (
                        selectedRelations.map((relation) => {
                          const place = archive.places.find((p) => p.id === relation.placeId)!;
                          return (
                            <div
                              className={`connected-place ${place.id === selectedPlace?.id ? 'is-active' : ''}`}
                              key={relation.id}
                            >
                              <span className="eyebrow">{relation.label}</span>
                              <button
                                disabled={!place.coordinates}
                                aria-current={
                                  place.id === selectedPlace?.id ? 'location' : undefined
                                }
                                onClick={() => {
                                  setFocusSelection(true);
                                  update({ place: place.id, viewport: null }, true);
                                  setResetEpoch((n) => n + 1);
                                }}
                              >
                                <strong>{place.name}</strong>
                                <ArrowUpRight size={15} />
                              </button>
                              <p>{place.locationNote}</p>
                              <ProvidedBy
                                creditIds={[
                                  ...new Set([...place.creditIds, ...relation.creditIds]),
                                ]}
                                title={place.name}
                                data={archive}
                              />
                              <div className="place-source-links">
                                <Link
                                  href={`/people/${selected.id}?from=${encodeURIComponent(serializeExploreState(state))}#source-${relation.citations[0]?.sourceId}`}
                                >
                                  Historical connection [
                                  {archive.sources.findIndex(
                                    (s) => s.id === relation.citations[0]?.sourceId,
                                  ) + 1}
                                  ]
                                </Link>
                                {place.coordinateCitations.map((c) => (
                                  <Link
                                    key={c.sourceId}
                                    href={`/people/${selected.id}?from=${encodeURIComponent(serializeExploreState(state))}#source-${c.sourceId}`}
                                  >
                                    Location source [
                                    {archive.sources.findIndex((s) => s.id === c.sourceId) + 1}]
                                  </Link>
                                ))}
                              </div>
                              <span className="precision-badge">
                                {place.precision === 'reference'
                                  ? 'Reference location'
                                  : place.precision === 'address'
                                    ? 'Address-level location'
                                    : place.precision === 'unmapped'
                                      ? 'Location not yet mapped'
                                      : 'Documented location'}
                              </span>
                            </div>
                          );
                        })
                      )}
                      <button
                        className="other-scope"
                        onClick={() =>
                          changeScope(state.scope === 'cemetery' ? 'atlanta' : 'cemetery')
                        }
                      >
                        {state.scope === 'cemetery'
                          ? 'See their life across Atlanta'
                          : 'See their resting place'}
                        <ArrowRight size={15} />
                      </button>
                    </section>
                    {materials.length > 0 && (
                      <section className="detail-materials">
                        <h3>From the archive</h3>
                        {materials.map((m) => (
                          <a
                            className="material-mini"
                            key={m.id}
                            href={archive.sources.find((s) => s.id === m.sourceId)?.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {m.kind === 'oral-history' ? (
                              <Headphones size={21} />
                            ) : (
                              <BookOpen size={21} />
                            )}
                            <span>
                              <small>
                                {m.kind === 'oral-history' ? 'ORAL HISTORY' : 'DOCUMENT'}
                              </small>
                              <strong>{m.title}</strong>
                              <small>
                                {m.creditIds
                                  .map(
                                    (id) =>
                                      archive.credits.find((credit) => credit.id === id)
                                        ?.displayName,
                                  )
                                  .filter(Boolean)
                                  .join(', ')}{' '}
                                — {m.title}
                              </small>
                            </span>
                            <ArrowUpRight size={15} />
                          </a>
                        ))}
                      </section>
                    )}
                  </div>
                  <div className="detail-bottom">
                    <Link
                      className="contribute-record"
                      href={`/people/${selected.id}?edit=1&from=${encodeURIComponent(serializeExploreState(state))}`}
                      target={state.embed ? '_blank' : undefined}
                      rel={state.embed ? 'noopener noreferrer' : undefined}
                    >
                      {copy.addToPage} <ArrowUpRight size={17} />
                    </Link>
                    <p className="quiet-note detail-edit-hint">
                      Memories, photographs, places, and corrections are added on the profile page,
                      right where they belong.
                    </p>
                    <Link
                      className="full-record-link"
                      href={detailHref}
                      target={state.embed ? '_blank' : undefined}
                      rel={state.embed ? 'noopener noreferrer' : undefined}
                    >
                      Read the full record <ArrowRight size={17} />
                      {state.embed && <span className="sr-only"> (opens in a new tab)</span>}
                    </Link>
                    <button className="copy-record" onClick={() => copyLink('person')}>
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? 'Link copied' : 'Copy permanent link'}
                    </button>
                  </div>
                </aside>
              )}
            </div>
          </div>
        </section>
      </main>
      <noscript>
        <div className="map-no-script">
          <p className="no-script-message">
            JavaScript is required for the interactive map. Browse the records directly:
          </p>
          <ul>
            {archive.people.map((p) => (
              <li key={p.id}>
                <a href={`/people/${p.id}`}>{p.name}</a>
              </li>
            ))}
          </ul>
        </div>
      </noscript>
    </div>
  );
}
