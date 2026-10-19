import type { Place, Scope } from '@southview/validators';

// OpenStreetMap way 34773826, version 9 (2025-06-11), retrieved 2026-10-07.
// ODbL / © OpenStreetMap contributors. A mapped outline, not a surveyed property boundary.
export const cemeteryArea = {
  type: 'Feature' as const,
  properties: {
    name: 'South-View Cemetery',
    source: 'OpenStreetMap contributors',
    sourceUrl: 'https://www.openstreetmap.org/way/34773826',
    sourceVersion: 9,
    accessedAt: '2026-10-07',
  },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-84.3657149, 33.7030658],
        [-84.3648002, 33.7024575],
        [-84.3648598, 33.7002339],
        [-84.3674998, 33.7003379],
        [-84.3676084, 33.70002],
        [-84.3701155, 33.7000849],
        [-84.3714829, 33.6987675],
        [-84.3722638, 33.6996468],
        [-84.3727274, 33.700165],
        [-84.3737857, 33.7013592],
        [-84.374149, 33.7017561],
        [-84.3743601, 33.7019566],
        [-84.3745928, 33.7021463],
        [-84.3748203, 33.7022475],
        [-84.3764856, 33.7031372],
        [-84.374307, 33.7049059],
        [-84.3742102, 33.7049176],
        [-84.371738, 33.7027337],
        [-84.3688306, 33.7033488],
        [-84.3688401, 33.7051283],
        [-84.367223, 33.7051318],
        [-84.3669811, 33.7046222],
        [-84.3668413, 33.7043584],
        [-84.366623, 33.7040038],
        [-84.3663967, 33.7037032],
        [-84.366072, 33.7033744],
        [-84.3657149, 33.7030658],
      ],
    ],
  },
};

const ring = cemeteryArea.geometry.coordinates[0]!;
export const cemeteryBounds: [[number, number], [number, number]] = [
  [Math.min(...ring.map(([lng]) => lng!)), Math.min(...ring.map(([, lat]) => lat!))],
  [Math.max(...ring.map(([lng]) => lng!)), Math.max(...ring.map(([, lat]) => lat!))],
];
export const cemeteryCenter: [number, number] = [
  (cemeteryBounds[0][0] + cemeteryBounds[1][0]) / 2,
  (cemeteryBounds[0][1] + cemeteryBounds[1][1]) / 2,
];

/** Explicit overview controls frame both city places and the full cemetery outline. */
export function overviewBounds(
  places: Pick<Place, 'coordinates'>[],
  scope: Scope,
): typeof cemeteryBounds {
  const points =
    scope === 'atlanta'
      ? [
          ...cemeteryBounds,
          ...places.flatMap((place) => (place.coordinates ? [place.coordinates] : [])),
        ]
      : cemeteryBounds;
  return [
    [Math.min(...points.map(([lng]) => lng)), Math.min(...points.map(([, lat]) => lat))],
    [Math.max(...points.map(([lng]) => lng)), Math.max(...points.map(([, lat]) => lat))],
  ];
}

/** Keep destinations visible beside floating panels, including short/phone viewports. */
export function mapPadding(
  width: number,
  height: number,
  detailOpen: boolean,
  resultsOpen: boolean,
) {
  if (width <= 760)
    return {
      top: Math.min(150, height * 0.23),
      bottom: detailOpen ? height * 0.59 : 105,
      left: 30,
      right: 60,
    };
  return {
    top: 150,
    bottom: 70,
    left: resultsOpen ? Math.min(390, width * 0.34) : 70,
    right: detailOpen ? Math.min(410, width * 0.35) : 70,
  };
}
