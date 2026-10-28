# Current person profile model

The canonical contract is `PersonProfile` in `packages/validators/src/profiles.ts`. Every profile contains a display name, optional aliases and life years, tags, one Markdown body, body source IDs, profile-owned sources, an optional portrait, and profile-owned connected locations. Memories and community stories live in the body with their public author credits.

Sources can be external links, image/PDF evidence attachments, or attributed firsthand accounts. Their stable IDs connect body citations, portrait evidence and location evidence. Markdown citations use `[^source-id]`. The body has a source list without requiring a separately modeled record for every paragraph. The shared profile renderer disables raw HTML and rejects unsafe link protocols.

Each location contains a name, relationship label/description, cemetery/Atlanta scope, optional address, optional `[longitude, latitude]` coordinates, precision, location note and two evidence lists. Historical connection evidence does not automatically establish precise coordinates. A relationship without defensible coordinates remains readable as unmapped. Editing one person's location does not mutate another person's connection to the same place.

`archive.persons` stores the current published JSONB profile and monotonically increasing version. `community.profile_revisions` stores complete submitted proposals, with target person ID/base version, proposal version and private submission details. `community.profile_versions` retains accepted snapshots. No draft or test-record status is used. Rejection deletes a proposal; approval atomically replaces current content and inserts accepted history. Person IDs remain stable even when names change.

The map and older archive API consume a compatibility projection produced by `projectProfilesToArchive`. Sources and locations are namespaced by person to keep IDs distinct. The projection is rebuilt entirely from canonical profiles; old biography, place, material and contribution tables never resurrect removed profile content. Those tables remain temporarily for restartable conversion, legacy media and old URL mappings. They are not the active editing model.

Migration `0006_profiles.sql` marks old person rows as version zero. The first canonical read converts those rows transactionally and records version-one snapshots. Conversion preserves biographies, stories, source metadata, materials, public attribution, approved photo links, coordinates and unresolved notes. It fails on invalid references instead of publishing incomplete data. Subsequent reads skip converted people. Permanent person URLs are preserved; old contribution URLs redirect to the primary person.

Stories searches published profiles once per person, matching names/aliases, tags, life years, full body text and connected location names/descriptions/addresses. Name/tag/place filters intersect with free text. Results support relevance or recent-publication sorting and 12 results per page. Pending profiles and private contacts never enter public search.

Data modes remain `local` (persistent PGlite, automatic schema migrations), `fixture` (read-only converted initial collection), and `database` (explicit PostgreSQL connection, explicit migration operation). Read the root README before running migration or reviewer scripts.
