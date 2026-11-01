import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Headphones,
  ImageIcon,
  MapPin,
  Search,
  Users,
} from 'lucide-react';
import { getArchive } from '@southview/db';
import { discoverArchive, formatEventDate, type DiscoveryResult } from '@southview/validators';
import { CommunityShell } from '@/components/community-shell';
import { PhotoViewer, type PhotoViewerItem } from '@/components/photo-viewer';
import { parseStoriesState, storiesHref, withStoriesReturn } from '@/lib/stories-state';
import './stories.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Stories & photographs',
  description:
    'Discover the people, community memories, photographs, and archival materials connected to South-View. Every story keeps its own voice and source.',
};
const tabs = [
  { type: 'all', label: 'Everything' },
  { type: 'story', label: 'Community stories' },
  { type: 'photo', label: 'Photographs' },
  { type: 'person', label: 'People' },
  { type: 'material', label: 'Archival materials' },
] as const;
const storyLabels = {
  memory: 'Community memory',
  addition: 'Community contribution',
  correction: 'Community correction',
  'new-person': 'Community introduction',
};
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const i = q ? text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [archive, params] = await Promise.all([getArchive(), searchParams]);
  const input = parseStoriesState(params);
  const results = discoverArchive(archive, input);
  const counts = input.featured
    ? discoverArchive(archive, { ...input, featured: false }).counts
    : results.counts;
  const returnTo = storiesHref({ ...input, page: results.page });
  const providers = (item: DiscoveryResult) =>
    item.creditIds
      .map((id) => archive.credits.find((credit) => credit.id === id)?.displayName)
      .filter(Boolean)
      .join('; ') || 'Initial archive compilation';
  const photoItems: PhotoViewerItem[] = results.items.flatMap((item) =>
    item.type === 'photo'
      ? [
          {
            id: item.entityId,
            src: item.photo.url,
            alt: item.photo.alt,
            caption: item.photo.caption,
            creator: item.photo.creator,
            provider: providers(item),
            rights: item.photo.rights,
            width: item.photo.width,
            height: item.photo.height,
            source: item.photo.sourceId
              ? (() => {
                  const source = archive.sources.find((s) => s.id === item.photo.sourceId);
                  return source ? { href: source.url, label: source.title } : undefined;
                })()
              : undefined,
            entry: { href: withStoriesReturn(item.url, returnTo), label: 'Open the full record' },
          },
        ]
      : [],
  );
  const themes = [...new Set(archive.people.flatMap((person) => person.themes))].sort();
  const filtered = !!(
    input.q ||
    input.theme !== 'all' ||
    input.personId ||
    input.placeId ||
    input.featured
  );
  return (
    <CommunityShell
      title="Every life holds a story."
      eyebrow="STORIES, PHOTOGRAPHS & SHARED MEMORIES"
      description="A remembered moment. A familiar face. A piece of the past, kept for the future. Explore the voices and records that bring this place to life."
    >
      <div className="stories-orientation">
        <span>
          <BookOpen size={18} aria-hidden="true" /> Community voices, with their own credit and
          context.
        </span>
        <Link href="/contribute">
          Add your story <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <form
        key={returnTo}
        className="stories-search"
        action="/stories"
        method="get"
        role="search"
        aria-label="Search the public archive"
      >
        <div className="stories-search-row">
          <label className="stories-query">
            <span className="sr-only">
              Search stories, people, places, or photograph descriptions
            </span>
            <Search size={21} aria-hidden="true" />
            <input
              name="q"
              defaultValue={input.q}
              maxLength={200}
              placeholder="A name, a place, a memory…"
              type="search"
            />
          </label>
          <button className="community-primary" type="submit">
            Search the archive <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
        <input type="hidden" name="type" value={input.type} />
        {input.featured && <input type="hidden" name="featured" value="1" />}
        <div className="stories-filters">
          <label>
            Theme
            <select name="theme" defaultValue={input.theme}>
              <option value="all">All themes</option>
              {themes.map((theme) => (
                <option key={theme}>{theme}</option>
              ))}
            </select>
          </label>
          <label>
            Person
            <select name="personId" defaultValue={input.personId ?? ''}>
              <option value="">Anyone</option>
              {archive.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Place
            <select name="placeId" defaultValue={input.placeId ?? ''}>
              <option value="">Anywhere</option>
              {archive.places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by
            <select name="sort" defaultValue={input.sort}>
              <option value="relevance">Best match</option>
              <option value="recent">Newest first</option>
            </select>
          </label>
        </div>
      </form>
      <nav className="stories-tabs" aria-label="Types of archive records">
        {tabs.map((tab) => (
          <Link
            key={tab.type}
            href={storiesHref(input, { type: tab.type, featured: false, page: 1 })}
            aria-current={input.type === tab.type && !input.featured ? 'page' : undefined}
          >
            {tab.label}
            <span>{counts[tab.type]}</span>
          </Link>
        ))}
        {(archive.contributions.some((entry) => entry.featured) || input.featured) && (
          <Link
            href={storiesHref(input, { type: 'story', featured: true, page: 1 })}
            aria-current={input.featured ? 'page' : undefined}
          >
            Editor’s selections
          </Link>
        )}
      </nav>
      <div className="stories-result-heading">
        <h2>
          {input.q ? (
            <>Results for “{input.q}”</>
          ) : input.featured ? (
            'Editor’s selections'
          ) : input.type === 'all' ? (
            'Explore the collection'
          ) : (
            tabs.find((tab) => tab.type === input.type)?.label
          )}
        </h2>
        <div>
          <span>
            {results.total} {results.total === 1 ? 'record' : 'records'}
          </span>
          {filtered && (
            <Link
              href={storiesHref(input, {
                q: '',
                theme: 'all',
                personId: undefined,
                placeId: undefined,
                featured: false,
                page: 1,
              })}
            >
              Clear filters
            </Link>
          )}
        </div>
      </div>
      {!archive.contributions.length && input.type === 'all' && !filtered && (
        <p className="stories-collection-note">
          Begin with the sourced archive below. Community stories will join this collection as they
          are reviewed and published.
        </p>
      )}
      {!results.items.length ? (
        <section className="stories-empty">
          <BookOpen size={35} strokeWidth={1} aria-hidden="true" />
          <h3>
            {filtered
              ? 'A story still to be found.'
              : input.type === 'story'
                ? 'There is room for your story here.'
                : 'This part of the collection is still growing.'}
          </h3>
          <p>
            {filtered
              ? 'Try a different word or clear a filter. You can also share a memory or photograph that belongs in this archive.'
              : 'New contributions appear here after review, with their own credit and context. Personal memories are welcome.'}
          </p>
          <div className="community-actions">
            <Link className="community-secondary" href="/stories">
              Browse all records
            </Link>
            <Link className="community-primary" href="/contribute">
              Share a story <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
      ) : (
        <div className="stories-grid">
          {results.items.map((item) => {
            const Icon =
              item.type === 'person'
                ? Users
                : item.type === 'photo'
                  ? ImageIcon
                  : item.type === 'material' && item.materialKind === 'oral-history'
                    ? Headphones
                    : BookOpen;
            const label =
              item.type === 'story'
                ? storyLabels[item.storyKind]
                : item.type === 'person'
                  ? 'Person record'
                  : item.type === 'photo'
                    ? 'Photograph'
                    : item.materialKind === 'oral-history'
                      ? 'Oral history · collection link'
                      : 'Archival document';
            const href = withStoriesReturn(item.url, returnTo);
            return (
              <article className={`stories-card stories-card-${item.type}`} key={item.id}>
                {item.type === 'photo' ? (
                  <PhotoViewer
                    items={photoItems}
                    onlyThumbnailId={item.entityId}
                    label="Photographs in these results"
                  />
                ) : (
                  <>
                    <div className="stories-card-type">
                      <Icon size={17} aria-hidden="true" />
                      {label}
                      {item.type === 'story' && item.featured && (
                        <span className="stories-featured">Editor’s selection</span>
                      )}
                    </div>
                    <h3>
                      <Link href={href}>
                        <Highlight text={item.title} query={input.q} />
                      </Link>
                    </h3>
                    <p className="stories-provider">
                      {providers(item)} — {item.title}
                    </p>
                    <p className="stories-excerpt">
                      <Highlight text={item.excerpt} query={input.q} />
                    </p>
                    {item.type === 'story' && (
                      <p className="stories-date">
                        Event: {formatEventDate(item.eventDate)}
                        {item.date && <> · Published {item.date.slice(0, 10)}</>}
                      </p>
                    )}
                    {item.type === 'material' && item.date && (
                      <p className="stories-date">Source date: {item.date}</p>
                    )}
                    <div className="stories-card-links">
                      {item.type !== 'person' &&
                        item.personIds.map((id) => {
                          const person = archive.people.find((p) => p.id === id);
                          return (
                            person && (
                              <Link
                                key={id}
                                href={withStoriesReturn(
                                  `/people/${encodeURIComponent(id)}`,
                                  returnTo,
                                )}
                              >
                                {person.name}
                              </Link>
                            )
                          );
                        })}
                    </div>
                    <Link className="stories-read" href={href}>
                      {item.type === 'person'
                        ? 'Explore this life'
                        : item.type === 'story'
                          ? 'Read the story'
                          : 'View the record & sources'}
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </Link>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
      {results.totalPages > 1 && (
        <nav className="stories-pagination" aria-label="Search results pages">
          {results.page > 1 ? (
            <Link href={storiesHref(input, { page: results.page - 1 })}>
              <ArrowLeft size={17} aria-hidden="true" /> Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {results.page} of {results.totalPages}
          </span>
          {results.page < results.totalPages ? (
            <Link href={storiesHref(input, { page: results.page + 1 })}>
              Next <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
      <aside className="stories-invitation">
        <div>
          <p className="eyebrow">ANOTHER WAY INTO THE ARCHIVE</p>
          <h2>History has a place.</h2>
          <p>Follow these lives through South-View Cemetery and Atlanta.</p>
        </div>
        <Link className="community-secondary" href="/explore">
          <MapPin size={18} aria-hidden="true" /> Explore the map
        </Link>
      </aside>
    </CommunityShell>
  );
}
