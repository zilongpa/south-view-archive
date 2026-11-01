type Relation = { personId: string; placeId: string };
type PlaceLike = { id: string; scope: 'cemetery' | 'atlanta' };

/**
 * A grave with a single person is that person's marker: selecting it opens the person, as it
 * always did. Everything else, a family crypt, a church, a city hall, is a shared place that
 * opens as a place and lists everyone connected to it. Returns the sole occupant's id, or null.
 */
export function soleOccupant(
  archive: { places: PlaceLike[]; relations: Relation[] },
  placeId: string | null | undefined,
): string | null {
  if (!placeId) return null;
  const place = archive.places.find((item) => item.id === placeId);
  if (!place || place.scope !== 'cemetery') return null;
  const people = new Set(
    archive.relations.filter((relation) => relation.placeId === placeId).map((r) => r.personId),
  );
  return people.size === 1 ? [...people][0]! : null;
}
