'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapInstance, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LoaderCircle, MapPin, Search, X } from 'lucide-react';
import { cemeteryArea, cemeteryCenter } from '@/lib/cemetery-area';

export type PickedLocation = {
  /** Longitude first, as the archive stores coordinates. */
  coordinates: [number, number];
  scope: 'cemetery' | 'atlanta';
  /** A display address when the point came from a search result. */
  address?: string;
};
type SearchHit = { label: string; coordinates: [number, number] };

const ring = cemeteryArea.geometry.coordinates[0]!;
/** Ray casting over the mapped cemetery outline: inside means the point is a cemetery place. */
export function scopeFor([lng, lat]: [number, number]): PickedLocation['scope'] {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]! as [number, number];
    const [xj, yj] = ring[j]! as [number, number];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside ? 'cemetery' : 'atlanta';
}
const views = {
  cemetery: { center: cemeteryCenter, zoom: 15.6 },
  atlanta: { center: [-84.3942, 33.7535] as [number, number], zoom: 11.6 },
};
// Metropolitan Atlanta, the same box the archive accepts for places.
const atlantaBox = '-84.65,33.95,-84.1,33.5';

/**
 * A small map where a contributor marks one point: tap or click to place it, drag to adjust,
 * or search an address. The cemetery outline decides whether it is a cemetery or an Atlanta place.
 */
export function LocationPicker({
  value,
  onChange,
  label = 'Mark it on the map',
  hint = 'Tap the map to drop a pin, drag it to adjust, or search an address. Reviewers confirm positions before they are published.',
}: {
  value: PickedLocation | null;
  onChange: (value: PickedLocation | null) => void;
  label?: string;
  hint?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    if (!container.current) return;
    let map: MapInstance | undefined;
    try {
      maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
      const start = value ? { center: value.coordinates, zoom: 16 } : views.cemetery;
      map = new maplibregl.Map({
        container: container.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
        center: start.center,
        zoom: start.zoom,
        minZoom: 9,
        maxZoom: 19,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
        renderWorldCopies: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', () => setFailed(true));
      map.on('load', () => {
        if (!map) return;
        setFailed(false);
        map.addSource('picker-area', { type: 'geojson', data: cemeteryArea });
        map.addLayer({
          id: 'picker-fill',
          type: 'fill',
          source: 'picker-area',
          paint: { 'fill-color': '#743444', 'fill-opacity': 0.12 },
        });
        map.addLayer({
          id: 'picker-outline',
          type: 'line',
          source: 'picker-area',
          paint: { 'line-color': '#743444', 'line-width': 2, 'line-opacity': 0.8 },
        });
      });
      map.on('click', (event) => {
        const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
        latest.current({ coordinates: point, scope: scopeFor(point) });
      });
    } catch {
      setFailed(true);
    }
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; later values only move the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = new maplibregl.Marker({ draggable: true, color: '#743444' })
        .setLngLat(value.coordinates)
        .addTo(map);
      marker.on('dragend', () => {
        const at = marker.getLngLat();
        const point: [number, number] = [at.lng, at.lat];
        latest.current({ coordinates: point, scope: scopeFor(point) });
      });
      markerRef.current = marker;
    } else markerRef.current.setLngLat(value.coordinates);
    const [lng, lat] = value.coordinates;
    if (!map.getBounds().contains([lng, lat]))
      map.easeTo({ center: value.coordinates, duration: 400 });
  }, [value]);

  function jump(scope: keyof typeof views) {
    mapRef.current?.easeTo({ ...views[scope], duration: 500 });
  }
  async function search() {
    const text = query.trim();
    if (!text || searching) return;
    setSearching(true);
    setSearchError('');
    setHits([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&viewbox=${atlantaBox}&bounded=1&q=${encodeURIComponent(text)}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error();
      const results = (await response.json()) as {
        display_name: string;
        lon: string;
        lat: string;
      }[];
      const found = results
        .map((item) => ({
          label: item.display_name,
          coordinates: [Number(item.lon), Number(item.lat)] as [number, number],
        }))
        .filter(
          (hit) => Number.isFinite(hit.coordinates[0]) && Number.isFinite(hit.coordinates[1]),
        );
      if (!found.length)
        setSearchError(
          'No address matched in the Atlanta area. Try a street name, or tap the map.',
        );
      setHits(found);
    } catch {
      setSearchError('Address search is unavailable right now. You can still tap the map.');
    } finally {
      setSearching(false);
    }
  }
  function choose(hit: SearchHit) {
    setHits([]);
    onChange({
      coordinates: hit.coordinates,
      scope: scopeFor(hit.coordinates),
      address: hit.label,
    });
    mapRef.current?.easeTo({ center: hit.coordinates, zoom: 16, duration: 500 });
  }

  return (
    <div className="location-picker">
      <span className="location-picker-label">
        {label} <span className="community-hint">(optional)</span>
      </span>
      <div className="location-picker-search" role="search">
        <input
          type="search"
          value={query}
          placeholder="Search an Atlanta address or landmark…"
          aria-label="Search an address"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
        />
        <button
          type="button"
          className="community-secondary"
          onClick={() => void search()}
          disabled={searching}
        >
          {searching ? (
            <LoaderCircle size={16} className="community-spinner" aria-hidden="true" />
          ) : (
            <Search size={16} aria-hidden="true" />
          )}
          Search
        </button>
      </div>
      {searchError && <small className="community-field-error">{searchError}</small>}
      {hits.length > 0 && (
        <ul className="location-picker-hits">
          {hits.map((hit) => (
            <li key={hit.label}>
              <button type="button" onClick={() => choose(hit)}>
                <MapPin size={14} aria-hidden="true" /> {hit.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className="location-picker-map"
        ref={container}
        aria-label="Map for choosing a position"
      />
      {failed && (
        <small className="community-field-error">
          The map could not load. You can still describe the place; reviewers will position it.
        </small>
      )}
      <div className="location-picker-tools">
        <button type="button" className="community-text-button" onClick={() => jump('cemetery')}>
          South-View Cemetery
        </button>
        <button type="button" className="community-text-button" onClick={() => jump('atlanta')}>
          Atlanta
        </button>
        {value && (
          <button type="button" className="community-text-button" onClick={() => onChange(null)}>
            <X size={14} aria-hidden="true" /> Clear pin
          </button>
        )}
      </div>
      <small className="location-picker-status" aria-live="polite">
        {value
          ? `Pin placed · ${value.scope === 'cemetery' ? 'inside South-View Cemetery' : 'Atlanta'} · ${value.coordinates[1].toFixed(5)}, ${value.coordinates[0].toFixed(5)}${value.address ? ` · ${value.address}` : ''}`
          : hint}
      </small>
    </div>
  );
}
