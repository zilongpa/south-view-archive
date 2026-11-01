'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapInstance, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Compass, LocateFixed, MapPin, Minus, Plus, RefreshCw } from 'lucide-react';
import type { Person, PersonPlace, Place, Scope } from '@southview/validators';
import type { Viewport } from '@/lib/explore-state';
import { createMarkerHoverController, type PreviewTarget } from '@/lib/explore-preview';
import { cemeteryArea, cemeteryCenter, mapPadding, overviewBounds } from '@/lib/cemetery-area';

type Props = {
  places: Place[];
  people: Person[];
  relations: PersonPlace[];
  scope: Scope;
  selectedPlaceId: string | null;
  selectedPersonId: string | null;
  viewport: Viewport | null;
  resetEpoch: number;
  focusSelection: boolean;
  resultsOpen: boolean;
  onSelect: (personId: string, placeId: string) => void;
  onPreview: (target: PreviewTarget | null) => void;
  onViewport: (v: Viewport, autoScope: boolean) => void;
  onFailure: () => void;
  onReturnToCemetery: () => void;
};
export const mapDefaults = {
  cemetery: { center: cemeteryCenter, zoom: 15.4 },
  atlanta: { center: [-84.3942, 33.7535] as [number, number], zoom: 12.65 },
};

export default function ArchiveMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const cameraInitialized = useRef(false);
  const current = useRef(props);
  current.current = props;
  const markerHover = useMemo(
    () => createMarkerHoverController<PreviewTarget>((target) => current.current.onPreview(target)),
    [],
  );
  const markerRefs = useRef(new Map<string, { marker: Marker; element: HTMLButtonElement }>());
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tileWarning, setTileWarning] = useState(false);
  const refreshMarkers = useRef<() => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    let map: MapInstance | undefined;
    let disposed = false;
    let didLoad = false;
    let tileErrors = 0;
    let hoverFrame = 0;
    const clearHover = () => markerHover.clear();
    const dismissHover = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearHover();
    };
    window.addEventListener('blur', clearHover);
    window.addEventListener('keydown', dismissHover);
    cameraInitialized.current = false;
    setError(false);
    setReady(false);
    setTileWarning(false);
    const fail = () => {
      if (!disposed) {
        setError(true);
        current.current.onFailure();
      }
    };
    try {
      maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
      const v = current.current.viewport,
        def = mapDefaults[current.current.scope];
      map = new maplibregl.Map({
        container: container.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
        center: v ? [v.lng, v.lat] : def.center,
        zoom: v?.zoom ?? def.zoom,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
        cooperativeGestures: container.current.closest('.is-embedded') !== null,
        renderWorldCopies: false,
      });
      mapRef.current = map;
      map.addControl(
        new maplibregl.AttributionControl({
          compact: false,
          customAttribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || undefined,
        }),
        'bottom-right',
      );
      map.on('error', () => {
        tileErrors++;
        if (!disposed && tileErrors >= 1) setTileWarning(true);
      });
      map.on('load', () => {
        if (disposed || !map) return;
        didLoad = true;
        map.addSource('south-view-area', {
          type: 'geojson',
          data: cemeteryArea,
          attribution:
            '<a href="https://www.openstreetmap.org/way/34773826" target="_blank" rel="noreferrer">Cemetery outline © OpenStreetMap</a>',
        });
        map.addLayer({
          id: 'south-view-fill',
          type: 'fill',
          source: 'south-view-area',
          paint: { 'fill-color': '#743444', 'fill-opacity': 0.14 },
        });
        map.addLayer({
          id: 'south-view-halo',
          type: 'line',
          source: 'south-view-area',
          paint: { 'line-color': '#743444', 'line-width': 9, 'line-blur': 4, 'line-opacity': 0.18 },
        });
        map.addLayer({
          id: 'south-view-outline',
          type: 'line',
          source: 'south-view-area',
          paint: { 'line-color': '#743444', 'line-width': 2, 'line-opacity': 0.8 },
        });
        map.addSource('south-view-label', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: cemeteryCenter },
          },
        });
        map.addLayer({
          id: 'south-view-label',
          type: 'symbol',
          source: 'south-view-label',
          minzoom: 8,
          layout: {
            'text-field': 'South-View Cemetery',
            'text-font': [process.env.NEXT_PUBLIC_MAP_FONT || 'Noto Sans Regular'],
            'text-size': 13,
            'text-anchor': 'center',
            'text-allow-overlap': false,
          },
          paint: { 'text-color': '#652b3a', 'text-halo-color': '#fffcf6', 'text-halo-width': 2 },
        });
        map.addSource('archive-places', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 50,
        });
        map.addLayer({
          id: 'archive-points',
          type: 'circle',
          source: 'archive-places',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#743444',
            'circle-stroke-color': '#fffcf6',
            'circle-stroke-width': 2,
          },
        });
        map.addLayer({
          id: 'archive-clusters',
          type: 'circle',
          source: 'archive-places',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#722d3c',
            'circle-radius': 22,
            'circle-stroke-width': 4,
            'circle-stroke-color': '#fcf8ef',
          },
        });
        map.addLayer({
          id: 'archive-cluster-count',
          type: 'symbol',
          source: 'archive-places',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': [process.env.NEXT_PUBLIC_MAP_FONT || 'Noto Sans Regular'],
            'text-size': 14,
          },
          paint: { 'text-color': '#fffaf1' },
        });
        map.on('click', 'archive-clusters', async (event) => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== 'Point' || !map) return;
          try {
            const zoom = await (
              map.getSource('archive-places') as GeoJSONSource
            ).getClusterExpansionZoom(Number(feature.properties?.cluster_id));
            if (!disposed)
              map.easeTo(
                {
                  center: feature.geometry.coordinates as [number, number],
                  zoom,
                  duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500,
                },
                { autoScope: true },
              );
          } catch {
            /* A source refresh can invalidate a cluster; the next click uses current data. */
          }
        });
        map.on('mouseenter', 'archive-clusters', () => {
          if (map) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'archive-clusters', () => {
          if (map) map.getCanvas().style.cursor = '';
        });
        setReady(true);
      });
      map.on('moveend', (event) => {
        // Wait for marker transforms and pointer hit testing to reach the final frame.
        cancelAnimationFrame(hoverFrame);
        hoverFrame = requestAnimationFrame(() => {
          if (!disposed && map && !map.isMoving())
            markerHover.endMove(
              ({ anchor }) => document.hasFocus() && anchor.isConnected && anchor.matches(':hover'),
            );
        });
        // ResizeObserver may fire before the first fitted view. Do not save that provisional camera.
        if (!map || disposed || !cameraInitialized.current) return;
        const c = map.getCenter();
        current.current.onViewport(
          { lng: c.lng, lat: c.lat, zoom: map.getZoom() },
          Boolean(event.originalEvent || ('autoScope' in event && event.autoScope)),
        );
        refreshMarkers.current();
      });
      map.on('movestart', () => markerHover.startMove());
      map.on('sourcedata', (event) => {
        if (event.sourceId === 'archive-places' && event.isSourceLoaded) refreshMarkers.current();
      });
      const canvas = map.getCanvas();
      canvas.setAttribute(
        'aria-label',
        'Interactive history map. Use Browse people to access all records without using the map.',
      );
      canvas.addEventListener('webglcontextlost', fail);
    } catch {
      fail();
    }
    const observer = new ResizeObserver(() => map?.resize());
    observer.observe(container.current);
    const timeout = window.setTimeout(() => {
      if (!disposed && map && !didLoad) fail();
    }, 14000);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timeout);
      cancelAnimationFrame(hoverFrame);
      markerHover.clear();
      window.removeEventListener('blur', clearHover);
      window.removeEventListener('keydown', dismissHover);
      markerRefs.current.forEach((m) => m.marker.remove());
      markerRefs.current.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, [retry, markerHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('archive-places') as GeoJSONSource;
    source.setData({
      type: 'FeatureCollection',
      features: props.places
        .filter((p) => p.coordinates)
        .map((p) => ({
          type: 'Feature' as const,
          id: p.id,
          geometry: { type: 'Point' as const, coordinates: p.coordinates! },
          properties: { placeId: p.id },
        })),
    });
  }, [ready, props.places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const render = () => {
      if (!mapRef.current || !map.getSource('archive-places')) return;
      const unclustered = new Set(
        map
          .querySourceFeatures('archive-places', { filter: ['!', ['has', 'point_count']] })
          .map((f) => String(f.properties?.placeId)),
      );
      const visiblePlaces = current.current.places.filter(
        (p) => p.coordinates && unclustered.has(p.id),
      );
      const visibleIds = new Set(visiblePlaces.map((p) => p.id));
      markerRefs.current.forEach((entry, id) => {
        if (!visibleIds.has(id)) {
          markerHover.leave(entry.element);
          entry.marker.remove();
          markerRefs.current.delete(id);
        }
      });
      visiblePlaces.forEach((place) => {
        const personIds = current.current.relations
          .filter((r) => r.placeId === place.id)
          .map((r) => r.personId);
        const personId = personIds.includes(current.current.selectedPersonId ?? '')
          ? current.current.selectedPersonId!
          : personIds[0];
        const person = current.current.people.find((p) => p.id === personId);
        if (!person) return;
        const previous = markerRefs.current.get(place.id);
        const el = previous?.element ?? document.createElement('button');
        el.type = 'button';
        el.dataset.placeId = place.id;
        el.classList.add('map-marker');
        // Grave markers and related city places use different colours and core shapes.
        el.classList.toggle('is-cemetery', place.scope === 'cemetery');
        el.classList.toggle('is-atlanta', place.scope !== 'cemetery');
        el.classList.toggle('is-selected', current.current.selectedPlaceId === place.id);
        const names = personIds
          .map((id) => current.current.people.find((p) => p.id === id)?.name)
          .filter((name): name is string => !!name);
        el.setAttribute(
          'aria-label',
          `${place.name}. ${place.scope === 'cemetery' ? 'Grave marker' : 'Related place'}${names.length ? ` of ${names.join(', ')}` : ''}. ${place.precision === 'reference' ? 'Reference location.' : ''}`.trim(),
        );
        el.setAttribute('aria-pressed', String(current.current.selectedPlaceId === place.id));
        // Fixed geometry: the SVG's bottom tip is the Marker's bottom-centre anchor.
        // Labels are absolute, so selecting a place cannot change the marker's dimensions.
        if (!previous) {
          // Preserve the hit target and SVG across selection updates, including
          // updates triggered by the pointer currently resting on this marker.
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 32 42');
          svg.setAttribute('class', 'marker-pin');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('focusable', 'false');
          const pin = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pin.setAttribute('class', 'marker-pin-body');
          pin.setAttribute('d', 'M16 42C14 37 1 25 1 16A15 15 0 0 1 31 16C31 25 18 37 16 42Z');
          const core =
            place.scope === 'cemetery'
              ? document.createElementNS('http://www.w3.org/2000/svg', 'circle')
              : document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          core.setAttribute('class', 'marker-pin-core');
          if (place.scope === 'cemetery') {
            core.setAttribute('cx', '16');
            core.setAttribute('cy', '16');
            core.setAttribute('r', '5');
          } else {
            core.setAttribute('x', '11.5');
            core.setAttribute('y', '11.5');
            core.setAttribute('width', '9');
            core.setAttribute('height', '9');
            core.setAttribute('transform', 'rotate(45 16 16)');
          }
          svg.append(pin, core);
          el.append(svg);
          const label = document.createElement('span');
          label.className = 'marker-label';
          el.append(label);
        }
        const label = el.querySelector<HTMLElement>('.marker-label')!;
        label.textContent = place.name;
        label.hidden = current.current.selectedPlaceId !== place.id;
        el.onclick = () => current.current.onSelect(person.id, place.id);
        el.onpointerenter = (event) => {
          if (event.pointerType !== 'touch')
            markerHover.enter({
              personId: person.id,
              placeId: place.id,
              anchor: el,
              input: 'pointer',
            });
        };
        el.onpointerleave = () => markerHover.leave(el);
        el.onfocus = () => {
          if (el.matches(':focus-visible')) {
            markerHover.clear();
            current.current.onPreview({
              personId: person.id,
              placeId: place.id,
              anchor: el,
              input: 'keyboard',
            });
          }
        };
        el.onblur = () => current.current.onPreview(null);
        if (!previous)
          markerRefs.current.set(place.id, {
            element: el,
            marker: new maplibregl.Marker({
              element: el,
              anchor: 'bottom',
              offset: [0, 0],
              subpixelPositioning: true,
            })
              .setLngLat(place.coordinates!)
              .addTo(map),
          });
        else previous.marker.setLngLat(place.coordinates!);
      });
    };
    refreshMarkers.current = render;
    render();
  }, [
    ready,
    props.places,
    props.relations,
    props.people,
    props.selectedPlaceId,
    props.selectedPersonId,
    markerHover,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const value = current.current;
    const v = value.viewport;
    const size = map.getContainer();
    const padding = mapPadding(
      size.clientWidth,
      size.clientHeight,
      !!value.selectedPersonId,
      value.resultsOpen,
    );
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550;
    cameraInitialized.current = true;
    if (v) {
      map.jumpTo({
        center: [v.lng, v.lat],
        zoom: v.zoom,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } else {
      const place =
        value.focusSelection && value.places.find((p) => p.id === value.selectedPlaceId);
      if (place && place.coordinates) {
        // An offset shifts the camera, not the marker; URL coordinates still describe the true centre.
        map.easeTo({
          center: place.coordinates,
          zoom: place.scope === 'cemetery' ? 17 : 15,
          offset: [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2],
          duration,
        });
      } else {
        const camera = map.cameraForBounds(overviewBounds(value.places, value.scope), {
          padding,
          maxZoom: value.scope === 'cemetery' ? 16 : 13,
        });
        if (camera)
          map.easeTo({ ...camera, padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration });
      }
    }
    // Only explicit navigation requests move the camera. Automatic scope changes keep the user's view.
  }, [ready, props.resetEpoch]);

  return (
    <div className="map-surface" aria-label="Map of connected places">
      <div className="map-canvas" ref={container} />
      {!ready && !error && (
        <div className="map-loading" role="status">
          <Compass size={26} />
          <span>Opening the map…</span>
        </div>
      )}
      {error && (
        <div className="map-error">
          <MapPin size={30} />
          <h3>The stories are still here.</h3>
          <p>
            This browser couldn’t display the map. You can explore every record in the people list.
          </p>
          <button className="archive-button" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={16} /> Retry map
          </button>
        </div>
      )}
      {tileWarning && !error && (
        <div className="map-warning" role="status">
          The basemap is having trouble loading. All records remain available in the list.
          <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </div>
      )}
      <div className="map-controls">
        <button
          onClick={() => mapRef.current?.zoomIn({}, { autoScope: true })}
          aria-label="Zoom in"
        >
          <Plus size={19} />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut({}, { autoScope: true })}
          aria-label="Zoom out"
        >
          <Minus size={19} />
        </button>
      </div>
      <div className="map-north" aria-hidden="true">
        <Compass size={28} strokeWidth={1} />
        <span>N</span>
      </div>
      <button
        className="map-home"
        onClick={props.onReturnToCemetery}
        aria-label="Return to South-View Cemetery"
        title="Return to South-View Cemetery"
      >
        <LocateFixed size={18} aria-hidden="true" /> South-View
      </button>
      <div className="map-caption" aria-label="Map legend">
        <span>
          <span className="legend-pin legend-pin-grave" aria-hidden="true" /> Grave marker
        </span>
        <span>
          <span className="legend-pin legend-pin-place" aria-hidden="true" /> Related place
        </span>
        <span>
          <span className="cemetery-key" aria-hidden="true" />{' '}
          <a
            href={cemeteryArea.properties.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title="Approximate cemetery outline from OpenStreetMap; not a surveyed property boundary."
          >
            South-View area
          </a>
        </span>
      </div>
    </div>
  );
}
