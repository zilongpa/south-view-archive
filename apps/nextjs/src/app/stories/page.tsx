import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, MapPin, Search } from 'lucide-react';
import { readPublishedProfiles } from '@southview/db/profiles';
import { searchProfiles } from '@southview/validators';
import { CommunityShell } from '@/components/community-shell';
import { parseStoriesState, storiesHref, withStoriesReturn } from '@/lib/stories-state';
import './stories.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Stories · Explore people',
  description:
    'Search South-View person profiles by name, tags, connected places, and the stories they hold.',
};

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [profiles, params] = await Promise.all([readPublishedProfiles(), searchParams]);
  const input = parseStoriesState(params);
  const results = searchProfiles(profiles, input);
  const returnTo = storiesHref(input, { page: results.page });
  const tags = [...new Set(profiles.flatMap(({ profile }) => profile.tags))].sort();
  const filtered = !!(
    input.q ||
    input.name ||
    input.tag !== 'all' ||
    input.place ||
    input.personId ||
    input.placeId
  );
  return (
    <CommunityShell
      title="Every life holds a story."
      eyebrow="PEOPLE, PLACES & SHARED MEMORIES"
      description="Find a person through their name, the places they knew, or a detail in their story. Biographies and community memories live together in each sourced profile."
    >
      <div className="stories-orientation">
        <span>
          <BookOpen size={18} aria-hidden="true" /> Explore the people in the archive.
        </span>
        <Link href="/contribute">
          Edit or add a profile <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <form
        key={returnTo}
        className="stories-search"
        action="/stories"
        method="get"
        role="search"
        aria-label="Search person profiles"
      >
        <div className="stories-search-row">
          <label className="stories-query">
            <span className="sr-only">Search all profile text</span>
            <Search size={21} aria-hidden="true" />
            <input
              name="q"
              defaultValue={input.q}
              maxLength={200}
              placeholder="A memory, a detail, a piece of history…"
              type="search"
            />
          </label>
          <button className="community-primary" type="submit">
            Find people <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="stories-filters">
          <label>
            Name
            <input name="name" defaultValue={input.name} maxLength={160} placeholder="Any person" />
          </label>
          <label>
            Tag
            <select name="tag" defaultValue={input.tag}>
              <option value="all">All tags</option>
              {input.tag !== 'all' && !tags.includes(input.tag) && (
                <option value={input.tag}>{input.tag}</option>
              )}
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label>
            Connected place
            <input
              name="place"
              defaultValue={input.place}
              maxLength={200}
              placeholder="Any place"
            />
          </label>
          <label>
            Sort by
            <select name="sort" defaultValue={input.sort}>
              <option value="relevance">Best match</option>
              <option value="recent">Recently updated</option>
            </select>
          </label>
        </div>
        {input.personId && <input type="hidden" name="personId" value={input.personId} />}
        {input.placeId && <input type="hidden" name="placeId" value={input.placeId} />}
      </form>
      <div className="stories-result-heading">
        <h2>{input.q ? <>Results for “{input.q}”</> : 'People and their stories'}</h2>
        <div>
          <span>
            {results.total} {results.total === 1 ? 'person' : 'people'}
          </span>
          {filtered && <Link href="/stories">Clear filters</Link>}
        </div>
      </div>
      {results.items.length ? (
        <div className="stories-grid">
          {results.items.map(({ id, profile, excerpt }) => {
            const href = withStoriesReturn(`/people/${encodeURIComponent(id)}`, returnTo);
            const portrait = profile.portrait;
            const image = portrait?.mediaId
              ? `/api/profiles/media/${encodeURIComponent(portrait.mediaId)}`
              : portrait?.url;
            return (
              <article className="stories-card stories-card-person" key={id}>
                {image && (
                  <Link href={href} className="stories-person-portrait">
                    <img src={image} alt={portrait?.alt || profile.name} loading="lazy" />
                  </Link>
                )}
                <div className="stories-card-type">
                  {profile.tags.join(' · ') || 'Person profile'}
                </div>
                <h3>
                  <Link href={href}>{profile.name}</Link>
                </h3>
                {(profile.birthYear || profile.deathYear) && (
                  <p className="stories-date">
                    {profile.birthYear ?? '?'} – {profile.deathYear ?? '?'}
                  </p>
                )}
                <p className="stories-excerpt">{excerpt}</p>
                {!!profile.locations.length && (
                  <p className="stories-profile-places">
                    <MapPin size={15} aria-hidden="true" />{' '}
                    {profile.locations.map((place) => place.name).join(' · ')}
                  </p>
                )}
                <Link className="stories-read" href={href}>
                  Read the profile <ArrowUpRight size={18} aria-hidden="true" />
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="stories-empty">
          <BookOpen size={35} strokeWidth={1} aria-hidden="true" />
          <h3>No matching people yet.</h3>
          <p>Try a different name, place, or phrase, or clear the filters.</p>
          <div className="community-actions">
            <Link className="community-secondary" href="/stories">
              Browse all people
            </Link>
            <Link className="community-primary" href="/contribute">
              Add a person <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
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
